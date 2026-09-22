const { ApiError } = require("../utils/errors");

const ROLES_PRIVILEGIADOS = new Set(["ADMIN", "SUPERVISOR"]);

function parsePositiveId(value, label = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${label} inválido.`);
  return id;
}

function puedeOperarSesion(user, sesion) {
  return ROLES_PRIVILEGIADOS.has(user.rol) || Number(sesion.usuario_id) === Number(user.sub);
}

function exigirAccesoSesion(user, sesion) {
  if (!puedeOperarSesion(user, sesion)) {
    throw new ApiError(403, "La sesión pertenece a otro usuario de caja.");
  }
}

async function bloquearSesionAbierta(client, sesionId, user, { exigirPropiedad = true } = {}) {
  const id = parsePositiveId(sesionId, "sesion_id");
  const r = await client.query(
    `SELECT s.*, c.nombre AS caja_nombre, c.activo AS caja_activa
     FROM sesiones_caja s
     JOIN caja c ON c.id = s.caja_id
     WHERE s.id=$1 AND s.estado='ABIERTA'
     FOR UPDATE OF s`,
    [id]
  );
  if (!r.rows[0]) throw new ApiError(409, "La sesión de caja no está abierta.");
  if (!r.rows[0].caja_activa) throw new ApiError(409, "La caja está inactiva.");
  if (exigirPropiedad) exigirAccesoSesion(user, r.rows[0]);
  return r.rows[0];
}

module.exports = {
  ROLES_PRIVILEGIADOS,
  parsePositiveId,
  puedeOperarSesion,
  exigirAccesoSesion,
  bloquearSesionAbierta,
};
