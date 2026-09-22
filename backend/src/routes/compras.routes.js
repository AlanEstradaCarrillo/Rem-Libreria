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
  idCompraPositivo,
  cargarOrdenCompra,
  cargarRecepcionCompra,
  cargarDevolucionProveedor,
  listarOrdenesCompra,
  crearOrdenCompra,
  cancelarOrdenCompra,
  recibirOrdenCompra,
  devolverAProveedor,
} = require("../services/compras.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const dineroSchema = z.number().finite().nonnegative().max(999999)
  .transform((value) => round2(value));
const ivaSchema = z.number().finite().nonnegative().max(100)
  .transform((value) => round2(value));
const cantidadSchema = z.number().int().positive().max(999);
const textoOpcional = (max) => z.string().trim().min(1).max(max).optional().nullable();

const ordenCreateSchema = z.object({
  proveedor_id: z.number().int().positive(),
  referencia: textoOpcional(100),
  notas: textoOpcional(5000),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad: cantidadSchema,
    costo_unitario: dineroSchema,
    iva_porcentaje: ivaSchema.optional(),
  })).min(1, "La orden requiere al menos una partida").max(200),
});
const recepcionSchema = z.object({
  referencia: textoOpcional(100),
  notas: textoOpcional(5000),
  items: z.array(z.object({
    detalle_orden_compra_id: z.number().int().positive(),
    cantidad: cantidadSchema,
    costo_unitario: dineroSchema.optional(),
  })).min(1, "La recepción requiere al menos una partida").max(200),
});
const cancelacionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
const devolucionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
  referencia: textoOpcional(100),
  notas: textoOpcional(5000),
  items: z.array(z.object({
    detalle_recepcion_compra_id: z.number().int().positive(),
    cantidad: cantidadSchema,
  })).min(1, "La devolución requiere al menos una partida").max(200),
});
const ordenesQuerySchema = z.object({
  estado: z.enum(["EMITIDA", "PARCIAL", "RECIBIDA", "CANCELADA"]).optional(),
  proveedor_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(160).optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});

function itemsCanonicos(items, idKey) {
  return [...items]
    .map((item) => ({ ...item }))
    .sort((a, b) => a[idKey] - b[idKey]);
}

router.get("/ordenes", validate(ordenesQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarOrdenesCompra({ query }, {
      estado: req.query.estado || null,
      proveedorId: req.query.proveedor_id || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/ordenes", validate(ordenCreateSchema), async (req, res, next) => {
  try {
    const clave = getIdempotencyKey(req);
    const solicitud = {
      proveedor_id: req.body.proveedor_id,
      referencia: req.body.referencia ?? null,
      notas: req.body.notas ?? null,
      items: itemsCanonicos(req.body.items, "producto_id"),
    };
    const solicitudHash = hashRequest(solicitud);
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "ORDEN_COMPRA",
        clave,
        solicitudHash,
      });
      if (claim.replay) {
        return { replay: true, orden: await cargarOrdenCompra(client, claim.resourceId) };
      }
      const orden = await crearOrdenCompra(client, {
        proveedorId: req.body.proveedor_id,
        referencia: req.body.referencia ?? null,
        notas: req.body.notas ?? null,
        items: solicitud.items,
        usuarioId: req.user.sub,
      });
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "ORDEN_COMPRA",
        clave,
        recursoTipo: "orden_compra",
        recursoId: orden.id,
      });
      return { replay: false, orden };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.orden);
  } catch (error) { next(error); }
});

router.post(
  "/ordenes/:id/cancelacion",
  validate(cancelacionSchema),
  async (req, res, next) => {
    try {
      const ordenId = idCompraPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitudHash = hashRequest({ orden_compra_id: ordenId, motivo: req.body.motivo });
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_ORDEN_COMPRA",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, orden: await cargarOrdenCompra(client, claim.resourceId) };
        }
        const orden = await cancelarOrdenCompra(client, {
          ordenId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `ORDEN_COMPRA:${ordenId}:CANCELACION:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_ORDEN_COMPRA",
          clave,
          recursoTipo: "orden_compra",
          recursoId: orden.id,
        });
        return { replay: false, orden };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.orden);
    } catch (error) { next(error); }
  }
);

router.post(
  "/ordenes/:id/recepciones",
  validate(recepcionSchema),
  async (req, res, next) => {
    try {
      const ordenId = idCompraPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitud = {
        orden_compra_id: ordenId,
        referencia: req.body.referencia ?? null,
        notas: req.body.notas ?? null,
        items: itemsCanonicos(req.body.items, "detalle_orden_compra_id"),
      };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "RECEPCION_COMPRA",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          const recepcion = await cargarRecepcionCompra(client, claim.resourceId);
          return {
            replay: true,
            recepcion,
            orden: await cargarOrdenCompra(client, recepcion.orden_compra_id),
          };
        }
        const creado = await recibirOrdenCompra(client, {
          ordenId,
          usuarioId: req.user.sub,
          referencia: req.body.referencia ?? null,
          notas: req.body.notas ?? null,
          items: solicitud.items,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "RECEPCION_COMPRA",
          clave,
          recursoTipo: "recepcion_compra",
          recursoId: creado.recepcion.id,
        });
        return { replay: false, ...creado };
      });
      res.status(resultado.replay ? 200 : 201).json({
        orden: resultado.orden,
        recepcion: resultado.recepcion,
      });
    } catch (error) { next(error); }
  }
);

router.post(
  "/ordenes/:id/devoluciones",
  validate(devolucionSchema),
  async (req, res, next) => {
    try {
      const ordenId = idCompraPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitud = {
        orden_compra_id: ordenId,
        motivo: req.body.motivo,
        referencia: req.body.referencia ?? null,
        notas: req.body.notas ?? null,
        items: itemsCanonicos(req.body.items, "detalle_recepcion_compra_id"),
      };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "DEVOLUCION_PROVEEDOR",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          const devolucion = await cargarDevolucionProveedor(client, claim.resourceId);
          return {
            replay: true,
            devolucion,
            orden: await cargarOrdenCompra(client, devolucion.orden_compra_id),
          };
        }
        const creado = await devolverAProveedor(client, {
          ordenId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          referencia: req.body.referencia ?? null,
          notas: req.body.notas ?? null,
          items: solicitud.items,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "DEVOLUCION_PROVEEDOR",
          clave,
          recursoTipo: "devolucion_proveedor",
          recursoId: creado.devolucion.id,
        });
        return { replay: false, ...creado };
      });
      res.status(resultado.replay ? 200 : 201).json({
        orden: resultado.orden,
        devolucion: resultado.devolucion,
      });
    } catch (error) { next(error); }
  }
);

router.get("/ordenes/:id", async (req, res, next) => {
  try {
    res.json(await cargarOrdenCompra({ query }, idCompraPositivo(req.params.id)));
  } catch (error) { next(error); }
});

module.exports = router;
