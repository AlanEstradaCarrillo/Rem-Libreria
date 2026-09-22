const router = require("express").Router();
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { parsePositiveId } = require("../services/caja.service");
const { z } = require("zod");

router.use(requireAuth);

const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLowerCase());
const telefonoSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s.-]+$/, "El teléfono contiene caracteres inválidos.");
const clienteBaseSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  telefono: telefonoSchema.optional().nullable(),
  email: emailSchema.optional().nullable(),
  direccion: z.string().trim().min(3).max(2000).optional().nullable(),
  notas: z.string().trim().min(1).max(5000).optional().nullable(),
});
const clientePatchSchema = clienteBaseSchema.partial().extend({
  activo: z.boolean().optional(),
  segmento_precio: z.enum(["PUBLICO", "MAYOREO"]).optional(),
  tipo_comercial: z.enum(["CONSUMIDOR", "LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"]).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });
const clienteCreateSchema = clienteBaseSchema.extend({
  segmento_precio: z.enum(["PUBLICO", "MAYOREO"]).optional().default("PUBLICO"),
  tipo_comercial: z.enum(["CONSUMIDOR", "LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"])
    .optional().default("CONSUMIDOR"),
});
const clientesQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  incluir_inactivos: z.enum(["true", "false"])
    .transform((value) => value === "true").optional().default(false),
  segmento_precio: z.enum(["PUBLICO", "MAYOREO"]).optional(),
  tipo_comercial: z.enum(["CONSUMIDOR", "LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"]).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
});

router.get("/", validate(clientesQuerySchema, "query"), async (req, res, next) => {
  try {
    const offset = (req.query.page - 1) * req.query.limit;
    const result = await query(
      `SELECT c.*, u.nombre AS creado_por
       FROM clientes c
       LEFT JOIN usuarios u ON u.id=c.creado_por_usuario_id
       WHERE (c.activo OR $1::boolean)
         AND (
           $2::text=''
           OR c.nombre ILIKE '%' || $2 || '%'
           OR COALESCE(c.telefono, '') ILIKE '%' || $2 || '%'
           OR COALESCE(c.email, '') ILIKE '%' || $2 || '%'
         )
        AND ($5::text IS NULL OR c.segmento_precio=$5)
        AND ($6::text IS NULL OR c.tipo_comercial=$6)
       ORDER BY c.nombre, c.id
       LIMIT $3 OFFSET $4`,
      [
        req.query.incluir_inactivos,
        req.query.q,
        req.query.limit,
        offset,
        req.query.segmento_precio || null,
        req.query.tipo_comercial || null,
      ]
    );
    res.json({
      page: req.query.page,
      limit: req.query.limit,
      resultados: result.rows,
    });
  } catch (error) { next(error); }
});

router.post("/", validate(clienteCreateSchema), async (req, res, next) => {
  try {
    const cliente = req.body;
    if ((cliente.segmento_precio === "MAYOREO" || cliente.tipo_comercial !== "CONSUMIDOR")
        && !["ADMIN", "SUPERVISOR"].includes(req.user.rol)) {
      throw new ApiError(403, "Tu rol no puede asignar condiciones comerciales.");
    }
    const result = await query(
      `INSERT INTO clientes
         (nombre, telefono, email, direccion, notas, segmento_precio,
          tipo_comercial, creado_por_usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        cliente.nombre,
        cliente.telefono ?? null,
        cliente.email ?? null,
        cliente.direccion ?? null,
        cliente.notas ?? null,
        cliente.segmento_precio,
        cliente.tipo_comercial,
        req.user.sub,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "cliente_id");
    const result = await query(
      `SELECT c.*, u.nombre AS creado_por
       FROM clientes c
       LEFT JOIN usuarios u ON u.id=c.creado_por_usuario_id
       WHERE c.id=$1`,
      [id]
    );
    if (!result.rows[0]) throw new ApiError(404, "Cliente no encontrado.");
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

router.patch(
  "/:id",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(clientePatchSchema),
  async (req, res, next) => {
    try {
      const id = parsePositiveId(req.params.id, "cliente_id");
      const sets = [];
      const values = [];
      for (const [field, value] of Object.entries(req.body)) {
        values.push(value);
        sets.push(`${field}=$${values.length}`);
      }
      values.push(id);
      const result = await query(
        `UPDATE clientes SET ${sets.join(", ")}
         WHERE id=$${values.length}
         RETURNING *`,
        values
      );
      if (!result.rows[0]) throw new ApiError(404, "Cliente no encontrado.");
      res.json(result.rows[0]);
    } catch (error) { next(error); }
  }
);

router.delete(
  "/:id",
  requireRoles("ADMIN", "SUPERVISOR"),
  async (req, res, next) => {
    try {
      const id = parsePositiveId(req.params.id, "cliente_id");
      const result = await query(
        `UPDATE clientes SET activo=FALSE WHERE id=$1 RETURNING *`,
        [id]
      );
      if (!result.rows[0]) throw new ApiError(404, "Cliente no encontrado.");
      res.json(result.rows[0]);
    } catch (error) { next(error); }
  }
);

module.exports = router;
