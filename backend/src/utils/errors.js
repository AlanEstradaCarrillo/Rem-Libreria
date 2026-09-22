// backend/src/utils/errors.js — errores de negocio + handler global
const { recordOperationalError } = require("./observability");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Mapea errores esperados a respuestas HTTP consistentes
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let status = 500;
  let message = "Error interno del servidor.";
  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
  } else if (err.code === "23505") {
    status = 409;
    message = "Conflicto: registro duplicado.";
  } else if (err.code === "23514") {
    status = 400;
    message = "Valor fuera de rango (stock/precio/monto).";
  } else if (err.code === "23503") {
    status = 409;
    message = "Referencia inválida a otro registro.";
  }

  void recordOperationalError(err, {
    event: "http_error",
    status,
    method: req?.method,
    path: req?.path,
  });
  if (status >= 500) console.error("Error no controlado:", err);
  return res.status(status).json({ error: message });
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = { ApiError, errorHandler, round2 };
