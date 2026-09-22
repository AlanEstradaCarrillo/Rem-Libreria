const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { round2 } = require("../utils/errors");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const {
  cargarTirajeEditorial,
  listarTirajesEditoriales,
  crearTirajeEditorial,
  actualizarTirajeEditorial,
  agregarCostoTiraje,
  actualizarCostoTiraje,
  eliminarCostoTiraje,
  confirmarTirajeEditorial,
  cancelarTirajeEditorial,
} = require("../services/editorial-tirajes.service");
const { idEditorialPositivo } = require("../services/editorial-obras.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const textoOpcional = (max) => z.string().trim().min(1).max(max).optional().nullable();
const fechaSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Fecha inválida");
const dineroSchema = z.number().finite().positive().max(999999999)
  .transform((value) => round2(value));
const monedaSchema = z.string().trim().length(3)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Moneda inválida");
const costoSchema = z.object({
  tipo: z.enum([
    "PREPRENSA", "IMPRESION", "PAPEL", "ENCUADERNACION",
    "ACABADOS", "TRANSPORTE", "OTRO",
  ]),
  concepto: z.string().trim().min(2).max(240),
  proveedor_id: z.number().int().positive().optional().nullable(),
  referencia: textoOpcional(100),
  monto: dineroSchema,
});
const tirajeCreateSchema = z.object({
  obra_editorial_id: z.number().int().positive(),
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive().max(1000000),
  fecha_programada: fechaSchema,
  moneda: monedaSchema.optional().default("MXN"),
  notas: textoOpcional(10000),
  costos: z.array(costoSchema).min(1, "Registra al menos un costo").max(100),
});
const tirajePatchSchema = z.object({
  cantidad: z.number().int().positive().max(1000000).optional(),
  fecha_programada: fechaSchema.optional(),
  moneda: monedaSchema.optional(),
  notas: textoOpcional(10000),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });
const costoPatchSchema = costoSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Nada que actualizar" }
);
const tirajesQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  estado: z.enum(["BORRADOR", "CONFIRMADO", "CANCELADO"]).optional(),
  obra_editorial_id: z.coerce.number().int().positive().optional(),
  producto_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});
const motivoSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
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
      return { replay: true, tiraje: await cargarTirajeEditorial(client, claim.resourceId) };
    }
    const tiraje = await crear(client, clave);
    await completeOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      recursoTipo: "tiraje_editorial",
      recursoId: tiraje.id,
    });
    return { replay: false, tiraje };
  });
}

function responder(res, resultado) {
  res.status(resultado.replay ? 200 : 201).json(resultado.tiraje);
}

router.get("/tirajes", validate(tirajesQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarTirajesEditoriales({ query }, {
      estado: req.query.estado || null,
      obraId: req.query.obra_editorial_id || null,
      productoId: req.query.producto_id || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/tirajes", validate(tirajeCreateSchema), async (req, res, next) => {
  try {
    const solicitud = {
      ...req.body,
      costos: [...req.body.costos].sort((a, b) => (
        `${a.tipo}:${a.concepto}:${a.monto}`.localeCompare(`${b.tipo}:${b.concepto}:${b.monto}`)
      )),
    };
    const resultado = await ejecutarIdempotente(req, {
      operacion: "TIRAJE_EDITORIAL",
      solicitud,
      crear: (client, clave) => crearTirajeEditorial(client, {
        obraId: req.body.obra_editorial_id,
        productoId: req.body.producto_id,
        cantidad: req.body.cantidad,
        fechaProgramada: req.body.fecha_programada,
        moneda: req.body.moneda,
        notas: req.body.notas ?? null,
        costos: solicitud.costos,
        usuarioId: req.user.sub,
        origenClave: `TIRAJE:CREACION:${req.user.sub}:${clave}`,
      }),
    });
    responder(res, resultado);
  } catch (error) { next(error); }
});

router.get("/tirajes/:id", async (req, res, next) => {
  try {
    res.json(await cargarTirajeEditorial({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.patch("/tirajes/:id", validate(tirajePatchSchema), async (req, res, next) => {
  try {
    res.json(await tx((client) => actualizarTirajeEditorial(
      client,
      req.params.id,
      req.body
    )));
  } catch (error) { next(error); }
});

router.post("/tirajes/:id/costos", validate(costoSchema), async (req, res, next) => {
  try {
    const tirajeId = idEditorialPositivo(req.params.id, "tiraje_editorial_id");
    const solicitud = { tiraje_editorial_id: tirajeId, ...req.body };
    const resultado = await ejecutarIdempotente(req, {
      operacion: "COSTO_TIRAJE_EDITORIAL",
      solicitud,
      crear: (client) => agregarCostoTiraje(client, {
        tirajeId,
        costo: req.body,
        usuarioId: req.user.sub,
      }),
    });
    responder(res, resultado);
  } catch (error) { next(error); }
});

router.patch(
  "/tirajes/:id/costos/:costoId",
  validate(costoPatchSchema),
  async (req, res, next) => {
    try {
      res.json(await tx((client) => actualizarCostoTiraje(client, {
        tirajeId: req.params.id,
        costoId: req.params.costoId,
        cambios: req.body,
      })));
    } catch (error) { next(error); }
  }
);

router.delete("/tirajes/:id/costos/:costoId", async (req, res, next) => {
  try {
    res.json(await tx((client) => eliminarCostoTiraje(client, {
      tirajeId: req.params.id,
      costoId: req.params.costoId,
    })));
  } catch (error) { next(error); }
});

router.post(
  "/tirajes/:id/confirmacion",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const tirajeId = idEditorialPositivo(req.params.id, "tiraje_editorial_id");
      const solicitud = { tiraje_editorial_id: tirajeId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONFIRMACION_TIRAJE_EDITORIAL",
        solicitud,
        crear: (client, clave) => confirmarTirajeEditorial(client, {
          tirajeId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `TIRAJE:${tirajeId}:CONFIRMACION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/tirajes/:id/cancelacion",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const tirajeId = idEditorialPositivo(req.params.id, "tiraje_editorial_id");
      const solicitud = { tiraje_editorial_id: tirajeId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CANCELACION_TIRAJE_EDITORIAL",
        solicitud,
        crear: (client, clave) => cancelarTirajeEditorial(client, {
          tirajeId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `TIRAJE:${tirajeId}:CANCELACION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

module.exports = router;
