                              // backend/src/config/db.js — pool de conexiones y helper de transacciones
require("dotenv").config();
const { Pool } = require("pg");
const { recordOperationalError } = require("../utils/observability");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL solo en nubes gestionadas (Neon, RDS, Supabase…)
  ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("PG pool error:", err.message);
  void recordOperationalError(err, { event: "postgres_pool_error" });
});

/** Consulta simple parametrizada (siempre usar parámetros, nunca concatenar). */
async function query(text, params) {
  return pool.query(text, params);
}

/** Ejecuta `fn(client)` dentro de una transacción BEGIN/COMMIT/ROLLBACK. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
