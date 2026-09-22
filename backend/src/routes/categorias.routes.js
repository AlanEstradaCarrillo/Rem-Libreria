const router = require("express").Router();
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { parsePositiveId } = require("../services/caja.service");
const { z } = require("zod");

router.use(requireAuth);

const slugSchema = z.string().trim().min(1).max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones.");
const categoriaBase = z.object({
  nombre: z.string().trim().min(2).max(100),
  slug: slugSchema.optional(),
  descripcion: z.string().trim().max(5000).optional().nullable(),
  activo: z.boolean().optional(),
  orden: z.number().int().nonnegative().max(1000000).optional(),
});
const categoriaCreateSchema = categoriaBase.extend({
  activo: z.boolean().default(true),
  orden: z.number().int().nonnegative().max(1000000).default(0),
});
const categoriaPatchSchema = categoriaBase.partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });
const categoriasQuerySchema = z.object({
  incluir_inactivas: z.enum(["true", "false"])
    .transform((value) => value === "true").optional().default(false),
});

router.get("/", validate(categoriasQuerySchema, "query"), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT * FROM categorias
       WHERE activo=TRUE OR $1::boolean
       ORDER BY orden, nombre, id`,
      [req.query.incluir_inactivas]
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "categoria_id");
    const r = await query(`SELECT * FROM categorias WHERE id=$1`, [id]);
    if (!r.rows[0]) throw new ApiError(404, "Categoría no encontrada.");
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

router.post(
  "/",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(categoriaCreateSchema),
  async (req, res, next) => {
    try {
      const c = req.body;
      const r = await query(
        `INSERT INTO categorias (nombre, slug, descripcion, activo, orden)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [c.nombre, c.slug || null, c.descripcion || null, c.activo, c.orden]
      );
      res.status(201).json(r.rows[0]);
    } catch (e) { next(e); }
  }
);

router.patch(
  "/:id",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(categoriaPatchSchema),
  async (req, res, next) => {
    try {
      const id = parsePositiveId(req.params.id, "categoria_id");
      const sets = [];
      const values = [];
      for (const [field, value] of Object.entries(req.body)) {
        values.push(value);
        sets.push(`${field}=$${values.length}`);
      }
      values.push(id);
      const r = await query(
        `UPDATE categorias SET ${sets.join(", ")}
         WHERE id=$${values.length}
         RETURNING *`,
        values
      );
      if (!r.rows[0]) throw new ApiError(404, "Categoría no encontrada.");
      res.json(r.rows[0]);
    } catch (e) { next(e); }
  }
);

router.delete("/:id", requireRoles("ADMIN", "SUPERVISOR"), async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "categoria_id");
    const r = await query(
      `UPDATE categorias SET activo=FALSE WHERE id=$1 RETURNING *`,
      [id]
    );
    if (!r.rows[0]) throw new ApiError(404, "Categoría no encontrada.");
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
