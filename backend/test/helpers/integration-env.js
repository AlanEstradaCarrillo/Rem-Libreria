const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const dotenv = require("dotenv");

const BACKEND_ROOT = path.resolve(__dirname, "../..");
const ENV_PATH = path.join(BACKEND_ROOT, ".env");
const SCHEMA_PATH = path.join(BACKEND_ROOT, "database", "schema.sql");

function sslConfig() {
  return process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false;
}

function schemaIdentifier(name) {
  if (!/^libra_pos_test_[a-z0-9_]+$/.test(name)) {
    throw new Error("Nombre de esquema temporal no seguro.");
  }
  return `"${name}"`;
}

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Crea un esquema PostgreSQL desechable sin tocar bases ni esquemas existentes.
 * La aplicación y el runner de migraciones se cargan sólo después de fijar
 * PGOPTIONS, para que todas sus conexiones usen el search_path temporal.
 */
async function createIntegrationEnvironment() {
  dotenv.config({ path: ENV_PATH, quiet: true });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Las pruebas de integración requieren DATABASE_URL en backend/.env.");
  }

  const adminPool = new Pool({
    connectionString,
    ssl: sslConfig(),
    connectionTimeoutMillis: 3000,
  });

  try {
    await adminPool.query("SELECT 1");
  } catch (err) {
    await adminPool.end().catch(() => {});
    throw new Error(
      `Las pruebas de integración requieren PostgreSQL accesible (${err.code || err.message}).`,
      { cause: err }
    );
  }

  const schemaName = `libra_pos_test_${process.pid}_${Date.now()}`;
  const quotedSchema = schemaIdentifier(schemaName);
  let schemaCreated = false;
  let isolatedPool = null;
  let server = null;
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    PGOPTIONS: process.env.PGOPTIONS,
    ERROR_LOG_FILE: process.env.ERROR_LOG_FILE,
  };

  try {
    await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
    schemaCreated = true;
  } catch (err) {
    await adminPool.end().catch(() => {});
    throw new Error(
      `PostgreSQL debe permitir crear el esquema temporal de pruebas (${err.code || err.message}).`,
      { cause: err }
    );
  }

  try {
    process.env.NODE_ENV = "test";
    process.env.PGOPTIONS = `-c search_path=${schemaName},public`;

    const { pool } = require("../../src/config/db");
    isolatedPool = pool;

    const baselineSql = await fs.readFile(SCHEMA_PATH, "utf8");
    await isolatedPool.query(baselineSql);

    const { runMigrations } = require("../../src/scripts/migrate-db");
    await runMigrations(isolatedPool);

    const { createApp } = require("../../src/app");
    const app = createApp();
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    return {
      baseUrl,
      pool: isolatedPool,
      schemaName,
      async cleanup() {
        let cleanupError = null;
        try {
          await closeServer(server);
        } catch (err) {
          cleanupError = err;
        }
        try {
          await isolatedPool.end();
        } catch (err) {
          cleanupError ||= err;
        }
        try {
          if (schemaCreated) await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
        } catch (err) {
          cleanupError ||= err;
        }
        try {
          await adminPool.end();
        } catch (err) {
          cleanupError ||= err;
        }
        restoreEnvironment(previousEnvironment);
        if (cleanupError) throw cleanupError;
      },
    };
  } catch (err) {
    await closeServer(server).catch(() => {});
    if (isolatedPool) await isolatedPool.end().catch(() => {});
    if (schemaCreated) await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`).catch(() => {});
    await adminPool.end().catch(() => {});
    restoreEnvironment(previousEnvironment);
    throw err;
  }
}

async function apiRequest(baseUrl, pathName, { method = "GET", token, body, idempotencyKey } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(baseUrl + pathName, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

module.exports = { apiRequest, createIntegrationEnvironment };
