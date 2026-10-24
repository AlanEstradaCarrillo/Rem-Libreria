// Ejecuta, en orden y una sola vez, las migraciones SQL versionadas.
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");

const MIGRATIONS_DIR = path.resolve(__dirname, "../../database/migrations");
const MIGRATION_FILE_RE = /^\d{3}_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 724372092;

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function hash(texto) {
  return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

function aLF(sql) {
  return sql.replace(/\r\n?/g, "\n");
}

/** Suma de referencia: el contenido con finales de línea LF, que es como se guarda en el repositorio. */
function checksum(sql) {
  return hash(aLF(sql));
}

/**
 * Sumas aceptadas para un archivo. Las bases migradas antes de normalizar los
 * finales de línea guardaron la suma del contenido crudo, con LF o con CRLF según
 * el checkout de su máquina; por eso se aceptan las tres variantes.
 */
function checksumVariantes(sql) {
  const lf = aLF(sql);
  return new Set([hash(sql), hash(lf), hash(lf.replace(/\n/g, "\r\n"))]);
}

/**
 * Aplica las migraciones pendientes usando una sola conexión del pool.
 * Cada archivo se confirma junto con su registro en schema_migrations.
 */
async function runMigrations(db = pool, { logger = console } = {}) {
  if (!db || typeof db.connect !== "function") {
    throw new TypeError("runMigrations requiere un pool PostgreSQL con connect().");
  }

  const client = await db.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    locked = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(120) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        aplicado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version"
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [row.version, String(row.checksum).trim()])
    );

    const executed = [];
    for (const file of migrationFiles()) {
      const version = path.basename(file, ".sql");
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const previousDigest = applied.get(version);

      if (previousDigest) {
        if (!checksumVariantes(sql).has(previousDigest)) {
          throw new Error(
            `La migración ${version} cambió después de aplicarse; restaura su contenido original.`
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [version, checksum(sql)]
        );
        await client.query("COMMIT");
        executed.push(version);
        logger.log(`✅ Migración aplicada: ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    if (executed.length === 0) logger.log("ℹ️ No hay migraciones pendientes.");
    return executed;
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
        .catch(() => undefined);
    }
    client.release();
  }
}

async function main() {
  await runMigrations(pool);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error("❌ No se pudieron aplicar las migraciones:", error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { runMigrations, checksum, checksumVariantes };
