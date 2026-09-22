// Ensayo seguro de backup/restore sobre una base PostgreSQL temporal.
// Nunca apunta a la base operativa para destruirla: genera y valida su propio nombre.
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env"), quiet: true });

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const { runMigrations } = require("./migrate-db");

const execFileAsync = promisify(execFile);
const CONFIRMATION = "I_UNDERSTAND_THIS_USES_A_TEMPORARY_DATABASE";
const DATABASE_RE = /^libra_pos_backup_test_[0-9]+_[0-9]+$/;

function quoteIdentifier(identifier) {
  if (!DATABASE_RE.test(identifier)) throw new Error("Nombre de base temporal no seguro.");
  return `"${identifier}"`;
}

function connectionSettings() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatoria.");
  const url = new URL(process.env.DATABASE_URL);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw new Error("DATABASE_URL debe usar PostgreSQL.");
  return {
    host: url.hostname || "127.0.0.1",
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl: process.env.PGSSL === "1" ? { rejectUnauthorized: false } : false,
    sslMode: process.env.PGSSL === "1" ? "require" : "disable",
  };
}

function pgTool(name) {
  const binDir = process.env.PG_BIN_DIR || (process.platform === "win32"
    ? "C:\\Program Files\\PostgreSQL\\18\\bin"
    : "");
  return path.join(binDir, process.platform === "win32" ? `${name}.exe` : name);
}

function childEnvironment(settings, database) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.PGOPTIONS;
  env.PGHOST = settings.host;
  env.PGPORT = settings.port;
  env.PGUSER = settings.user;
  env.PGPASSWORD = settings.password;
  env.PGDATABASE = database;
  env.PGSSLMODE = settings.sslMode;
  return env;
}

async function runPostgresTool(tool, args, env) {
  try {
    await execFileAsync(tool, args, {
      env,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Falló ${path.basename(tool)} (${error.code || "salida no cero"}).`, { cause: error });
  }
}

async function applyStructure(pool) {
  const backendRoot = path.resolve(__dirname, "../..");
  const schemaSql = await fs.readFile(path.join(backendRoot, "database", "schema.sql"), "utf8");
  await pool.query(schemaSql);
  await runMigrations(pool, { logger: { log() {} } });
}

async function expectedMigrationCount() {
  const migrationsPath = path.resolve(__dirname, "../../database/migrations");
  const files = await fs.readdir(migrationsPath);
  return files.filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).length;
}

async function main() {
  if (process.env.BACKUP_RESTORE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Para proteger datos reales, define BACKUP_RESTORE_CONFIRM=${CONFIRMATION}.`);
  }

  const settings = connectionSettings();
  const adminPool = new Pool(settings);
  const databaseName = `libra_pos_backup_test_${process.pid}_${Date.now()}`;
  const quotedDatabase = quoteIdentifier(databaseName);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "libra-pos-backup-"));
  const dumpPath = path.join(tempRoot, `${databaseName}.dump`);
  let temporaryDatabaseExists = false;
  let temporaryPool = null;

  try {
    await adminPool.query("SELECT 1");
    await adminPool.query(`CREATE DATABASE ${quotedDatabase}`);
    temporaryDatabaseExists = true;

    temporaryPool = new Pool({ ...settings, database: databaseName });
    await applyStructure(temporaryPool);
    const sku = `BACKUP-${Date.now()}`;
    await temporaryPool.query(
      `INSERT INTO roles (nombre) VALUES ('SUPERVISOR') ON CONFLICT (nombre) DO NOTHING`
    );
    const role = await temporaryPool.query("SELECT id FROM roles WHERE nombre='SUPERVISOR'");
    await temporaryPool.query(
      `INSERT INTO productos (sku, titulo, precio, costo, stock)
       VALUES ($1, $2, $3, $4, $5)`,
      [sku, "Producto centinela de respaldo", 123.45, 50, 7]
    );
    const before = await temporaryPool.query(
      "SELECT sku, titulo, precio::text, stock FROM productos WHERE sku=$1",
      [sku]
    );
    if (!before.rows[0] || !role.rows[0]) throw new Error("No se pudo preparar el dato centinela.");
    await temporaryPool.end();
    temporaryPool = null;

    const toolEnv = childEnvironment(settings, databaseName);
    await runPostgresTool(pgTool("pg_dump"), [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--file=${dumpPath}`,
    ], toolEnv);
    await fs.access(dumpPath);

    await adminPool.query(`DROP DATABASE ${quotedDatabase} WITH (FORCE)`);
    temporaryDatabaseExists = false;
    await adminPool.query(`CREATE DATABASE ${quotedDatabase}`);
    temporaryDatabaseExists = true;

    await runPostgresTool(pgTool("pg_restore"), [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      `--dbname=${databaseName}`,
      dumpPath,
    ], toolEnv);

    temporaryPool = new Pool({ ...settings, database: databaseName });
    const after = await temporaryPool.query(
      "SELECT sku, titulo, precio::text, stock FROM productos WHERE sku=$1",
      [sku]
    );
    const migrationCount = await temporaryPool.query("SELECT COUNT(*)::int AS total FROM schema_migrations");
    const pending = await runMigrations(temporaryPool, { logger: { log() {} } });
    const expectedMigrations = await expectedMigrationCount();
    if (!after.rows[0]
      || after.rows[0].sku !== before.rows[0].sku
      || after.rows[0].titulo !== before.rows[0].titulo
      || after.rows[0].precio !== before.rows[0].precio
      || after.rows[0].stock !== before.rows[0].stock
      || migrationCount.rows[0].total !== expectedMigrations
      || pending.length !== 0) {
      throw new Error("La restauración no conservó el dato centinela o el esquema esperado.");
    }
    console.log(`✅ Backup y restore temporal verificados (${migrationCount.rows[0].total} migraciones, datos conservados).`);
  } finally {
    if (temporaryPool) await temporaryPool.end().catch(() => undefined);
    if (temporaryDatabaseExists) {
      await adminPool.query(`DROP DATABASE ${quotedDatabase} WITH (FORCE)`).catch(() => undefined);
    }
    await adminPool.end().catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`❌ No se pudo verificar backup/restore: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, quoteIdentifier };
