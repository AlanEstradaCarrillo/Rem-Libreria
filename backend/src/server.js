// backend/src/server.js — punto de entrada de la API
require("dotenv").config();
const { createApp } = require("./app");
const { pool, query, tx } = require("./config/db");
const { expirarPedidosVencidos } = require("./services/pedidos.service");
const { recordOperationalError } = require("./utils/observability");

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("CAMBIA_")) {
  throw new Error("DATABASE_URL es obligatoria y debe contener una conexión PostgreSQL real.");
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes("CAMBIA_") || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET es obligatoria y debe tener al menos 32 caracteres aleatorios.");
}

const PORT = process.env.PORT || 4000;
const app = createApp();
let server = null;
let barridoExpiraciones = null;
let apagando = false;

let barridoExpiracionesActivo = false;
async function liberarReservasVencidas() {
  if (barridoExpiracionesActivo) return;
  barridoExpiracionesActivo = true;
  try {
    for (let lote = 0; lote < 5; lote += 1) {
      const procesados = await tx((client) => expirarPedidosVencidos(client, { limit: 100 }));
      if (procesados.length < 100) break;
    }
  } catch (error) {
    console.error("No se pudieron liberar reservas vencidas:", error.message);
    void recordOperationalError(error, { event: "reservation_expiration_failed" });
  } finally {
    barridoExpiracionesActivo = false;
  }
}

async function iniciar() {
  await query("SELECT 1");
  await new Promise((resolve, reject) => {
    server = app.listen(PORT, resolve);
    server.once("error", reject);
  });

  console.log(`✅ Librería REM API y PostgreSQL disponibles en http://localhost:${PORT}`);
  void liberarReservasVencidas();
  barridoExpiraciones = setInterval(() => {
    void liberarReservasVencidas();
  }, 60_000);
  barridoExpiraciones.unref();
}

async function apagar(signal) {
  if (apagando) return;
  apagando = true;
  if (barridoExpiraciones) clearInterval(barridoExpiraciones);
  if (server && server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await pool.end();
  console.log(`ℹ️ Librería REM detenida correctamente (${signal}).`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    apagar(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("❌ No se pudo detener Librería REM correctamente:", error.message);
        void recordOperationalError(error, { event: "shutdown_failed", signal });
        process.exit(1);
      });
  });
}

iniciar().catch(async (error) => {
  console.error("❌ No se pudo iniciar Librería REM:", error.message);
  await recordOperationalError(error, { event: "startup_failed" });
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
