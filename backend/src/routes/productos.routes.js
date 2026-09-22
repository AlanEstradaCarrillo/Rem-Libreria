// backend/src/routes/productos.routes.js — catálogo e inventario
const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { aplicarMovimiento } = require("../services/inventario.service");
const { parsePositiveId } = require("../services/caja.service");
const {
  normalizarIsbn,
  enriquecerProductos,
  reemplazarContribuyentes,
  reemplazarMaterias,
} = require("../services/catalogo-bibliografico.service");
const { z } = require("zod");

router.use(requireAuth);

function productoParaRespuesta(producto, user) {
  if (["ADMIN", "SUPERVISOR"].includes(user.rol)) return producto;
  const { costo, ...visible } = producto;
  return visible;
}

const slugSchema = z.string().trim().min(1).max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones.");

async function cargarProducto(db, productoId) {
  const producto = await db.query(
    `SELECT p.*, c.nombre AS categoria, principal.url AS imagen_principal
     FROM productos p
     LEFT JOIN categorias c ON c.id=p.categoria_id
     LEFT JOIN LATERAL (
       SELECT pi.url FROM producto_imagenes pi
       WHERE pi.producto_id=p.id AND pi.principal
       LIMIT 1
     ) principal ON TRUE
     WHERE p.id=$1`,
    [productoId]
  );
  if (!producto.rows[0]) throw new ApiError(404, "Producto no encontrado.");
  const imagenes = await db.query(
    `SELECT * FROM producto_imagenes
     WHERE producto_id=$1 ORDER BY orden, id`,
    [productoId]
  );
  const [enriquecido] = await enriquecerProductos(db, [producto.rows[0]]);
  return { ...enriquecido, imagenes: imagenes.rows };
}

const productosQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  categoria_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().max(1000000).optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
}).strict();

// GET /api/productos?q=&categoria_id=&page=&limit=  → búsqueda FTS + texto, paginada
router.get("/", validate(productosQuerySchema, "query"), async (req, res, next) => {
  try {
    const q = req.query.q || null;
    const cat = req.query.categoria_id || null;
    const { limit, page } = req.query;
    const offset = (page - 1) * limit;

    const r = await query(
      `SELECT p.*, c.nombre AS categoria, principal.url AS imagen_principal
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN LATERAL (
         SELECT pi.url FROM producto_imagenes pi
         WHERE pi.producto_id=p.id AND pi.principal
         LIMIT 1
       ) principal ON TRUE
       WHERE ($1::text IS NULL
              OR to_tsvector(
                   'spanish',
                   p.titulo || ' ' || COALESCE(p.subtitulo, '') || ' ' ||
                   COALESCE(p.autor, '') || ' ' || COALESCE(p.editorial, '') || ' ' ||
                   COALESCE(p.coleccion, '') || ' ' || COALESCE(p.serie, '')
                 ) @@ plainto_tsquery('spanish', $1)
              OR strpos(lower(p.titulo), lower($1)) > 0
              OR strpos(lower(COALESCE(p.subtitulo, '')), lower($1)) > 0
              OR strpos(lower(p.sku), lower($1)) > 0
              OR strpos(lower(COALESCE(p.codigo_barras, '')), lower($1)) > 0
              OR strpos(lower(COALESCE(p.isbn, '')), lower($1)) > 0
              OR strpos(lower(COALESCE(p.autor, '')), lower($1)) > 0
              OR strpos(lower(COALESCE(p.editorial, '')), lower($1)) > 0
              OR p.isbn_normalizado = isbn_normalizado_valido_catalogo($1)
              OR EXISTS (
                SELECT 1 FROM producto_contribuyentes pc
                WHERE pc.producto_id=p.id AND pc.nombre ILIKE '%' || $1 || '%'
              )
              OR EXISTS (
                SELECT 1 FROM producto_materias pm
                JOIN materias m ON m.id=pm.materia_id
                WHERE pm.producto_id=p.id AND m.nombre ILIKE '%' || $1 || '%'
              ))
         AND ($2::int IS NULL OR p.categoria_id = $2)
       ORDER BY p.titulo, p.id
       LIMIT $3 OFFSET $4`,
      [q, cat, limit, offset]
    );
    const productos = await enriquecerProductos({ query }, r.rows);
    res.json({
      page,
      limit,
      resultados: productos.map((producto) => productoParaRespuesta(producto, req.user)),
    });
  } catch (e) { next(e); }
});

const buscarCodigoQuerySchema = z.object({
  codigo: z.string().trim().min(1).max(30),
}).strict();

// GET /api/productos/buscar?codigo=  → scanner: código de barras, ISBN o SKU exacto
router.get("/buscar", validate(buscarCodigoQuerySchema, "query"), async (req, res, next) => {
  try {
    const { codigo } = req.query;
    const r = await query(
      `SELECT p.*, c.nombre AS categoria, principal.url AS imagen_principal
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN LATERAL (
         SELECT pi.url FROM producto_imagenes pi
         WHERE pi.producto_id=p.id AND pi.principal
         LIMIT 1
       ) principal ON TRUE
       WHERE p.codigo_barras = $1
          OR p.isbn = $1
          OR p.isbn_normalizado = isbn_normalizado_valido_catalogo($1)
          OR p.sku = $1
       LIMIT 1`,
      [codigo]
    );
    if (!r.rows[0]) throw new ApiError(404, `Producto no encontrado para "${codigo}".`);
    const [producto] = await enriquecerProductos({ query }, r.rows);
    res.json(productoParaRespuesta(producto, req.user));
  } catch (e) { next(e); }
});

const nullableText = (max) => z.string().trim().min(1).max(max).optional().nullable();
const contribuyenteSchema = z.object({
  nombre: z.string().trim().min(1).max(160),
  rol: z.enum(["AUTOR", "TRADUCTOR", "ILUSTRADOR", "EDITOR"]),
  orden: z.number().int().nonnegative().max(1000000).optional(),
}).strict();
const materiaSchema = z.union([
  z.string().trim().min(1).max(120),
  z.object({ nombre: z.string().trim().min(1).max(120) }).strict(),
]);
const maximoDosDecimales = (value) => (
  Math.abs((value * 100) - Math.round(value * 100)) < 1e-8
);
const decimalProducto = (maximo, etiqueta) => z.number()
  .nonnegative()
  .max(maximo)
  .refine(maximoDosDecimales, `${etiqueta} admite como máximo dos decimales.`);
const productoFields = {
  sku: z.string().trim().min(3).max(24),
  codigo_barras: nullableText(30),
  isbn: nullableText(17),
  titulo: z.string().trim().min(2).max(160),
  subtitulo: nullableText(240),
  autor: nullableText(1000),
  editorial: nullableText(120),
  categoria_id: z.number().int().positive().optional().nullable(),
  edicion: nullableText(80),
  anio_publicacion: z.number().int().min(1000).max(9999).optional().nullable(),
  idioma: nullableText(60),
  numero_paginas: z.number().int().positive().max(1000000).optional().nullable(),
  encuadernacion: nullableText(80),
  formato: nullableText(80),
  coleccion: nullableText(120),
  serie: nullableText(120),
  volumen: nullableText(40),
  contribuyentes: z.array(contribuyenteSchema).max(100).optional(),
  materias: z.array(materiaSchema).max(100).optional(),
  precio: decimalProducto(999999, "El precio"),
  costo: decimalProducto(999999, "El costo"),
  stock: z.number().int().nonnegative().max(2147483647),
  iva: decimalProducto(100, "El IVA"),
  slug: slugSchema.optional().nullable(),
  descripcion_comercial: nullableText(10000),
  activo: z.boolean(),
};

function validarIdentidadBibliografica(value, ctx) {
  if (value.isbn) {
    try { normalizarIsbn(value.isbn); } catch (error) {
      ctx.addIssue({ code: "custom", path: ["isbn"], message: error.message });
    }
  }
  if (value.autor != null && value.contribuyentes !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["autor"],
      message: "Usa autor o contribuyentes, no ambos.",
    });
  }
}

const productoSchema = z.object({
  ...productoFields,
  costo: productoFields.costo.default(0),
  stock: productoFields.stock.default(0),
  iva: productoFields.iva.default(16),
  activo: productoFields.activo.default(true),
}).superRefine(validarIdentidadBibliografica);

// POST /api/productos → alta (ADMIN/SUPERVISOR)
router.post("/", requireRoles("ADMIN", "SUPERVISOR"), validate(productoSchema), async (req, res, next) => {
  try {
    const p = req.body;
    const producto = await tx(async (client) => {
      const r = await client.query(
        `INSERT INTO productos
           (sku, codigo_barras, isbn, titulo, subtitulo, autor, editorial, categoria_id,
            edicion, anio_publicacion, idioma, numero_paginas, encuadernacion,
            formato, coleccion, serie, volumen, precio, costo, stock, iva,
            slug, descripcion_comercial, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,0,$20,$21,$22,$23)
         RETURNING *`,
        [
          p.sku, p.codigo_barras || null, p.isbn || null, p.titulo,
          p.subtitulo || null, p.contribuyentes === undefined ? (p.autor || null) : null,
          p.editorial || null, p.categoria_id || null, p.edicion || null,
          p.anio_publicacion ?? null, p.idioma || null, p.numero_paginas ?? null,
          p.encuadernacion || null, p.formato || null, p.coleccion || null,
          p.serie || null, p.volumen || null, p.precio, p.costo, p.iva,
          p.slug || null, p.descripcion_comercial || null, p.activo,
        ]
      );
      const creado = r.rows[0];
      if (p.contribuyentes !== undefined) {
        await reemplazarContribuyentes(client, creado.id, p.contribuyentes);
      }
      if (p.materias !== undefined) {
        await reemplazarMaterias(client, creado.id, p.materias);
      }
      if (p.stock > 0) {
        await aplicarMovimiento(client, {
          producto: creado,
          deltaFisico: p.stock,
          tipo: "AJUSTE",
          usuarioId: req.user.sub,
          motivo: "Existencia inicial al crear el producto.",
          origenClave: `ALTA_PRODUCTO:${creado.id}`,
        });
      }
      return cargarProducto(client, creado.id);
    });
    res.status(201).json(producto);
  } catch (e) { next(e); }
});

const imagenUrlSchema = z.string().trim().url().max(2000).refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "La imagen debe usar una URL http o https.");
const imagenSchema = z.object({
  url: imagenUrlSchema,
  texto_alternativo: z.string().trim().min(1).max(180),
  orden: z.number().int().nonnegative().max(1000000).default(0),
  principal: z.boolean().default(false),
});
// No derivar el PATCH del esquema con defaults: Zod conservaría `orden: 0`
// o `principal: false` aunque el cliente no enviara esos campos.
const imagenPatchSchema = z.object({
  url: imagenUrlSchema.optional(),
  texto_alternativo: z.string().trim().min(1).max(180).optional(),
  orden: z.number().int().nonnegative().max(1000000).optional(),
  principal: z.boolean().optional(),
})
  .refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });

router.get("/:id/imagenes", async (req, res, next) => {
  try {
    const productoId = parsePositiveId(req.params.id, "producto_id");
    const producto = await query(`SELECT id FROM productos WHERE id=$1`, [productoId]);
    if (!producto.rows[0]) throw new ApiError(404, "Producto no encontrado.");
    const r = await query(
      `SELECT * FROM producto_imagenes WHERE producto_id=$1 ORDER BY orden, id`,
      [productoId]
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post(
  "/:id/imagenes",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(imagenSchema),
  async (req, res, next) => {
    try {
      const productoId = parsePositiveId(req.params.id, "producto_id");
      const imagen = await tx(async (client) => {
        const producto = await client.query(`SELECT id FROM productos WHERE id=$1 FOR UPDATE`, [productoId]);
        if (!producto.rows[0]) throw new ApiError(404, "Producto no encontrado.");
        if (req.body.principal) {
          const principal = await client.query(
            `SELECT id FROM producto_imagenes WHERE producto_id=$1 AND principal`,
            [productoId]
          );
          if (principal.rows[0]) throw new ApiError(409, "El producto ya tiene una imagen principal.");
        }
        const r = await client.query(
          `INSERT INTO producto_imagenes
             (producto_id, url, texto_alternativo, orden, principal)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [productoId, req.body.url, req.body.texto_alternativo, req.body.orden, req.body.principal]
        );
        return r.rows[0];
      });
      res.status(201).json(imagen);
    } catch (e) { next(e); }
  }
);

router.patch(
  "/:id/imagenes/:imagenId",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(imagenPatchSchema),
  async (req, res, next) => {
    try {
      const productoId = parsePositiveId(req.params.id, "producto_id");
      const imagenId = parsePositiveId(req.params.imagenId, "imagen_id");
      const imagen = await tx(async (client) => {
        const producto = await client.query(
          `SELECT id, publicado_web FROM productos WHERE id=$1 FOR UPDATE`,
          [productoId]
        );
        if (!producto.rows[0]) throw new ApiError(404, "Producto no encontrado.");
        const actual = await client.query(
          `SELECT * FROM producto_imagenes WHERE id=$1 AND producto_id=$2 FOR UPDATE`,
          [imagenId, productoId]
        );
        if (!actual.rows[0]) throw new ApiError(404, "Imagen no encontrada.");
        if (actual.rows[0].principal && req.body.principal === false
            && producto.rows[0].publicado_web) {
          throw new ApiError(409, "Despublica el producto antes de retirar su imagen principal.");
        }
        if (!actual.rows[0].principal && req.body.principal === true) {
          const principal = await client.query(
            `SELECT id FROM producto_imagenes
             WHERE producto_id=$1 AND principal AND id<>$2`,
            [productoId, imagenId]
          );
          if (principal.rows[0]) throw new ApiError(409, "El producto ya tiene una imagen principal.");
        }
        const sets = [];
        const values = [];
        for (const [field, value] of Object.entries(req.body)) {
          values.push(value);
          sets.push(`${field}=$${values.length}`);
        }
        values.push(imagenId, productoId);
        const r = await client.query(
          `UPDATE producto_imagenes SET ${sets.join(", ")}
           WHERE id=$${values.length - 1} AND producto_id=$${values.length}
           RETURNING *`,
          values
        );
        return r.rows[0];
      });
      res.json(imagen);
    } catch (e) { next(e); }
  }
);

router.delete(
  "/:id/imagenes/:imagenId",
  requireRoles("ADMIN", "SUPERVISOR"),
  async (req, res, next) => {
    try {
      const productoId = parsePositiveId(req.params.id, "producto_id");
      const imagenId = parsePositiveId(req.params.imagenId, "imagen_id");
      await tx(async (client) => {
        const producto = await client.query(
          `SELECT id, publicado_web FROM productos WHERE id=$1 FOR UPDATE`,
          [productoId]
        );
        if (!producto.rows[0]) throw new ApiError(404, "Producto no encontrado.");
        const imagen = await client.query(
          `SELECT * FROM producto_imagenes WHERE id=$1 AND producto_id=$2 FOR UPDATE`,
          [imagenId, productoId]
        );
        if (!imagen.rows[0]) throw new ApiError(404, "Imagen no encontrada.");
        if (imagen.rows[0].principal && producto.rows[0].publicado_web) {
          throw new ApiError(409, "Despublica el producto antes de eliminar su imagen principal.");
        }
        await client.query(`DELETE FROM producto_imagenes WHERE id=$1`, [imagenId]);
      });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

const publicacionSchema = z.object({ publicado_web: z.boolean() });
router.patch(
  "/:id/publicacion",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(publicacionSchema),
  async (req, res, next) => {
    try {
      const productoId = parsePositiveId(req.params.id, "producto_id");
      const producto = await tx(async (client) => {
        const actual = await client.query(`SELECT * FROM productos WHERE id=$1 FOR UPDATE`, [productoId]);
        if (!actual.rows[0]) throw new ApiError(404, "Producto no encontrado.");
        if (req.body.publicado_web) {
          if (!actual.rows[0].slug || !String(actual.rows[0].descripcion_comercial || "").trim()) {
            throw new ApiError(409, "Para publicar se requieren slug y descripción comercial.");
          }
          const principal = await client.query(
            `SELECT id FROM producto_imagenes WHERE producto_id=$1 AND principal`,
            [productoId]
          );
          if (!principal.rows[0]) {
            throw new ApiError(409, "Para publicar se requiere una imagen principal.");
          }
        }
        const r = await client.query(
          `UPDATE productos SET publicado_web=$2, actualizado_en=NOW()
           WHERE id=$1 RETURNING *`,
          [productoId, req.body.publicado_web]
        );
        return r.rows[0];
      });
      res.json(producto);
    } catch (e) { next(e); }
  }
);

router.get("/:id", async (req, res, next) => {
  try {
    const productoId = parsePositiveId(req.params.id, "producto_id");
    res.json(productoParaRespuesta(await cargarProducto({ query }, productoId), req.user));
  } catch (e) { next(e); }
});

// PATCH /api/productos/:id → edición operativa/comercial sin alterar existencias
const { stock: _stockField, ...patchFields } = productoFields;
const patchSchema = z.object(patchFields).partial()
  .superRefine(validarIdentidadBibliografica)
  .refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });

router.patch("/:id", requireRoles("ADMIN", "SUPERVISOR"), validate(patchSchema), async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "producto_id");
    const producto = await tx(async (client) => {
      const actual = await client.query(`SELECT id FROM productos WHERE id=$1 FOR UPDATE`, [id]);
      if (!actual.rows[0]) throw new ApiError(404, "Producto no encontrado.");
      const {
        contribuyentes,
        materias,
        ...scalars
      } = req.body;
      const sets = [];
      const values = [];
      for (const [field, value] of Object.entries(scalars)) {
        values.push(value);
        sets.push(`${field}=$${values.length}`);
      }
      if (sets.length) {
        values.push(id);
        await client.query(
          `UPDATE productos
           SET ${sets.join(", ")}, actualizado_en=NOW()
           WHERE id=$${values.length}`,
          values
        );
      }
      if (contribuyentes !== undefined) {
        await reemplazarContribuyentes(client, id, contribuyentes);
      }
      if (materias !== undefined) {
        await reemplazarMaterias(client, id, materias);
      }
      return cargarProducto(client, id);
    });
    res.json(producto);
  } catch (e) { next(e); }
});

module.exports = router;
