const router = require("express").Router();
const { tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const {
  iniciarLecturaConsistente,
  obtenerFiltrosReportes,
  reporteVentas,
  reporteInventario,
  reporteCompras,
  reportePedidos,
  reporteCaja,
  exportarReporte,
} = require("../services/reportes.service");
const { z } = require("zod");

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(requireAuth, requireRoles("ADMIN", "SUPERVISOR"));

const instantSchema = z.string().datetime({ offset: true });
const zonaHorariaSchema = z.string().trim().min(1).max(64)
  .regex(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/, "Usa una zona horaria IANA válida")
  .optional().default("America/Mexico_City");
const intIdSchema = z.coerce.number().int().safe().positive().max(2147483647);
const bigintIdSchema = z.coerce.number().int().safe().positive().max(Number.MAX_SAFE_INTEGER);
const pageSchema = z.coerce.number().int().safe().positive().max(100000).optional().default(1);
const limitSchema = z.coerce.number().int().positive().max(100).optional().default(30);

function schemaPeriodo(campos = {}) {
  return z.object({
    desde: instantSchema,
    hasta: instantSchema,
    zona_horaria: zonaHorariaSchema,
    ...campos,
  }).superRefine((value, ctx) => {
    const desde = Date.parse(value.desde);
    const hasta = Date.parse(value.hasta);
    if (hasta <= desde) {
      ctx.addIssue({ code: "custom", path: ["hasta"], message: "Debe ser posterior a desde" });
    } else if (hasta - desde > 366 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", path: ["hasta"], message: "El periodo máximo es de 366 días" });
    }
  });
}

const ventasQuerySchema = schemaPeriodo({
  caja_id: intIdSchema.optional(),
  usuario_id: intIdSchema.optional(),
  metodo_pago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]).optional(),
  canal: z.enum(["POS", "WEB", "CONSIGNACION"]).optional(),
  page: pageSchema,
  limit: limitSchema,
});

const inventarioQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  categoria_id: intIdSchema.optional(),
  estado: z.enum([
    "BAJO_MINIMO", "SIN_EXISTENCIA", "CON_RESERVA", "CON_CONSIGNACION", "SIN_POLITICA",
  ]).optional(),
  publicado_web: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  activo: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  proveedor_id: bigintIdSchema.optional(),
  page: pageSchema,
  limit: limitSchema,
});

const comprasQuerySchema = schemaPeriodo({
  proveedor_id: bigintIdSchema.optional(),
  page: pageSchema,
  limit: limitSchema,
});

const pedidosQuerySchema = schemaPeriodo({
  canal: z.enum(["WEB", "INTERNO"]).optional(),
  estado: z.enum(["RESERVADO", "LISTO", "COMPLETADO", "CANCELADO", "EXPIRADO"]).optional(),
  tipo_entrega: z.enum(["ENVIO", "RECOLECCION"]).optional(),
  page: pageSchema,
  limit: limitSchema,
});

const cajaQuerySchema = schemaPeriodo({
  caja_id: intIdSchema.optional(),
  usuario_id: intIdSchema.optional(),
  operador_id: intIdSchema.optional(),
  page: pageSchema,
  limit: limitSchema,
});

async function lecturaConsistente(fn) {
  return tx(async (client) => {
    await iniciarLecturaConsistente(client);
    let cola = Promise.resolve();
    const lector = {
      query(...args) {
        const consulta = cola.then(() => client.query(...args));
        cola = consulta.then(() => undefined, () => undefined);
        return consulta;
      },
    };
    return fn(lector);
  });
}

function periodoDesdeQuery(query) {
  return {
    desde: query.desde,
    hasta: query.hasta,
    zonaHoraria: query.zona_horaria,
  };
}

function filtrosVentas(query) {
  return {
    ...periodoDesdeQuery(query),
    cajaId: query.caja_id || null,
    usuarioId: query.usuario_id || null,
    metodoPago: query.metodo_pago || null,
    canal: query.canal || null,
    page: query.page,
    limit: query.limit,
  };
}

function filtrosInventario(query) {
  return {
    q: query.q,
    categoriaId: query.categoria_id || null,
    estado: query.estado || null,
    publicadoWeb: query.publicado_web,
    activo: query.activo,
    proveedorId: query.proveedor_id || null,
    page: query.page,
    limit: query.limit,
  };
}

function filtrosCompras(query) {
  return {
    ...periodoDesdeQuery(query),
    proveedorId: query.proveedor_id || null,
    page: query.page,
    limit: query.limit,
  };
}

function filtrosPedidos(query) {
  return {
    ...periodoDesdeQuery(query),
    canal: query.canal || null,
    estado: query.estado || null,
    tipoEntrega: query.tipo_entrega || null,
    page: query.page,
    limit: query.limit,
  };
}

function filtrosCaja(query) {
  return {
    ...periodoDesdeQuery(query),
    cajaId: query.caja_id || null,
    usuarioId: query.usuario_id || null,
    operadorId: query.operador_id || null,
    page: query.page,
    limit: query.limit,
  };
}

router.get("/filtros", async (req, res, next) => {
  try {
    res.json(await lecturaConsistente(obtenerFiltrosReportes));
  } catch (error) { next(error); }
});

router.get("/ventas", validate(ventasQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await lecturaConsistente((client) => reporteVentas(client, filtrosVentas(req.query))));
  } catch (error) { next(error); }
});

router.get("/inventario", validate(inventarioQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await lecturaConsistente((client) => reporteInventario(client, filtrosInventario(req.query))));
  } catch (error) { next(error); }
});

router.get("/compras", validate(comprasQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await lecturaConsistente((client) => reporteCompras(client, filtrosCompras(req.query))));
  } catch (error) { next(error); }
});

router.get("/pedidos", validate(pedidosQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await lecturaConsistente((client) => reportePedidos(client, filtrosPedidos(req.query))));
  } catch (error) { next(error); }
});

router.get("/caja", validate(cajaQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await lecturaConsistente((client) => reporteCaja(client, filtrosCaja(req.query))));
  } catch (error) { next(error); }
});

function enviarCsv(res, resultado) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${resultado.nombre}"`);
  res.setHeader("X-Exported-Rows", String(resultado.filas));
  res.send("\uFEFF" + resultado.contenido);
}

router.get("/exportaciones/ventas", validate(ventasQuerySchema, "query"), async (req, res, next) => {
  try {
    enviarCsv(res, await lecturaConsistente(
      (client) => exportarReporte(client, "ventas", filtrosVentas(req.query))
    ));
  } catch (error) { next(error); }
});

router.get("/exportaciones/inventario", validate(inventarioQuerySchema, "query"), async (req, res, next) => {
  try {
    enviarCsv(res, await lecturaConsistente(
      (client) => exportarReporte(client, "inventario", filtrosInventario(req.query))
    ));
  } catch (error) { next(error); }
});

router.get("/exportaciones/compras", validate(comprasQuerySchema, "query"), async (req, res, next) => {
  try {
    enviarCsv(res, await lecturaConsistente(
      (client) => exportarReporte(client, "compras", filtrosCompras(req.query))
    ));
  } catch (error) { next(error); }
});

router.get("/exportaciones/pedidos", validate(pedidosQuerySchema, "query"), async (req, res, next) => {
  try {
    enviarCsv(res, await lecturaConsistente(
      (client) => exportarReporte(client, "pedidos", filtrosPedidos(req.query))
    ));
  } catch (error) { next(error); }
});

router.get("/exportaciones/caja", validate(cajaQuerySchema, "query"), async (req, res, next) => {
  try {
    enviarCsv(res, await lecturaConsistente(
      (client) => exportarReporte(client, "caja", filtrosCaja(req.query))
    ));
  } catch (error) { next(error); }
});

module.exports = router;
