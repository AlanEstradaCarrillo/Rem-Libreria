const fs = require("node:fs/promises");
const path = require("node:path");

function errorLogPath() {
  const configured = String(process.env.ERROR_LOG_FILE || "").trim();
  return path.resolve(process.cwd(), configured || "logs/errors.log");
}

/**
 * Registra errores del servidor en JSONL para que la operación no dependa
 * únicamente de una terminal. El contexto se limita a metadatos seguros:
 * nunca se copian cuerpos de petición, encabezados ni credenciales.
 */
async function recordOperationalError(error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: "error",
    message: error instanceof Error ? error.message : String(error),
    code: error && typeof error === "object" ? error.code || undefined : undefined,
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  };

  try {
    const filePath = errorLogPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (loggingError) {
    // El registro nunca debe ocultar el error original ni impedir la respuesta.
    console.error("No se pudo escribir el registro persistente de errores:", loggingError.message);
  }
}

module.exports = { errorLogPath, recordOperationalError };
