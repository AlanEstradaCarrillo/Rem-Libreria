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
  idCotizacionPositivo,
  cargarCotizacion,
  listarCotizaciones,
  crearCotizacion,
  crearPedidoDesdeCotizacion,
  cargarConversionPorPedido,
  cancelarCotizacion,
  expirarCotizacionesVencidas,
} = require("../services/cotizaciones.service");
const { z } = require("zod");

router.use(requireAuth);

const cotizacionCreateSchema = z.object({
  cliente_id: z.number().int().positive(),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
  vigencia_dias: z.number().int().min(1).max(90).optional().default(7),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(999),
  })).min(1, "La cotización requiere al menos un artículo").max(100),
});
const cotizacionesQuerySchema = z.object({
  estado: z.enum(["VIGENTE", "CONVERTIDA", "CANCELADA", "VENCIDA"]).optional(),
  cliente_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(160).optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});
const conversionSchema = z.object({
  tipo_entrega: z.enum(["ENVIO", "RECOLECCION"]).optional().default("RECOLECCION"),
});
const cancelacionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});
const expiracionesSchema = z.object({
  limite: z.number().int().positive().max(100).optional().default(100),
});

router.get("/", validate(cotizacionesQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarCotizaciones({ query }, {
      estado: req.query.estado || null,
      clienteId: req.query.cliente_id || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/", validate(cotizacionCreateSchema), async (req, res, next) => {
  try {
    const clave = getIdempotencyKey(req);
    const items = compactarItems(req.body.items, "producto_id");
    const solicitud = {
      cliente_id: req.body.cliente_id,
      notas: req.body.notas ?? null,
      vigencia_dias: req.body.vigencia_dias,
      items,
    };
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "COTIZACION_ALTA",
        clave,
        solicitudHash: hashRequest(solicitud),
      });
      if (claim.replay) {
        return { replay: true, cotizacion: await cargarCotizacion(client, claim.resourceId) };
      }
      const cotizacion = await crearCotizacion(client, {
        usuarioId: req.user.sub,
        clienteId: req.body.cliente_id,
        items,
        notas: req.body.notas ?? null,
        vigenciaDias: req.body.vigencia_dias,
      });
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "COTIZACION_ALTA",
        clave,
        recursoTipo: "cotizacion",
        recursoId: cotizacion.id,
      });
      return { replay: false, cotizacion };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.cotizacion);
  } catch (error) { next(error); }
});

router.post(
  "/expiraciones/procesar",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(expiracionesSchema),
  async (req, res, next) => {
    try {
      const ids = await tx((client) => expirarCotizacionesVencidas(client, {
        limit: req.body.limite,
      }));
      res.json({ procesadas: ids.length, cotizaciones: ids });
    } catch (error) { next(error); }
  }
);

router.post("/:id/conversion", validate(conversionSchema), async (req, res, next) => {
  try {
    const cotizacionId = idCotizacionPositivo(req.params.id);
    const clave = getIdempotencyKey(req);
    const solicitud = {
      cotizacion_id: cotizacionId,
      tipo_entrega: req.body.tipo_entrega,
    };
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "CONVERSION_COTIZACION",
        clave,
        solicitudHash: hashRequest(solicitud),
      });
      if (claim.replay) {
        return {
          replay: true,
          conversion: await cargarConversionPorPedido(client, claim.resourceId),
        };
      }
      const conversion = await crearPedidoDesdeCotizacion(client, {
        cotizacionId,
        usuarioId: req.user.sub,
        tipoEntrega: req.body.tipo_entrega,
      });
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "CONVERSION_COTIZACION",
        clave,
        recursoTipo: "pedido",
        recursoId: conversion.pedido.id,
      });
      return { replay: false, conversion };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.conversion);
  } catch (error) { next(error); }
});

router.post(
  "/:id/cancelacion",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(cancelacionSchema),
  async (req, res, next) => {
    try {
      const cotizacionId = idCotizacionPositivo(req.params.id);
      const clave = getIdempotencyKey(req);
      const solicitud = {
        cotizacion_id: cotizacionId,
        motivo: req.body.motivo,
      };
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_COTIZACION",
          clave,
          solicitudHash: hashRequest(solicitud),
        });
        if (claim.replay) {
          return { replay: true, cotizacion: await cargarCotizacion(client, claim.resourceId) };
        }
        const cotizacion = await cancelarCotizacion(client, {
          cotizacionId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_COTIZACION",
          clave,
          recursoTipo: "cotizacion",
          recursoId: cotizacion.id,
        });
        return { replay: false, cotizacion };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.cotizacion);
    } catch (error) { next(error); }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    res.json(await cargarCotizacion({ query }, idCotizacionPositivo(req.params.id)));
  } catch (error) { next(error); }
});

module.exports = router;
