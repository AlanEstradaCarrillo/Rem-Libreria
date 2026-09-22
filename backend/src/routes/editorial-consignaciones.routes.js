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
  cargarConsignacionEditorial,
  listarConsignacionesEditoriales,
  crearConsignacionEditorial,
  despacharConsignacionEditorial,
  registrarOperacionConsignacion,
  cerrarConsignacionEditorial,
  cancelarConsignacionEditorial,
} = require("../services/editorial-consignaciones.service");
const { idEditorialPositivo } = require("../services/editorial-obras.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const fechaSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Fecha inválida");
const textoOpcional = (max) => z.string().trim().min(1).max(max).optional().nullable();
const itemsSchema = z.array(z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive().max(999),
}).strict()).min(1).max(200);
const crearSchema = z.object({
  cliente_id: z.number().int().positive(),
  fecha_envio_programada: fechaSchema,
  fecha_limite: fechaSchema.optional().nullable(),
  moneda: z.string().trim().length(3).optional().default("MXN")
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), "Moneda inválida"),
  referencia: textoOpcional(120),
  notas: textoOpcional(10000),
  items: itemsSchema,
}).refine(
  (value) => !value.fecha_limite || value.fecha_limite >= value.fecha_envio_programada,
  { path: ["fecha_limite"], message: "La fecha límite no puede preceder al envío" }
);
const motivoSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
  referencia: textoOpcional(160),
});
const operacionBaseSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
  referencia: textoOpcional(160),
  items: itemsSchema,
});
const ventaSchema = operacionBaseSchema.extend({
  referencia: z.string().trim().min(1).max(160),
});
const listarSchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  estado: z.enum(["BORRADOR", "ENVIADA", "PARCIAL", "LIQUIDADA", "CERRADA", "CANCELADA"])
    .optional(),
  cliente_id: z.coerce.number().int().positive().optional(),
  tipo_comercial: z.enum(["LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"]).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});

function itemsCanonicos(items) {
  return [...items].sort((a, b) => (
    a.producto_id - b.producto_id || a.cantidad - b.cantidad
  ));
}

async function ejecutarIdempotente(req, {
  operacion,
  solicitud,
  ejecutar,
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
        consignacion: await cargarConsignacionEditorial(client, claim.resourceId),
      };
    }
    const consignacion = await ejecutar(client, clave);
    await completeOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      recursoTipo: "consignacion_editorial",
      recursoId: consignacion.id,
    });
    return { replay: false, consignacion };
  });
}

function responder(res, resultado) {
  res.status(resultado.replay ? 200 : 201).json(resultado.consignacion);
}

router.get(
  "/consignaciones",
  validate(listarSchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await listarConsignacionesEditoriales({ query }, {
        estado: req.query.estado || null,
        clienteId: req.query.cliente_id || null,
        tipoComercial: req.query.tipo_comercial || null,
        q: req.query.q,
        page: req.query.page,
        limit: req.query.limit,
      }));
    } catch (error) { next(error); }
  }
);

router.post(
  "/consignaciones",
  validate(crearSchema),
  async (req, res, next) => {
    try {
      const solicitud = { ...req.body, items: itemsCanonicos(req.body.items) };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_ALTA",
        solicitud,
        ejecutar: (client, clave) => crearConsignacionEditorial(client, {
          clienteId: req.body.cliente_id,
          fechaEnvioProgramada: req.body.fecha_envio_programada,
          fechaLimite: req.body.fecha_limite ?? null,
          moneda: req.body.moneda,
          referencia: req.body.referencia ?? null,
          notas: req.body.notas ?? null,
          items: solicitud.items,
          usuarioId: req.user.sub,
          origenClave: `CONSIGNACION:ALTA:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.get("/consignaciones/:id", async (req, res, next) => {
  try {
    res.json(await cargarConsignacionEditorial({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.post(
  "/consignaciones/:id/envio",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const consignacionId = idEditorialPositivo(req.params.id, "consignacion_editorial_id");
      const solicitud = { consignacion_editorial_id: consignacionId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_ENVIO",
        solicitud,
        ejecutar: (client, clave) => despacharConsignacionEditorial(client, {
          consignacionId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          referencia: req.body.referencia ?? null,
          origenClave: `CONSIGNACION:${consignacionId}:ENVIO:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/consignaciones/:id/ventas",
  validate(ventaSchema),
  async (req, res, next) => {
    try {
      const consignacionId = idEditorialPositivo(req.params.id, "consignacion_editorial_id");
      const solicitud = {
        consignacion_editorial_id: consignacionId,
        ...req.body,
        items: itemsCanonicos(req.body.items),
      };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_VENTA",
        solicitud,
        ejecutar: (client, clave) => registrarOperacionConsignacion(client, {
          consignacionId,
          tipo: "VENTA",
          items: solicitud.items,
          usuarioId: req.user.sub,
          referencia: req.body.referencia,
          motivo: req.body.motivo,
          origenClave: `CONSIGNACION:${consignacionId}:VENTA:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/consignaciones/:id/devoluciones",
  validate(operacionBaseSchema),
  async (req, res, next) => {
    try {
      const consignacionId = idEditorialPositivo(req.params.id, "consignacion_editorial_id");
      const solicitud = {
        consignacion_editorial_id: consignacionId,
        ...req.body,
        items: itemsCanonicos(req.body.items),
      };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_DEVOLUCION",
        solicitud,
        ejecutar: (client, clave) => registrarOperacionConsignacion(client, {
          consignacionId,
          tipo: "DEVOLUCION",
          items: solicitud.items,
          usuarioId: req.user.sub,
          referencia: req.body.referencia ?? null,
          motivo: req.body.motivo,
          origenClave: `CONSIGNACION:${consignacionId}:DEVOLUCION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/consignaciones/:id/cierre",
  requireRoles("ADMIN"),
  validate(z.object({ motivo: z.string().trim().min(3).max(500) })),
  async (req, res, next) => {
    try {
      const consignacionId = idEditorialPositivo(req.params.id, "consignacion_editorial_id");
      const solicitud = { consignacion_editorial_id: consignacionId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_CIERRE",
        solicitud,
        ejecutar: (client, clave) => cerrarConsignacionEditorial(client, {
          consignacionId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `CONSIGNACION:${consignacionId}:CIERRE:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/consignaciones/:id/cancelacion",
  validate(z.object({ motivo: z.string().trim().min(3).max(500) })),
  async (req, res, next) => {
    try {
      const consignacionId = idEditorialPositivo(req.params.id, "consignacion_editorial_id");
      const solicitud = { consignacion_editorial_id: consignacionId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONSIGNACION_EDITORIAL_CANCELACION",
        solicitud,
        ejecutar: (client, clave) => cancelarConsignacionEditorial(client, {
          consignacionId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `CONSIGNACION:${consignacionId}:CANCELACION:${req.user.sub}:${clave}`,
        }),
      });
      responder(res, resultado);
    } catch (error) { next(error); }
  }
);

module.exports = router;
