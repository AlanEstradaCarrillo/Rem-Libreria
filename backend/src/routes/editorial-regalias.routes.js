const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const {
  cargarLiquidacionRegalia,
  listarLiquidacionesRegalias,
  obtenerEstadoCuentaRegalias,
  generarLiquidacionRegalia,
  transicionarLiquidacionRegalia,
} = require("../services/editorial-regalias.service");
const { idEditorialPositivo } = require("../services/editorial-obras.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const fechaSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Fecha inválida");
const generarSchema = z.object({
  contrato_editorial_id: z.number().int().positive(),
  periodo_desde: fechaSchema,
  periodo_hasta: fechaSchema,
  zona_horaria: z.string().trim().min(1).max(80).optional()
    .default("America/Mexico_City"),
  notas: z.string().trim().min(1).max(10000).optional().nullable(),
}).refine((value) => value.periodo_hasta > value.periodo_desde, {
  message: "La fecha final debe ser posterior a la inicial",
  path: ["periodo_hasta"],
});
const listarSchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  estado: z.enum(["BORRADOR", "EMITIDA", "PAGADA", "CANCELADA"]).optional(),
  contrato_editorial_id: z.coerce.number().int().positive().optional(),
  obra_editorial_id: z.coerce.number().int().positive().optional(),
  colaborador_editorial_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});
const estadoCuentaSchema = z.object({
  colaborador_editorial_id: z.coerce.number().int().positive().optional(),
});
const transicionSchema = z.object({
  estado: z.enum(["EMITIDA", "PAGADA", "CANCELADA"]),
  motivo: z.string().trim().min(3).max(500),
  referencia: z.string().trim().min(1).max(160).optional().nullable(),
}).superRefine((value, context) => {
  if (value.estado === "PAGADA" && !value.referencia) {
    context.addIssue({
      code: "custom",
      path: ["referencia"],
      message: "La referencia de pago es obligatoria",
    });
  }
  if (value.estado !== "PAGADA" && value.referencia) {
    context.addIssue({
      code: "custom",
      path: ["referencia"],
      message: "La referencia sólo corresponde a un pago",
    });
  }
});

async function ejecutarIdempotente(req, {
  operacion,
  solicitud,
  crear,
}) {
  const clave = getIdempotencyKey(req);
  const solicitudHash = hashRequest(solicitud);
  return tx(async (client) => {
    const claim = await claimOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      solicitudHash,
    });
    if (claim.replay) {
      return {
        replay: true,
        liquidacion: await cargarLiquidacionRegalia(client, claim.resourceId),
      };
    }
    const liquidacion = await crear(client, clave);
    await completeOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      recursoTipo: "liquidacion_regalia",
      recursoId: liquidacion.id,
    });
    return { replay: false, liquidacion };
  });
}

function responder(res, resultado) {
  res.status(resultado.replay ? 200 : 201).json(resultado.liquidacion);
}

router.get(
  "/regalias/estado-cuenta",
  validate(estadoCuentaSchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await obtenerEstadoCuentaRegalias({ query }, {
        colaboradorId: req.query.colaborador_editorial_id || null,
      }));
    } catch (error) { next(error); }
  }
);

router.get(
  "/regalias/liquidaciones",
  validate(listarSchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await listarLiquidacionesRegalias({ query }, {
        estado: req.query.estado || null,
        contratoId: req.query.contrato_editorial_id || null,
        obraId: req.query.obra_editorial_id || null,
        colaboradorId: req.query.colaborador_editorial_id || null,
        q: req.query.q,
        page: req.query.page,
        limit: req.query.limit,
      }));
    } catch (error) { next(error); }
  }
);

router.post(
  "/regalias/liquidaciones",
  requireRoles("ADMIN"),
  validate(generarSchema),
  async (req, res, next) => {
    try {
      const solicitud = { ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "LIQUIDACION_REGALIA",
        solicitud,
        crear: (client, clave) => generarLiquidacionRegalia(client, {
          contratoId: req.body.contrato_editorial_id,
          periodoDesde: req.body.periodo_desde,
          periodoHasta: req.body.periodo_hasta,
          zonaHoraria: req.body.zona_horaria,
          notas: req.body.notas ?? null,
          usuarioId: req.user.sub,
          origenClave: `REGALIA:LIQUIDACION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.get("/regalias/liquidaciones/:id", async (req, res, next) => {
  try {
    res.json(await cargarLiquidacionRegalia({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.post(
  "/regalias/liquidaciones/:id/transiciones",
  requireRoles("ADMIN"),
  validate(transicionSchema),
  async (req, res, next) => {
    try {
      const liquidacionId = idEditorialPositivo(req.params.id, "liquidacion_regalia_id");
      const solicitud = { liquidacion_regalia_id: liquidacionId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "TRANSICION_LIQUIDACION_REGALIA",
        solicitud,
        crear: (client, clave) => transicionarLiquidacionRegalia(client, {
          liquidacionId,
          estadoNuevo: req.body.estado,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          referencia: req.body.referencia ?? null,
          origenClave: `REGALIA:${liquidacionId}:TRANSICION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

module.exports = router;
