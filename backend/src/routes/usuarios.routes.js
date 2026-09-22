// backend/src/routes/usuarios.routes.js — administración de usuarios (solo ADMIN)
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { z } = require("zod");

const usuarioSchema = z.object({
  nombre: z.string().trim().min(3).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(12).max(72)
    .refine((password) => !bcrypt.truncates(password), "La contraseña excede 72 bytes UTF-8"),
  rol_id: z.number().int().positive(),
});

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
router.use(requireAuth, requireRoles("ADMIN"));

router.get("/", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.activo, u.creado_en
       FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.id`
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.post("/", validate(usuarioSchema), async (req, res, next) => {
  try {
    const { nombre, email, password, rol_id } = req.body;
    const rol = await query(`SELECT id FROM roles WHERE id = $1`, [rol_id]);
    if (!rol.rows[0]) return res.status(400).json({ error: "Rol inexistente." });
    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES ($1, lower($2), $3, $4)
       RETURNING id, nombre, email`,
      [nombre, email, hash, rol_id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
