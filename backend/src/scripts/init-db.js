// Crea el esquema base y después aplica las migraciones PostgreSQL pendientes.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { runMigrations } = require("./migrate-db");

async function main() {
  const schemaPath = path.resolve(__dirname, "../../database/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("✅ Esquema base de PostgreSQL creado o verificado.");
  await runMigrations(pool);
  console.log("✅ Esquema de PostgreSQL actualizado.");
}

main()
  .catch((err) => {
    console.error("❌ No se pudo inicializar la base de datos:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
