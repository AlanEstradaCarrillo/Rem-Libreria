const router = require("express").Router();
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { parsePositiveId } = require("../services/caja.service");
const { cotizar } = require("../services/precios.service");
const { z } = require("zod");

router.use(requireAuth);

const cotizacionSchema = z.object({
  canal: z.enum(["POS", "WEB"]).default("POS"),
  cliente_id: z.number().int().positive().optional().nullable(),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(999),
  }))
    .min(1, "La cotización requiere al menos un artículo")
    .max(100, "El carrito admite como máximo 100 productos distintos"),
}).superRefine((value, ctx) => {
  if (value.canal === "WEB" && value.cliente_id != null) {
    ctx.addIssue({
      code: "custom",
      path: ["cliente_id"],
      message: "La cotización web no acepta un cliente registrado.",
    });
  }
});

router.post("/cotizar", validate(cotizacionSchema), async (req, res, next) => {
  try {
    res.json(await cotizar({ query }, {
      ...req.body,
      clienteId: req.body.cliente_id ?? null,
    }));
  } catch (e) { next(e); }
});

const fechaSchema = z.string().trim().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Fecha y hora inválidas"
);
const reglaBaseSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  canal: z.enum(["AMBOS", "POS", "WEB"]),
  segmento_cliente: z.enum(["TODOS", "PUBLICO", "MAYOREO"]),
  tipo: z.enum(["PORCENTAJE", "MONTO_FIJO", "PRECIO_FIJO"]),
  valor: z.number().nonnegative().max(9999999999.99),
  producto_id: z.number().int().positive().optional().nullable(),
  categoria_id: z.number().int().positive().optional().nullable(),
  cantidad_minima: z.number().int().positive().max(999999),
  prioridad: z.number().int().min(-1000000).max(1000000),
  vigente_desde: fechaSchema.optional().nullable(),
  vigente_hasta: fechaSchema.optional().nullable(),
  activo: z.boolean(),
});

function validarRegla(value, ctx) {
  if (value.producto_id != null && value.categoria_id != null) {
    ctx.addIssue({
      code: "custom",
      path: ["producto_id"],
      message: "Una regla solo puede dirigirse a un producto o a una categoría.",
    });
  }
  if (value.tipo === "PORCENTAJE" && value.valor != null && value.valor > 100) {
    ctx.addIssue({
      code: "custom",
      path: ["valor"],
      message: "El porcentaje debe estar entre 0 y 100.",
    });
  }
  if (value.vigente_desde && value.vigente_hasta
      && Date.parse(value.vigente_hasta) <= Date.parse(value.vigente_desde)) {
    ctx.addIssue({
      code: "custom",
      path: ["vigente_hasta"],
      message: "La fecha final debe ser posterior a la inicial.",
    });
  }
}

const reglaCreateSchema = reglaBaseSchema.extend({
  segmento_cliente: z.enum(["TODOS", "PUBLICO", "MAYOREO"]).default("TODOS"),
  cantidad_minima: z.number().int().positive().max(999999).default(1),
  prioridad: z.number().int().min(-1000000).max(1000000).default(0),
  activo: z.boolean().default(true),
}).superRefine(validarRegla);
const reglaPatchSchema = reglaBaseSchema.partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" })
  .superRefine(validarRegla);
const reglasQuerySchema = z.object({
  canal: z.enum(["AMBOS", "POS", "WEB"]).optional(),
  segmento_cliente: z.enum(["TODOS", "PUBLICO", "MAYOREO"]).optional(),
  producto_id: z.coerce.number().int().positive().optional(),
  categoria_id: z.coerce.number().int().positive().optional(),
  incluir_inactivas: z.enum(["true", "false"])
    .transform((value) => value === "true").optional().default(false),
});

async function cargarRegla(db, id) {
  const r = await db.query(
    `SELECT rp.*, p.titulo AS producto, c.nombre AS categoria
     FROM reglas_precio rp
     LEFT JOIN productos p ON p.id=rp.producto_id
     LEFT JOIN categorias c ON c.id=rp.categoria_id
     WHERE rp.id=$1`,
    [id]
  );
  if (!r.rows[0]) throw new ApiError(404, "Regla de precio no encontrada.");
  return r.rows[0];
}

router.get("/reglas", validate(reglasQuerySchema, "query"), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT rp.*, p.titulo AS producto, c.nombre AS categoria
       FROM reglas_precio rp
       LEFT JOIN productos p ON p.id=rp.producto_id
       LEFT JOIN categorias c ON c.id=rp.categoria_id
       WHERE (rp.activo OR $1::boolean)
         AND ($2::text IS NULL OR rp.canal=$2)
         AND ($3::int IS NULL OR rp.producto_id=$3)
         AND ($4::int IS NULL OR rp.categoria_id=$4)
         AND ($5::text IS NULL OR rp.segmento_cliente=$5)
       ORDER BY rp.activo DESC, rp.prioridad DESC, rp.id`,
      [
        req.query.incluir_inactivas,
        req.query.canal || null,
        req.query.producto_id || null,
        req.query.categoria_id || null,
        req.query.segmento_cliente || null,
      ]
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get("/reglas/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "regla_precio_id");
    res.json(await cargarRegla({ query }, id));
  } catch (e) { next(e); }
});

router.post(
  "/reglas",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(reglaCreateSchema),
  async (req, res, next) => {
    try {
      const r = req.body;
      const creado = await query(
        `INSERT INTO reglas_precio
           (nombre, canal, segmento_cliente, tipo, valor, producto_id, categoria_id,
            cantidad_minima, prioridad, vigente_desde, vigente_hasta, activo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          r.nombre, r.canal, r.segmento_cliente, r.tipo, r.valor, r.producto_id || null,
          r.categoria_id || null, r.cantidad_minima, r.prioridad,
          r.vigente_desde || null, r.vigente_hasta || null, r.activo,
        ]
      );
      res.status(201).json(creado.rows[0]);
    } catch (e) { next(e); }
  }
);

router.patch(
  "/reglas/:id",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(reglaPatchSchema),
  async (req, res, next) => {
    try {
      const id = parsePositiveId(req.params.id, "regla_precio_id");
      const sets = [];
      const values = [];
      for (const [field, value] of Object.entries(req.body)) {
        values.push(value);
        sets.push(`${field}=$${values.length}`);
      }
      values.push(id);
      const r = await query(
        `UPDATE reglas_precio SET ${sets.join(", ")}
         WHERE id=$${values.length}
         RETURNING *`,
        values
      );
      if (!r.rows[0]) throw new ApiError(404, "Regla de precio no encontrada.");
      res.json(r.rows[0]);
    } catch (e) { next(e); }
  }
);

router.delete("/reglas/:id", requireRoles("ADMIN", "SUPERVISOR"), async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "regla_precio_id");
    const r = await query(
      `UPDATE reglas_precio SET activo=FALSE WHERE id=$1 RETURNING *`,
      [id]
    );
    if (!r.rows[0]) throw new ApiError(404, "Regla de precio no encontrada.");
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
