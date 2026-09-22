const crypto = require("node:crypto");
const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { ApiError } = require("../utils/errors");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const { compactarItems, cotizar } = require("../services/precios.service");
const { enriquecerProductos } = require("../services/catalogo-bibliografico.service");
const {
  cargarPedido,
  crearPedidoReservado,
  cancelarPedido,
  expirarPedidosVencidos,
} = require("../services/pedidos.service");
const { z } = require("zod");

const slugSchema = z.string().trim().min(1).max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido.");
const itemsSchema = z.array(z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive().max(999),
})).min(1, "Se requiere al menos un artículo").max(100);
const productosQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  categoria_slug: slugSchema.optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(24),
});
const cotizacionSchema = z.object({ items: itemsSchema }).strict();
const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLowerCase());
const telefonoSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s.-]+$/, "El teléfono contiene caracteres inválidos.");
const contactoSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  telefono: telefonoSchema,
  email: emailSchema.optional().nullable(),
  direccion: z.string().trim().min(3).max(2000).optional().nullable(),
}).strict();
const pedidoCreateSchema = z.object({
  cliente: contactoSchema,
  tipo_entrega: z.enum(["ENVIO", "RECOLECCION"]),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
  items: itemsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.tipo_entrega === "ENVIO" && !String(value.cliente.direccion || "").trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["cliente", "direccion"],
      message: "La entrega a domicilio requiere una dirección.",
    });
  }
});
const cancelacionSchema = z.object({
  motivo: z.string().trim().min(3).max(240),
}).strict();

function actorPublico(req) {
  const token = String(req.get("X-Cart-Token") || "").trim();
  if (token.length < 16 || token.length > 200 || !/^[\x21-\x7E]+$/.test(token)) {
    throw new ApiError(400, "Encabezado X-Cart-Token requerido (16 a 200 caracteres opacos).");
  }
  const hash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  return `PUBLICO:${hash}`;
}

function folioPedido(value) {
  const folio = String(value || "").trim().toUpperCase();
  if (!/^P-[0-9]{10}$/.test(folio)) throw new ApiError(400, "Folio de pedido inválido.");
  return folio;
}

function numeroWhatsapp() {
  const digits = String(process.env.STORE_WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
  return /^[0-9]{8,15}$/.test(digits) ? digits : null;
}

function whatsappUrl(pedido) {
  const number = numeroWhatsapp();
  if (!number) return null;
  const text = [
    `Hola, quiero dar seguimiento al pedido ${pedido.folio}.`,
    `Estado: ${pedido.estado}.`,
    `Total: $${Number(pedido.total).toFixed(2)} MXN.`,
    `Entrega: ${pedido.tipo_entrega === "ENVIO" ? "envío" : "recolección en tienda"}.`,
  ].join(" ");
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function serializarPedidoPublico(pedido) {
  return {
    folio: pedido.folio,
    estado: pedido.estado,
    cliente_nombre: pedido.cliente_nombre,
    cliente_telefono: pedido.cliente_telefono,
    cliente_email: pedido.cliente_email,
    cliente_direccion: pedido.cliente_direccion,
    tipo_entrega: pedido.tipo_entrega,
    notas: pedido.notas,
    subtotal: pedido.subtotal,
    descuento: pedido.descuento,
    iva: pedido.iva,
    total: pedido.total,
    expira_en: pedido.expira_en,
    creado_en: pedido.creado_en,
    detalle: pedido.detalle.map((linea) => ({
      producto_id: linea.producto_id,
      producto_sku: linea.producto_sku,
      producto_titulo: linea.producto_titulo,
      cantidad: linea.cantidad,
      precio_lista: linea.precio_lista,
      descuento_unitario: linea.descuento_unitario,
      precio_unitario: linea.precio_unitario,
      iva_porcentaje: linea.iva_porcentaje,
      importe: linea.importe,
    })),
    transiciones: pedido.transiciones.map((transicion) => ({
      estado_anterior: transicion.estado_anterior,
      estado_nuevo: transicion.estado_nuevo,
      motivo: transicion.motivo,
      creado_en: transicion.creado_en,
    })),
    whatsapp_url: whatsappUrl(pedido),
  };
}

async function procesarExpiracionesPerezosas() {
  const batchSize = 100;
  for (let batch = 0; batch < 3; batch += 1) {
    const ids = await tx((client) => expirarPedidosVencidos(client, { limit: batchSize }));
    if (ids.length < batchSize) return;
  }
}

async function idPedidoPublico(db, { folio = null, pedidoId = null, actorClave, lock = false }) {
  const result = await db.query(
    `SELECT id FROM pedidos
     WHERE canal='WEB'
       AND publico_actor_clave=$1
       AND ($2::text IS NULL OR folio=$2)
       AND ($3::bigint IS NULL OR id=$3)
     ${lock ? "FOR UPDATE" : ""}`,
    [actorClave, folio, pedidoId]
  );
  if (!result.rows[0]) throw new ApiError(404, "Pedido no encontrado.");
  return Number(result.rows[0].id);
}

async function cargarPedidoPublico(db, criteria) {
  const id = await idPedidoPublico(db, criteria);
  return cargarPedido(db, id);
}

async function validarProductosPublicos(db, items) {
  const compactados = compactarItems(items, "producto_id");
  const result = await db.query(
    `SELECT p.id
     FROM productos p
     LEFT JOIN categorias c ON c.id=p.categoria_id
     WHERE p.id=ANY($1::int[])
       AND p.activo AND p.publicado_web
       AND (p.categoria_id IS NULL OR c.activo)`,
    [compactados.map((item) => item.producto_id)]
  );
  if (result.rowCount !== compactados.length) {
    throw new ApiError(404, "Uno o más productos no están disponibles en la tienda.");
  }
  return compactados;
}

router.get("/config", (req, res) => {
  res.json({
    nombre: "Librería REM",
    moneda: "MXN",
    whatsapp_disponible: Boolean(numeroWhatsapp()),
    tipos_entrega: ["ENVIO", "RECOLECCION"],
  });
});

router.get("/categorias", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.id, c.nombre, c.slug, c.descripcion, c.orden
       FROM categorias c
       WHERE c.activo
         AND EXISTS (
           SELECT 1 FROM productos p
           WHERE p.categoria_id=c.id AND p.activo AND p.publicado_web
         )
       ORDER BY c.orden, c.nombre, c.id`
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

router.get("/productos", validate(productosQuerySchema, "query"), async (req, res, next) => {
  try {
    await procesarExpiracionesPerezosas();
    const offset = (req.query.page - 1) * req.query.limit;
    const result = await query(
      `SELECT p.id, p.sku, p.slug, p.isbn, p.isbn_normalizado,
              p.titulo, p.subtitulo, p.autor, p.editorial,
              p.edicion, p.anio_publicacion, p.idioma, p.numero_paginas,
              p.encuadernacion, p.formato, p.coleccion, p.serie, p.volumen,
              p.descripcion_comercial, p.categoria_id,
              c.nombre AS categoria, c.slug AS categoria_slug,
              principal.url AS imagen_principal,
              precio.precio_lista, precio.descuento_unitario,
              precio.precio_unitario, p.stock_disponible AS disponible
       FROM productos p
       LEFT JOIN categorias c ON c.id=p.categoria_id
       LEFT JOIN LATERAL (
         SELECT pi.url FROM producto_imagenes pi
         WHERE pi.producto_id=p.id AND pi.principal
         LIMIT 1
       ) principal ON TRUE
       CROSS JOIN LATERAL calcular_precio_comun(p.id,1,'WEB',NOW()) precio
       WHERE p.activo AND p.publicado_web
         AND (p.categoria_id IS NULL OR c.activo)
         AND ($1::text='' OR c.slug=$1)
         AND (
           $2::text=''
            OR to_tsvector(
                 'spanish',
                 p.titulo || ' ' || COALESCE(p.subtitulo, '') || ' ' ||
                 COALESCE(p.autor, '') || ' ' || COALESCE(p.editorial, '') || ' ' ||
                 COALESCE(p.coleccion, '') || ' ' || COALESCE(p.serie, '')
               ) @@ plainto_tsquery('spanish', $2)
            OR p.titulo ILIKE '%' || $2 || '%'
            OR COALESCE(p.autor, '') ILIKE '%' || $2 || '%'
            OR COALESCE(p.isbn, '') ILIKE '%' || $2 || '%'
            OR p.isbn_normalizado = isbn_normalizado_valido_catalogo($2)
            OR EXISTS (
              SELECT 1 FROM producto_contribuyentes pc
              WHERE pc.producto_id=p.id AND pc.nombre ILIKE '%' || $2 || '%'
            )
            OR EXISTS (
              SELECT 1 FROM producto_materias pm
              JOIN materias m ON m.id=pm.materia_id
              WHERE pm.producto_id=p.id AND m.nombre ILIKE '%' || $2 || '%'
            )
         )
       ORDER BY p.titulo, p.id
       LIMIT $3 OFFSET $4`,
      [req.query.categoria_slug || "", req.query.q, req.query.limit, offset]
    );
    const products = await enriquecerProductos({ query }, result.rows);
    res.json({ page: req.query.page, limit: req.query.limit, resultados: products });
  } catch (error) { next(error); }
});

router.get("/productos/:slug", async (req, res, next) => {
  try {
    const slug = slugSchema.parse(req.params.slug);
    await procesarExpiracionesPerezosas();
    const result = await query(
      `SELECT p.id, p.sku, p.slug, p.isbn, p.isbn_normalizado,
              p.titulo, p.subtitulo, p.autor, p.editorial,
              p.edicion, p.anio_publicacion, p.idioma, p.numero_paginas,
              p.encuadernacion, p.formato, p.coleccion, p.serie, p.volumen,
              p.descripcion_comercial, p.categoria_id,
              c.nombre AS categoria, c.slug AS categoria_slug,
              principal.url AS imagen_principal,
              precio.precio_lista, precio.descuento_unitario,
              precio.precio_unitario, p.stock_disponible AS disponible
       FROM productos p
       LEFT JOIN categorias c ON c.id=p.categoria_id
       LEFT JOIN LATERAL (
         SELECT pi.url FROM producto_imagenes pi
         WHERE pi.producto_id=p.id AND pi.principal
         LIMIT 1
       ) principal ON TRUE
       CROSS JOIN LATERAL calcular_precio_comun(p.id,1,'WEB',NOW()) precio
       WHERE p.slug=$1 AND p.activo AND p.publicado_web
         AND (p.categoria_id IS NULL OR c.activo)`,
      [slug]
    );
    if (!result.rows[0]) throw new ApiError(404, "Producto no encontrado.");
    const images = await query(
      `SELECT url, texto_alternativo, orden, principal
       FROM producto_imagenes WHERE producto_id=$1 ORDER BY orden, id`,
      [result.rows[0].id]
    );
    const [product] = await enriquecerProductos({ query }, result.rows);
    res.json({ ...product, imagenes: images.rows });
  } catch (error) {
    if (error instanceof z.ZodError) return next(new ApiError(400, "Slug de producto inválido."));
    next(error);
  }
});

router.post("/cotizar", validate(cotizacionSchema), async (req, res, next) => {
  try {
    await procesarExpiracionesPerezosas();
    const items = await validarProductosPublicos({ query }, req.body.items);
    const quote = await cotizar({ query }, { items, canal: "WEB" });
    const balances = await query(
      `SELECT id, stock_disponible FROM productos WHERE id=ANY($1::int[])`,
      [items.map((item) => item.producto_id)]
    );
    const available = new Map(
      balances.rows.map((row) => [Number(row.id), Number(row.stock_disponible)])
    );
    quote.lineas = quote.lineas.map((linea) => ({
      ...linea,
      disponible: available.get(Number(linea.producto_id)) || 0,
      disponible_suficiente:
        (available.get(Number(linea.producto_id)) || 0) >= Number(linea.cantidad),
    }));
    res.json(quote);
  } catch (error) { next(error); }
});

router.post("/pedidos", validate(pedidoCreateSchema), async (req, res, next) => {
  try {
    const actorClave = actorPublico(req);
    const clave = getIdempotencyKey(req);
    await procesarExpiracionesPerezosas();
    const items = compactarItems(req.body.items, "producto_id");
    const solicitud = {
      cliente: req.body.cliente,
      tipo_entrega: req.body.tipo_entrega,
      notas: req.body.notas ?? null,
      items,
    };
    const solicitudHash = hashRequest(solicitud);
    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        actorClave,
        operacion: "PEDIDO_WEB",
        clave,
        solicitudHash,
      });
      if (claim.replay) {
        return {
          replay: true,
          pedido: await cargarPedidoPublico(client, {
            pedidoId: claim.resourceId,
            actorClave,
          }),
        };
      }
      const pedido = await crearPedidoReservado(client, {
        canal: "WEB",
        actorClave,
        cliente: req.body.cliente,
        tipoEntrega: req.body.tipo_entrega,
        notas: req.body.notas ?? null,
        items,
      });
      await completeOperation(client, {
        actorClave,
        operacion: "PEDIDO_WEB",
        clave,
        recursoTipo: "pedido",
        recursoId: pedido.id,
      });
      return { replay: false, pedido };
    });
    res.status(resultado.replay ? 200 : 201).json(serializarPedidoPublico(resultado.pedido));
  } catch (error) { next(error); }
});

router.get("/pedidos/:folio", async (req, res, next) => {
  try {
    const actorClave = actorPublico(req);
    const folio = folioPedido(req.params.folio);
    await procesarExpiracionesPerezosas();
    const pedido = await cargarPedidoPublico({ query }, { folio, actorClave });
    res.json(serializarPedidoPublico(pedido));
  } catch (error) { next(error); }
});

router.post(
  "/pedidos/:folio/cancelacion",
  validate(cancelacionSchema),
  async (req, res, next) => {
    try {
      const actorClave = actorPublico(req);
      const clave = getIdempotencyKey(req);
      const folio = folioPedido(req.params.folio);
      await procesarExpiracionesPerezosas();
      const solicitudHash = hashRequest({ folio, motivo: req.body.motivo });
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          actorClave,
          operacion: "CANCELACION_PEDIDO_WEB",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return {
            replay: true,
            pedido: await cargarPedidoPublico(client, {
              pedidoId: claim.resourceId,
              actorClave,
            }),
          };
        }
        const pedidoId = await idPedidoPublico(client, {
          folio,
          actorClave,
          lock: true,
        });
        const pedido = await cancelarPedido(client, {
          pedidoId,
          actor: "PUBLICO",
          motivo: req.body.motivo,
        });
        await completeOperation(client, {
          actorClave,
          operacion: "CANCELACION_PEDIDO_WEB",
          clave,
          recursoTipo: "pedido",
          recursoId: pedido.id,
        });
        return { replay: false, pedido };
      });
      res.status(resultado.replay ? 200 : 201).json(serializarPedidoPublico(resultado.pedido));
    } catch (error) { next(error); }
  }
);

module.exports = router;
