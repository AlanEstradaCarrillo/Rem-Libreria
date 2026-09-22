// backend/src/middleware/auth.js — JWT + control de roles (RBAC)
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");
const { ApiError } = require("../utils/errors");

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const match = h.match(/^Bearer\s+([^\s]+)$/i);
  const token = match ? match[1] : null;
  if (!token) return next(new ApiError(401, "Token de acceso requerido."));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    const usuarioId = Number(payload.sub);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new ApiError(401, "Token inválido o expirado.");
    }
    const r = await query(
      `SELECT u.id, u.nombre, u.email, roles.nombre AS rol
       FROM usuarios u
       JOIN roles ON roles.id = u.rol_id
       WHERE u.id = $1 AND u.activo = TRUE`,
      [usuarioId]
    );
    if (!r.rows[0]) throw new ApiError(401, "Usuario inactivo o inexistente.");
    req.user = { ...payload, sub: r.rows[0].id, ...r.rows[0] };
    next();
  } catch (e) {
    next(e instanceof ApiError ? e : new ApiError(401, "Token inválido o expirado."));
  }
}

/** Middleware de fábrica: requireRoles('ADMIN','SUPERVISOR') */
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return next(new ApiError(403, "Tu rol no tiene permisos para esta operación."));
    }
    next();
  };
}

module.exports = { requireAuth, requireRoles };
