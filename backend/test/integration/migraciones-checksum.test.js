const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createIntegrationEnvironment } = require("../helpers/integration-env");
const { runMigrations, checksum } = require("../../src/scripts/migrate-db");

const VERSION = "019_productos_integridad_busqueda";
const RUTA = path.resolve(__dirname, "../../database/migrations", `${VERSION}.sql`);
const silencio = { logger: { log() {} } };

function hash(texto) {
  return crypto.createHash("sha256").update(texto, "utf8").digest("hex");
}

test("las sumas de migraciones son independientes de los finales de línea", { timeout: 240000 }, async () => {
  const environment = await createIntegrationEnvironment();
  const { pool } = environment;
  try {
    const lf = fs.readFileSync(RUTA, "utf8").replace(/\r\n?/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");

    const guardada = (await pool.query(
      `SELECT checksum FROM schema_migrations WHERE version=$1`, [VERSION]
    )).rows[0].checksum;
    assert.equal(String(guardada).trim(), checksum(lf), "la suma nueva se guarda en LF");

    await pool.query(`UPDATE schema_migrations SET checksum=$2 WHERE version=$1`, [VERSION, hash(crlf)]);
    await runMigrations(pool, silencio);

    await pool.query(`UPDATE schema_migrations SET checksum=$2 WHERE version=$1`, [VERSION, hash(lf)]);
    await runMigrations(pool, silencio);

    await pool.query(`UPDATE schema_migrations SET checksum=$2 WHERE version=$1`, [VERSION, hash("contenido distinto")]);
    await assert.rejects(
      runMigrations(pool, silencio),
      /cambió después de aplicarse/
    );
  } finally {
    await environment.cleanup();
  }
});
