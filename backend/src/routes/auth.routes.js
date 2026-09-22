// backend/src/routes/auth.routes.js — login y sesión
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth } = require("../middleware/auth");
const { ApiError } = require("../utils/errors");
const { z } = require("zod");

// Mantiene un costo de comparación equivalente cuando el correo no existe.
const DUMMY_PASSWORD_HASH = "$2b$12$woPuoYUxr3fTTXztZJgcUu/tKc5/CCLq90LWznFrGkU9y.JKJqXfq";

const loginSchema = z.object({
  email: z.string().trim().email("Email inválido").max(120),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
});

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post("/login", validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const r = await query(
      `SELECT u.*, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE lower(u.email) = lower($1) AND u.activo = TRUE LIMIT 1`,
      [email]
    );
    const u = r.rows[0];
    // Mensaje genérico: no revelar si el email existe
    const passwordValido = await bcrypt.compare(password, u ? u.password_hash : DUMMY_PASSWORD_HASH);
    if (!u || !passwordValido) {
      throw new ApiError(401, "Credenciales inválidas.");
    }
    const token = jwt.sign(
      { sub: u.id, nombre: u.nombre, email: u.email, rol: u.rol },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: process.env.JWT_EXPIRES || "8h" }
    );
    res.json({ token, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } });
  } catch (e) { next(e); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json({ id: req.user.sub, nombre: req.user.nombre, email: req.user.email, rol: req.user.rol });
  } catch (e) { next(e); }
});

module.exports = router;
