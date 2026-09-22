// backend/src/routes/caja.routes.js — sesiones de caja explícitas y aisladas
const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError, round2 } = require("../utils/errors");
const {
  hashRequest, getIdempotencyKey, claimOperation, completeOperation,
} = require("../utils/idempotency");
const {
  ROLES_PRIVILEGIADOS,
  parsePositiveId,
  puedeOperarSesion,
  bloquearSesionAbierta,
} = require("../services/caja.service");
const { z } = require("zod");

router.use(requireAuth);

async function totalesSesion(client, sesionId) {
  const r = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE tipo='VENTA')::int AS n_ventas,
       COALESCE(SUM(monto) FILTER (WHERE tipo='VENTA' AND metodo_pago='EFECTIVO'),0) AS ventas_efectivo,
       COALESCE(SUM(monto) FILTER (WHERE tipo='VENTA' AND metodo_pago='TARJETA'),0) AS ventas_tarjeta,
       COALESCE(SUM(monto) FILTER (WHERE tipo='VENTA' AND metodo_pago='TRANSFERENCIA'),0) AS ventas_transf,
       COALESCE(SUM(monto) FILTER (
         WHERE tipo IN ('CANCELACION','DEVOLUCION') AND metodo_pago='EFECTIVO'
       ),0) AS devoluciones_efectivo,
       COALESCE(SUM(monto) FILTER (
         WHERE tipo IN ('CANCELACION','DEVOLUCION') AND metodo_pago='TARJETA'
       ),0) AS devoluciones_tarjeta,
       COALESCE(SUM(monto) FILTER (
         WHERE tipo IN ('CANCELACION','DEVOLUCION') AND metodo_pago='TRANSFERENCIA'
       ),0) AS devoluciones_transf,
       COALESCE(SUM(monto) FILTER (WHERE tipo='RETIRO'),0) AS retiros,
       COALESCE(SUM(monto) FILTER (WHERE tipo='INGRESO'),0) AS ingresos
     FROM movimientos
     WHERE sesion_id=$1`,
    [sesionId]
  );
  return r.rows[0];
}

function efectivoEsperado(sesion, totales) {
  return round2(
    Number(sesion.fondo_inicial)
      + Number(totales.ventas_efectivo)
      + Number(totales.ingresos)
      - Number(totales.retiros)
      - Number(totales.devoluciones_efectivo)
  );
}

router.get("/cajas", async (req, res, next) => {
  try {
    const incluirInactivas = ROLES_PRIVILEGIADOS.has(req.user.rol);
    const r = await query(
      `SELECT c.id, c.nombre, c.activo,
              s.id AS sesion_id, s.usuario_id AS sesion_usuario_id,
              s.fecha_apertura AS sesion_fecha_apertura, u.nombre AS sesion_operador
       FROM caja c
       LEFT JOIN sesiones_caja s ON s.caja_id=c.id AND s.estado='ABIERTA'
       LEFT JOIN usuarios u ON u.id=s.usuario_id
       WHERE c.activo=TRUE OR $1::boolean
       ORDER BY c.id`,
      [incluirInactivas]
    );
    res.json(r.rows.map((caja) => ({
      ...caja,
      abierta: Boolean(caja.sesion_id),
      puede_operar: Boolean(caja.activo) && (
        !caja.sesion_id
        || ROLES_PRIVILEGIADOS.has(req.user.rol)
        || Number(caja.sesion_usuario_id) === Number(req.user.sub)
      ),
    })));
  } catch (e) { next(e); }
});

const estadoQuerySchema = z.object({
  caja_id: z.coerce.number().int().positive(),
});

router.get("/estado", validate(estadoQuerySchema, "query"), async (req, res, next) => {
  try {
    const estado = await tx(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const caja = await client.query(
        `SELECT id, nombre, activo FROM caja WHERE id=$1`,
        [req.query.caja_id]
      );
      if (!caja.rows[0]) throw new ApiError(404, "Caja inexistente.");

      const s = await client.query(
        `SELECT s.*, u.nombre AS operador
         FROM sesiones_caja s
         JOIN usuarios u ON u.id=s.usuario_id
         WHERE s.caja_id=$1 AND s.estado='ABIERTA'`,
        [req.query.caja_id]
      );
      if (!s.rows[0]) {
        const ultimoCorte = await client.query(
          `WITH ultima_sesion AS (
             SELECT id FROM sesiones_caja
             WHERE caja_id=$1 AND estado='CERRADA'
             ORDER BY id DESC LIMIT 1
           )
           SELECT cor.*, s.caja_id, s.fondo_inicial, s.fecha_apertura,
                  s.fecha_cierre, u.nombre AS responsable
           FROM ultima_sesion us
           JOIN sesiones_caja s ON s.id=us.id
           JOIN cortes cor ON cor.sesion_id=s.id
           JOIN usuarios u ON u.id=cor.usuario_id
           WHERE (s.usuario_id=$2 OR $3::boolean)`,
          [req.query.caja_id, req.user.sub, ROLES_PRIVILEGIADOS.has(req.user.rol)]
        );
        return {
          abierta: false,
          caja: caja.rows[0],
          puede_operar: Boolean(caja.rows[0].activo),
          ...(ultimoCorte.rows[0] ? { ultimo_corte: ultimoCorte.rows[0] } : {}),
          ...(caja.rows[0].activo ? {} : { motivo_no_operable: "La caja está inactiva." }),
        };
      }

      const sesion = s.rows[0];
      const puedeOperar = puedeOperarSesion(req.user, sesion);
      if (!puedeOperar) {
        return {
          abierta: true,
          caja: caja.rows[0],
          puede_operar: false,
          motivo_no_operable: "La caja está abierta por otro operador.",
          sesion: {
            id: sesion.id,
            caja_id: sesion.caja_id,
            usuario_id: sesion.usuario_id,
            estado: sesion.estado,
            fecha_apertura: sesion.fecha_apertura,
            operador: sesion.operador,
          },
        };
      }
      const agg = await totalesSesion(client, sesion.id);
      const movs = await client.query(
        `SELECT m.id, m.tipo, m.concepto, m.monto, m.metodo_pago, m.creado_en,
                m.usuario_id, u.nombre AS usuario
         FROM movimientos m
         JOIN usuarios u ON u.id=m.usuario_id
         WHERE m.sesion_id=$1
         ORDER BY m.id DESC LIMIT 20`,
        [sesion.id]
      );
      return {
        abierta: true,
        caja: caja.rows[0],
        puede_operar: puedeOperar,
        sesion,
        esperado: efectivoEsperado(sesion, agg),
        ...agg,
        movimientos: movs.rows,
      };
    });
    res.json(estado);
  } catch (e) { next(e); }
});

const aperturaSchema = z.object({
  caja_id: z.number().int().positive(),
  fondo_inicial: z.number().nonnegative().max(9999999999.99)
    .refine(
      (monto) => Math.abs((monto * 100) - Math.round(monto * 100)) < 1e-8,
      "El fondo inicial admite como máximo dos decimales"
    ),
});

router.post(
  "/apertura",
  requireRoles("ADMIN", "SUPERVISOR", "CAJERO"),
  validate(aperturaSchema),
  async (req, res, next) => {
    try {
      const sesion = await tx(async (client) => {
        const caja = await client.query(`SELECT * FROM caja WHERE id=$1 FOR UPDATE`, [req.body.caja_id]);
        if (!caja.rows[0]) throw new ApiError(404, "Caja inexistente.");
        if (!caja.rows[0].activo) throw new ApiError(409, "La caja está inactiva.");

        const abierta = await client.query(
          `SELECT id FROM sesiones_caja WHERE caja_id=$1 AND estado='ABIERTA'`,
          [req.body.caja_id]
        );
        if (abierta.rows[0]) throw new ApiError(409, "Esa caja ya tiene una sesión abierta.");

        const s = await client.query(
          `INSERT INTO sesiones_caja (caja_id, usuario_id, fondo_inicial)
           VALUES ($1,$2,$3) RETURNING *`,
          [req.body.caja_id, req.user.sub, req.body.fondo_inicial]
        );
        await client.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, concepto, monto, actor_inferido)
           VALUES ($1,$2,$3,'APERTURA','Apertura de caja',$4,FALSE)`,
          [s.rows[0].id, req.body.caja_id, req.user.sub, req.body.fondo_inicial]
        );
        return s.rows[0];
      });
      res.status(201).json(sesion);
    } catch (e) { next(e); }
  }
);

const movimientoSchema = z.object({
  sesion_id: z.number().int().positive(),
  monto: z.number().positive().max(9999999999.99)
    .refine(
      (monto) => Math.abs((monto * 100) - Math.round(monto * 100)) < 1e-8,
      "El monto admite como máximo dos decimales"
    ),
  concepto: z.string().trim().min(3).max(160),
});

function registrarMovimiento(tipo) {
  return async (req, res, next) => {
    try {
      const clave = getIdempotencyKey(req);
      const operacion = `CAJA_${tipo}`;
      const solicitudHash = hashRequest(req.body);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub, operacion, clave, solicitudHash,
        });
        if (claim.replay) {
          const anterior = await client.query(
            `SELECT * FROM movimientos WHERE id=$1 AND tipo=$2 AND usuario_id=$3`,
            [claim.resourceId, tipo, req.user.sub]
          );
          if (!anterior.rows[0]) throw new ApiError(409, "El movimiento idempotente no está disponible.");
          return { replay: true, movimiento: anterior.rows[0] };
        }
        const sesion = await bloquearSesionAbierta(client, req.body.sesion_id, req.user, { exigirPropiedad: false });
        if (tipo === "RETIRO") {
          const disponible = efectivoEsperado(sesion, await totalesSesion(client, sesion.id));
          if (req.body.monto > disponible) {
            throw new ApiError(409, "El retiro supera el efectivo disponible en esta caja.");
          }
        }
        const r = await client.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, concepto, monto, actor_inferido)
           VALUES ($1,$2,$3,$4,$5,$6,FALSE)
           RETURNING *`,
          [sesion.id, sesion.caja_id, req.user.sub, tipo, req.body.concepto, req.body.monto]
        );
        await completeOperation(client, {
          usuarioId: req.user.sub, operacion, clave,
          recursoTipo: "movimiento_caja", recursoId: r.rows[0].id,
        });
        return { replay: false, movimiento: r.rows[0] };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.movimiento);
    } catch (e) { next(e); }
  };
}

router.post(
  "/retiro",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(movimientoSchema),
  registrarMovimiento("RETIRO")
);
router.post(
  "/ingreso",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(movimientoSchema),
  registrarMovimiento("INGRESO")
);

const corteSchema = z.object({
  sesion_id: z.number().int().positive(),
  efectivo_contado: z.number().nonnegative().max(9999999999.99)
    .refine(
      (monto) => Math.abs((monto * 100) - Math.round(monto * 100)) < 1e-8,
      "El efectivo contado admite como máximo dos decimales"
    ),
});

router.post("/corte", validate(corteSchema), async (req, res, next) => {
  try {
    const clave = getIdempotencyKey(req);
    const solicitudHash = hashRequest(req.body);
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub, operacion: "CORTE_CAJA", clave, solicitudHash,
      });
      if (claim.replay) {
        const anterior = await client.query(
          `SELECT * FROM cortes WHERE id=$1 AND usuario_id=$2`,
          [claim.resourceId, req.user.sub]
        );
        if (!anterior.rows[0]) throw new ApiError(409, "El corte idempotente no está disponible.");
        return { replay: true, corte: anterior.rows[0] };
      }
      const sesion = await bloquearSesionAbierta(client, req.body.sesion_id, req.user);
      const agg = await totalesSesion(client, sesion.id);
      const esperado = efectivoEsperado(sesion, agg);
      const contado = req.body.efectivo_contado;
      const diferencia = round2(contado - esperado);

      const cor = await client.query(
        `INSERT INTO cortes
           (sesion_id, usuario_id, n_ventas, ventas_efectivo, ventas_tarjeta, ventas_transf,
             devoluciones_efectivo, devoluciones_tarjeta, devoluciones_transf,
             ingresos, retiros, efectivo_esperado, efectivo_contado, diferencia)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
           sesion.id, req.user.sub, agg.n_ventas, agg.ventas_efectivo, agg.ventas_tarjeta,
           agg.ventas_transf, agg.devoluciones_efectivo, agg.devoluciones_tarjeta,
           agg.devoluciones_transf, agg.ingresos, agg.retiros, esperado, contado, diferencia,
        ]
      );
      await client.query(
        `INSERT INTO movimientos
           (sesion_id, caja_id, usuario_id, tipo, concepto, monto, actor_inferido)
         VALUES ($1,$2,$3,'CIERRE','Cierre de caja / corte',0,FALSE)`,
        [sesion.id, sesion.caja_id, req.user.sub]
      );
      const cerrado = await client.query(
        `UPDATE sesiones_caja SET estado='CERRADA', fecha_cierre=NOW()
         WHERE id=$1 AND estado='ABIERTA' RETURNING id`,
        [sesion.id]
      );
      if (!cerrado.rows[0]) throw new ApiError(409, "La sesión ya estaba cerrada.");
      await completeOperation(client, {
        usuarioId: req.user.sub, operacion: "CORTE_CAJA", clave,
        recursoTipo: "corte_caja", recursoId: cor.rows[0].id,
      });
      return { replay: false, corte: cor.rows[0] };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.corte);
  } catch (e) { next(e); }
});

router.get("/cortes", requireRoles("ADMIN", "SUPERVISOR"), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT cor.*, u.nombre AS responsable, s.fecha_apertura, s.fecha_cierre,
              s.caja_id, ca.nombre AS caja_nombre
       FROM cortes cor
       JOIN usuarios u ON u.id=cor.usuario_id
       JOIN sesiones_caja s ON s.id=cor.sesion_id
       JOIN caja ca ON ca.id=s.caja_id
       ORDER BY cor.id DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

module.exports = router;
