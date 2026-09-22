// Inserta únicamente los datos mínimos que la interfaz original da por hechos.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool, tx } = require("../config/db");

const usuariosIniciales = [
  {
    nombre: "Administrador",
    email: "admin@libra.mx",
    password: process.env.SEED_ADMIN_PASSWORD,
    rol: "ADMIN",
  },
  {
    nombre: "Caja",
    email: "caja@libra.mx",
    password: process.env.SEED_CASHIER_PASSWORD,
    rol: "CAJERO",
  },
];

function validarPassword(nombre, password) {
  if (!password || password.includes("CAMBIA_") || password.length < 12 || password.length > 72) {
    throw new Error(`${nombre} debe existir y tener entre 12 y 72 caracteres.`);
  }
  if (bcrypt.truncates(password)) {
    throw new Error(`${nombre} supera los 72 bytes permitidos por bcrypt.`);
  }
}

async function main() {
  await tx(async (client) => {
    for (const nombre of ["ADMIN", "SUPERVISOR", "CAJERO"]) {
      await client.query(
        `INSERT INTO roles (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO NOTHING`,
        [nombre]
      );
    }

    await client.query(
      `INSERT INTO caja (id) VALUES (1)
       ON CONFLICT (id) DO NOTHING`
    );
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('caja', 'id'),
         GREATEST((SELECT COALESCE(MAX(id), 1) FROM caja), 1),
         TRUE
       )`
    );

    for (const usuario of usuariosIniciales) {
      const existe = await client.query(
        `SELECT id FROM usuarios WHERE lower(email) = lower($1) LIMIT 1`,
        [usuario.email]
      );
      if (existe.rows[0]) continue;

      const variable = usuario.rol === "ADMIN" ? "SEED_ADMIN_PASSWORD" : "SEED_CASHIER_PASSWORD";
      validarPassword(variable, usuario.password);

      const rol = await client.query(
        `SELECT id FROM roles WHERE nombre = $1 LIMIT 1`,
        [usuario.rol]
      );
      const passwordHash = await bcrypt.hash(usuario.password, 12);
      await client.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
         VALUES ($1, lower($2), $3, $4)`,
        [usuario.nombre, usuario.email, passwordHash, rol.rows[0].id]
      );
    }
  });

  console.log("✅ Roles, caja 1 y usuarios iniciales creados o verificados.");
  console.log("ℹ️ El archivo original no incluía categorías ni productos; no se agregaron datos ficticios.");
}

main()
  .catch((err) => {
    console.error("❌ No se pudieron insertar los datos iniciales:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
