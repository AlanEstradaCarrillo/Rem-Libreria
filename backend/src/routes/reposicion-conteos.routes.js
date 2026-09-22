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
  idPositivo,
  cargarPoliticaReposicion,
  guardarPoliticaReposicion,
  listarSugerenciasReposicion,
  cargarConteoInventario,
  listarConteosInventario,
  crearConteoInventario,
  capturarConteoInventario,
  aplicarConteoInventario,
  cancelarConteoInventario,
} = require("../services/reposicion-conteos.service");
const { z } = require("zod");

router.use(requireAuth);
const requireSupervisor = requireRoles("ADMIN", "SUPERVISOR");
router.use("/reposicion", requireSupervisor);
router.use("/conteos", requireSupervisor);

const politicaSchema = z.object({
  stock_minimo: z.number().int().min(0).max(1000000),
  stock_objetivo: z.number().int().min(0).max(1000000),
  proveedor_preferido_id: z.number().int().positive().optional().nullable(),
  motivo: z.string().trim().min(3).max(240),
}).refine((value) => value.stock_objetivo >= value.stock_minimo, {
  path: ["stock_objetivo"],
  message: "El objetivo debe ser igual o mayor que el mínimo",
});

const sugerenciasQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  proveedor_id: z.coerce.number().int().positive().optional(),
  solo_sugeridos: z.enum(["true", "false"]).optional().default("true")
    .transform((value) => value === "true"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(100),
});

router.get(
  "/reposicion/sugerencias",
  validate(sugerenciasQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await listarSugerenciasReposicion({ query }, {
        q: req.query.q,
        proveedorId: req.query.proveedor_id || null,
        soloSugeridos: req.query.solo_sugeridos,
        page: req.query.page,
        limit: req.query.limit,
      }));
    } catch (error) { next(error); }
  }
);

router.get("/reposicion/productos/:id", async (req, res, next) => {
  try {
    res.json(await cargarPoliticaReposicion({ query }, idPositivo(req.params.id, "producto_id")));
  } catch (error) { next(error); }
});

router.put(
  "/reposicion/productos/:id",
  validate(politicaSchema),
  async (req, res, next) => {
    try {
      const productoId = idPositivo(req.params.id, "producto_id");
      const clave = getIdempotencyKey(req);
      const solicitud = {
        producto_id: productoId,
        stock_minimo: req.body.stock_minimo,
        stock_objetivo: req.body.stock_objetivo,
        proveedor_preferido_id: req.body.proveedor_preferido_id ?? null,
        motivo: req.body.motivo,
      };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "POLITICA_REPOSICION",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, politica: await cargarPoliticaReposicion(client, claim.resourceId) };
        }
        const politica = await guardarPoliticaReposicion(client, {
          productoId,
          stockMinimo: req.body.stock_minimo,
          stockObjetivo: req.body.stock_objetivo,
          proveedorPreferidoId: req.body.proveedor_preferido_id ?? null,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `POLITICA_REPOSICION:${productoId}:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "POLITICA_REPOSICION",
          clave,
          recursoTipo: "politica_reposicion",
          recursoId: productoId,
        });
        return { replay: false, politica };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.politica);
    } catch (error) { next(error); }
  }
);

const conteosQuerySchema = z.object({
  estado: z.enum(["BORRADOR", "APLICADO", "CANCELADO"]).optional(),
  q: z.string().trim().max(160).optional().default(""),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});
const conteoCreateSchema = z.object({
  producto_ids: z.array(z.number().int().positive()).min(1).max(500),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
});
const capturaSchema = z.object({
  items: z.array(z.object({
    detalle_conteo_id: z.number().int().positive(),
    cantidad_contada: z.number().int().min(0).max(1000000),
  })).min(1).max(500),
});
const motivoSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
});

function itemsCapturaCanonicos(items) {
  return [...items]
    .map((item) => ({ ...item }))
    .sort((a, b) => a.detalle_conteo_id - b.detalle_conteo_id);
}

router.get("/conteos", validate(conteosQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarConteosInventario({ query }, {
      estado: req.query.estado || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/conteos", validate(conteoCreateSchema), async (req, res, next) => {
  try {
    const productoIds = [...new Set(req.body.producto_ids)].sort((a, b) => a - b);
    if (productoIds.length !== req.body.producto_ids.length) {
      return res.status(400).json({ error: "No repitas productos en el conteo." });
    }
    const clave = getIdempotencyKey(req);
    const solicitud = { producto_ids: productoIds, notas: req.body.notas ?? null };
    const solicitudHash = hashRequest(solicitud);
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "CREACION_CONTEO",
        clave,
        solicitudHash,
      });
      if (claim.replay) {
        return { replay: true, conteo: await cargarConteoInventario(client, claim.resourceId) };
      }
      const conteo = await crearConteoInventario(client, {
        productoIds,
        notas: req.body.notas ?? null,
        usuarioId: req.user.sub,
        origenClave: `CONTEO:CREACION:${clave}`,
      });
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "CREACION_CONTEO",
        clave,
        recursoTipo: "conteo_inventario",
        recursoId: conteo.id,
      });
      return { replay: false, conteo };
    });
    res.status(resultado.replay ? 200 : 201).json(resultado.conteo);
  } catch (error) { next(error); }
});

router.get("/conteos/:id", async (req, res, next) => {
  try {
    res.json(await cargarConteoInventario({ query }, idPositivo(req.params.id, "conteo_inventario_id")));
  } catch (error) { next(error); }
});

router.put(
  "/conteos/:id/capturas",
  validate(capturaSchema),
  async (req, res, next) => {
    try {
      const conteoId = idPositivo(req.params.id, "conteo_inventario_id");
      const items = itemsCapturaCanonicos(req.body.items);
      if (new Set(items.map((item) => item.detalle_conteo_id)).size !== items.length) {
        return res.status(400).json({ error: "No repitas partidas en una captura." });
      }
      const clave = getIdempotencyKey(req);
      const solicitud = { conteo_inventario_id: conteoId, items };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CAPTURA_CONTEO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, conteo: await cargarConteoInventario(client, claim.resourceId) };
        }
        const conteo = await capturarConteoInventario(client, {
          conteoId,
          items,
          usuarioId: req.user.sub,
          origenClave: `CONTEO:${conteoId}:CAPTURA:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CAPTURA_CONTEO",
          clave,
          recursoTipo: "conteo_inventario",
          recursoId: conteo.id,
        });
        return { replay: false, conteo };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.conteo);
    } catch (error) { next(error); }
  }
);

router.post(
  "/conteos/:id/aplicacion",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const conteoId = idPositivo(req.params.id, "conteo_inventario_id");
      const clave = getIdempotencyKey(req);
      const solicitud = { conteo_inventario_id: conteoId, motivo: req.body.motivo };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "APLICACION_CONTEO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, conteo: await cargarConteoInventario(client, claim.resourceId) };
        }
        const conteo = await aplicarConteoInventario(client, {
          conteoId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `CONTEO:${conteoId}:APLICACION:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "APLICACION_CONTEO",
          clave,
          recursoTipo: "conteo_inventario",
          recursoId: conteo.id,
        });
        return { replay: false, conteo };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.conteo);
    } catch (error) { next(error); }
  }
);

router.post(
  "/conteos/:id/cancelacion",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const conteoId = idPositivo(req.params.id, "conteo_inventario_id");
      const clave = getIdempotencyKey(req);
      const solicitud = { conteo_inventario_id: conteoId, motivo: req.body.motivo };
      const solicitudHash = hashRequest(solicitud);
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_CONTEO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, conteo: await cargarConteoInventario(client, claim.resourceId) };
        }
        const conteo = await cancelarConteoInventario(client, {
          conteoId,
          usuarioId: req.user.sub,
          motivo: req.body.motivo,
          origenClave: `CONTEO:${conteoId}:CANCELACION:${clave}`,
        });
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_CONTEO",
          clave,
          recursoTipo: "conteo_inventario",
          recursoId: conteo.id,
        });
        return { replay: false, conteo };
      });
      res.status(resultado.replay ? 200 : 201).json(resultado.conteo);
    } catch (error) { next(error); }
  }
);

module.exports = router;
