// backend/src/middleware/validate.js — validación Zod declarativa
const { ApiError } = require("../utils/errors");

/**
 * validate(schema)         → valida req.body
 * validate(schema, 'query')→ valida req.query
 */
function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const detalle = result.error.issues
        .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
        .join(" · ");
      return next(new ApiError(400, `Datos inválidos — ${detalle}`));
    }
    // Express 5 expone req.query mediante un getter sin setter. Definir una
    // propiedad propia conserva la salida normalizada de Zod (incluidos defaults)
    // para las rutas posteriores; req.body sigue aceptando asignación directa.
    if (source === "query") {
      Object.defineProperty(req, "query", {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      req[source] = result.data;
    }
    next();
  };
}

module.exports = { validate };
