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
const { compactarItems } = require("../services/precios.service");
const {
  idPositivo,
  cargarPedido,
  listarPedidos,
  crearPedidoReservado,
  marcarPedidoListo,
  cancelarPedido,
  expirarPedidosVencidos,
} = require("../services/pedidos.service");
const { z } = require("zod");

router.use(requireAuth);

const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLowerCase());
const telefonoSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s.-]+$/, "El teléfono contiene caracteres inválidos.");
const contactoSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  telefono: telefonoSchema,
  email: emailSchema.optional().nullable(),
  direccion: z.string().trim().min(3).max(2000).optional().nullable(),
});
const pedidoCreateSchema = z.object({
  cliente_id: z.number().int().positive().optional().nullable(),
  cliente: contactoSchema.optional().nullable(),
  tipo_entrega: z.enum(["ENVIO", "RECOLECCION"]),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(999),
  })).min(1, "El pedido requiere al menos un artículo").max(100),
}).superRefine((value, ctx) => {
  const tieneId = value.cliente_id != null;
  const tieneContacto = value.cliente != null;
  if (tieneId === tieneContacto) {
    ctx.addIssue({
      code: "custom",
      path: ["cliente_id"],
      message: "Indica un cliente registrado o datos de contacto, pero no ambos.",
    });
  }
  if (value.tipo_entrega === "ENVIO" && tieneContacto
      && !String(value.cliente.direccion || "").trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["cliente", "direccion"],
      message: "La entrega a domicilio requiere una dirección.",
    });
  }
});
const pedidosQuerySchema = z.object({
  estado: z.enum(["RESERVADO", "LISTO", "COMPLETADO", "CANCELADO", "EXPIRADO"])
    .optional(),
  cliente_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(160).optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});
const cancelacionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
const accionVaciaSchema = z.object({}).strict();
const expiracionesSchema = z.object({
  limite: z.number().int().positive().max(100).optional().default(100),
});

router.get("/", validate(pedidosQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarPedidos({ query }, {
      estado: req.query.estado || null,
      clienteId: req.query.cliente_id || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/", validate(pedidoCreateSchema), async (req, res, next) => {
  try {
    const clave = getIdempotencyKey(req);
    const items = compactarItems(req.body.items, "producto_id");
    const solicitud = {
      cliente_id: req.body.cliente_id ?? null,
      cliente: req.body.cliente ?? null,
      tipo_entrega: req.body.tipo_entrega,
      notas: req.body.notas ?? null,
      items,
    };
    const solicitudHash = hashRequest(solicitud);
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "PEDIDO_INTERNO",
        clave,
        solicitudHash,
      });
      if (claim.replay) {
        return { replay: true, pedido: await cargarPedido(client, claim.resourceId) };
      }
      const pedido = await crearPedidoReservado(client, {
        usuarioId: req.user.sub,
        clienteId: req.body.cliente_id ?? null,
        cliente: req.body.cliente ?? null,
        tipoEntrega: req.body.tipo_entrega,
        notas: req.body.notas ?? null,
        items,
      });
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "PEDIDO_INTERNO",
        clave,
        recursoTipo: "pedido",
        recursoId: pedido.id,
      });
      return { replay: false, pedido };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.pedido);
  } catch (error) { next(error); }
});

router.post(
  "/expiraciones/procesar",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(expiracionesSchema),
  async (req, res, next) => {
    try {
      const ids = await tx((client) => expirarPedidosVencidos(client, {
        limit: req.body.limite,
      }));
      res.json({ procesados: ids.length, pedidos: ids });
    } catch (error) { next(error); }
  }
);

router.post(
  "/:id/listo",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(accionVaciaSchema),
  async (req, res, next) => {
    try {
      const pedidoId = idPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitudHash = hashRequest({ pedido_id: pedidoId });
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "PEDIDO_LISTO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, pedido: await cargarPedido(client, claim.resourceId) };
        }
        const pedido = await marcarPedidoListo(client, {
          pedidoId,
          usuarioId: req.user.sub,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "PEDIDO_LISTO",
          clave,
          recursoTipo: "pedido",
          recursoId: pedido.id,
        });
        return { replay: false, pedido };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.pedido);
    } catch (error) { next(error); }
  }
);

router.post(
  "/:id/cancelacion",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(cancelacionSchema),
  async (req, res, next) => {
    try {
      const pedidoId = idPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitudHash = hashRequest({
        pedido_id: pedidoId,
        motivo: req.body.motivo,
      });
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_PEDIDO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, pedido: await cargarPedido(client, claim.resourceId) };
        }
        const pedido = await cancelarPedido(client, {
          pedidoId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_PEDIDO",
          clave,
          recursoTipo: "pedido",
          recursoId: pedido.id,
        });
        return { replay: false, pedido };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.pedido);
    } catch (error) { next(error); }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    res.json(await cargarPedido({ query }, idPositivo(req.params.id)));
  } catch (error) { next(error); }
});

module.exports = router;
