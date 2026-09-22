const router = require("express").Router();
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { parsePositiveId } = require("../services/caja.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLowerCase());
const telefonoSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s.-]+$/, "El teléfono contiene caracteres inválidos.");
const rfcSchema = z.string().trim().min(3).max(20)
  .transform((value) => value.toUpperCase());
const proveedorBaseSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  razon_social: z.string().trim().min(2).max(180).optional().nullable(),
  rfc: rfcSchema.optional().nullable(),
  contacto: z.string().trim().min(2).max(120).optional().nullable(),
  telefono: telefonoSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  direccion: z.string().trim().min(3).max(2000).optional().nullable(),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
});
const proveedorCreateSchema = proveedorBaseSchema.extend({
  activo: z.boolean().optional().default(true),
});
const proveedorPatchSchema = proveedorBaseSchema.partial().extend({
  activo: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });
const proveedoresQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  incluir_inactivos: z.enum(["true", "false"])
    .transform((value) => value === "true").optional().default(false),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});

router.get("/", validate(proveedoresQuerySchema, "query"), async (req, res, next) => {
  try {
    const offset = (req.query.page - 1) * req.query.limit;
    const result = await query(
      `SELECT p.*, u.nombre AS creado_por
       FROM proveedores p
       JOIN usuarios u ON u.id=p.creado_por_usuario_id
       WHERE (p.activo OR $1::boolean)
         AND (
           $2::text=''
           OR p.nombre ILIKE '%' || $2 || '%'
           OR COALESCE(p.razon_social,'') ILIKE '%' || $2 || '%'
           OR COALESCE(p.rfc,'') ILIKE '%' || $2 || '%'
           OR COALESCE(p.contacto,'') ILIKE '%' || $2 || '%'
           OR COALESCE(p.telefono,'') ILIKE '%' || $2 || '%'
           OR COALESCE(p.email,'') ILIKE '%' || $2 || '%'
         )
       ORDER BY p.nombre, p.id
       LIMIT $3 OFFSET $4`,
      [req.query.incluir_inactivos, req.query.q, req.query.limit, offset]
    );
    res.json({
      page: req.query.page,
      limit: req.query.limit,
      resultados: result.rows,
    });
  } catch (error) { next(error); }
});

router.post("/", validate(proveedorCreateSchema), async (req, res, next) => {
  try {
    const proveedor = req.body;
    const result = await query(
      `INSERT INTO proveedores
         (nombre, razon_social, rfc, contacto, telefono, email,
          direccion, notas, activo, creado_por_usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        proveedor.nombre,
        proveedor.razon_social ?? null,
        proveedor.rfc ?? null,
        proveedor.contacto ?? null,
        proveedor.telefono ?? null,
        proveedor.email ?? null,
        proveedor.direccion ?? null,
        proveedor.notas ?? null,
        proveedor.activo,
        req.user.sub,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "proveedor_id");
    const result = await query(
      `SELECT p.*, u.nombre AS creado_por
       FROM proveedores p
       JOIN usuarios u ON u.id=p.creado_por_usuario_id
       WHERE p.id=$1`,
      [id]
    );
    if (!result.rows[0]) throw new ApiError(404, "Proveedor no encontrado.");
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.patch("/:id", validate(proveedorPatchSchema), async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "proveedor_id");
    const sets = [];
    const values = [];
    for (const [field, value] of Object.entries(req.body)) {
      values.push(value);
      sets.push(`${field}=$${values.length}`);
    }
    values.push(id);
    const result = await query(
      `UPDATE proveedores SET ${sets.join(", ")}
       WHERE id=$${values.length}
       RETURNING *`,
      values
    );
    if (!result.rows[0]) throw new ApiError(404, "Proveedor no encontrado.");
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "proveedor_id");
    const result = await query(
      `UPDATE proveedores SET activo=FALSE WHERE id=$1 RETURNING *`,
      [id]
    );
    if (!result.rows[0]) throw new ApiError(404, "Proveedor no encontrado.");
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

module.exports = router;
