const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const { bloquearProductos, aplicarMovimiento } = require("../services/inventario.service");
const { z } = require("zod");

router.use(requireAuth);

const existenciasQuery = z.object({
  producto_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(160).optional().default(""),
  limit: z.coerce.number().int().positive().max(200).optional().default(100),
});

router.get("/existencias", validate(existenciasQuery, "query"), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT p.id, p.sku, p.titulo, p.stock AS fisico,
              p.stock_reservado AS reservado,
              p.stock_consignado AS consignado,
              (p.stock+p.stock_consignado)::int AS propiedad_total,
              p.stock_disponible AS disponible,
              COALESCE(pr.stock_minimo, 0)::int AS stock_minimo,
              COALESCE(pr.stock_objetivo, 0)::int AS stock_objetivo,
              pr.proveedor_preferido_id, prov.nombre AS proveedor_preferido
       FROM productos p
       LEFT JOIN politicas_reposicion pr ON pr.producto_id=p.id
       LEFT JOIN proveedores prov ON prov.id=pr.proveedor_preferido_id
       WHERE ($1::int IS NULL OR p.id=$1)
         AND ($2::text='' OR p.titulo ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%'
              OR p.isbn ILIKE '%'||$2||'%')
       ORDER BY p.titulo
       LIMIT $3`,
      [req.query.producto_id || null, req.query.q, req.query.limit]
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

const kardexQuery = z.object({
  producto_id: z.coerce.number().int().positive(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(100),
});

router.get("/kardex", validate(kardexQuery, "query"), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT im.*, u.nombre AS usuario
       FROM inventario_movimientos im
       LEFT JOIN usuarios u ON u.id=im.usuario_id
       WHERE im.producto_id=$1 AND ($2::bigint IS NULL OR im.id<$2)
       ORDER BY im.id DESC LIMIT $3`,
      [req.query.producto_id, req.query.cursor || null, req.query.limit]
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

const ajusteSchema = z.object({
  producto_id: z.number().int().positive(),
  delta: z.number().int().refine((value) => value !== 0, "El ajuste no puede ser cero"),
  motivo: z.string().trim().min(3).max(240),
});

router.post(
  "/ajustes",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(ajusteSchema),
  async (req, res, next) => {
    try {
      const clave = getIdempotencyKey(req);
      const solicitudHash = hashRequest(req.body);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "AJUSTE_INVENTARIO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          const existente = await client.query(
            `SELECT im.*, p.stock, p.stock_reservado,
                    p.stock_consignado, p.stock_disponible
             FROM inventario_movimientos im
             JOIN productos p ON p.id=im.producto_id
             WHERE im.id=$1 AND im.tipo='AJUSTE'`,
            [claim.resourceId]
          );
          if (!existente.rows[0]) throw new ApiError(409, "El ajuste idempotente no está disponible.");
          return { replay: true, ajuste: existente.rows[0] };
        }

        const [producto] = await bloquearProductos(client, [req.body.producto_id]);
        const aplicado = await aplicarMovimiento(client, {
          producto,
          deltaFisico: req.body.delta,
          tipo: "AJUSTE",
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `AJUSTE:${req.user.sub}:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "AJUSTE_INVENTARIO",
          clave,
          recursoTipo: "inventario_movimiento",
          recursoId: aplicado.movimiento.id,
        });
        return {
          replay: false,
          ajuste: { ...aplicado.movimiento, ...{
            stock: aplicado.producto.stock,
            stock_reservado: aplicado.producto.stock_reservado,
            stock_consignado: aplicado.producto.stock_consignado,
            stock_disponible: aplicado.producto.stock_disponible,
          } },
        };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.ajuste);
    } catch (e) { next(e); }
  }
);

module.exports = router;
