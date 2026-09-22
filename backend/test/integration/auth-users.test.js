const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "PruebasSeguras!2026";
let sequence = 0;

function expectStatus(response, expected, context) {
  assert.equal(response.status, expected,
    `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function seedRoles(pool) {
  for (const nombre of ["ADMIN", "SUPERVISOR", "CAJERO"]) {
    await pool.query(
      `INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`,
      [nombre]
    );
  }
  const result = await pool.query(`SELECT id, nombre FROM roles`);
  return Object.fromEntries(result.rows.map((role) => [role.nombre, Number(role.id)]));
}

async function createUser(pool, role, { active = true } = {}) {
  const label = `${role.toLowerCase()}-auth-${++sequence}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, $3, id, $5 FROM roles WHERE nombre = $4
     RETURNING id, nombre, email`,
    [label, `${label}@tests.local`, passwordHash, role, active]
  );
  return { ...result.rows[0], role, password: TEST_PASSWORD };
}

async function login(baseUrl, user) {
  const response = await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: user.password },
  });
  const body = expectStatus(response, 200, `login ${user.email}`);
  assert.ok(body.token);
  return { token: body.token, response, usuario: body.usuario };
}

test("autenticación, sesión, usuarios y permisos", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    const roleIds = await seedRoles(pool);
    const admin = await createUser(pool, "ADMIN");
    const supervisor = await createUser(pool, "SUPERVISOR");
    const cashier = await createUser(pool, "CAJERO");
    let adminToken;
    let supervisorToken;
    let cashierToken;

    await t.test("acepta credenciales correctas y valida la sesión actual", async () => {
      const response = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: `  ${admin.email.toUpperCase()}  `, password: admin.password },
      });
      const body = expectStatus(response, 200, "login ADMIN normalizado");
      adminToken = body.token;
      assert.deepEqual(body.usuario, {
        id: admin.id,
        nombre: admin.nombre,
        email: admin.email,
        rol: "ADMIN",
      });
      assert.match(response.headers.get("cache-control") || "", /no-store/i);

      const decodedHeader = JSON.parse(Buffer.from(adminToken.split(".")[0], "base64url").toString());
      assert.equal(decodedHeader.alg, "HS256");

      const meResponse = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `bEaReR ${adminToken}` },
        signal: AbortSignal.timeout(8000),
      });
      assert.equal(meResponse.status, 200);
      assert.match(meResponse.headers.get("cache-control") || "", /no-store/i);
      assert.deepEqual(await meResponse.json(), body.usuario);
    });

    await t.test("rechaza credenciales erróneas sin revelar si existe el correo", async () => {
      const wrongPassword = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: admin.email, password: "ClaveIncorrecta!2026" },
      });
      const unknownUser = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: "inexistente@tests.local", password: "ClaveIncorrecta!2026" },
      });
      expectStatus(wrongPassword, 401, "contraseña incorrecta");
      expectStatus(unknownUser, 401, "correo inexistente");
      assert.deepEqual(wrongPassword.body, { error: "Credenciales inválidas." });
      assert.deepEqual(unknownUser.body, wrongPassword.body);

      expectStatus(await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: "no-es-email", password: TEST_PASSWORD },
      }), 400, "email inválido");
      expectStatus(await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: admin.email, password: "corta" },
      }), 400, "contraseña demasiado corta");

      const inactive = await createUser(pool, "CAJERO", { active: false });
      const inactiveResponse = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: inactive.email, password: inactive.password },
      });
      expectStatus(inactiveResponse, 401, "usuario inactivo");
      assert.deepEqual(inactiveResponse.body, { error: "Credenciales inválidas." });
    });

    await t.test("rechaza tokens ausentes, inválidos, expirados o de otro algoritmo", async () => {
      expectStatus(await apiRequest(baseUrl, "/auth/me"), 401, "token ausente");

      const malformed = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: "Bearer token-invalido" },
        signal: AbortSignal.timeout(8000),
      });
      assert.equal(malformed.status, 401);

      const expired = jwt.sign(
        { sub: admin.id }, process.env.JWT_SECRET,
        { algorithm: "HS256", expiresIn: -1 }
      );
      const otherAlgorithm = jwt.sign(
        { sub: admin.id }, process.env.JWT_SECRET,
        { algorithm: "HS384", expiresIn: "5m" }
      );
      for (const [label, token] of [["expirado", expired], ["HS384", otherAlgorithm]]) {
        const response = await fetch(`${baseUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8000),
        });
        assert.equal(response.status, 401, `token ${label}`);
        assert.match((await response.json()).error, /inválido o expirado/i);
      }
    });

    await t.test("aplica de inmediato cambios de rol y desactivación", async () => {
      ({ token: cashierToken } = await login(baseUrl, cashier));
      expectStatus(await apiRequest(baseUrl, "/usuarios", { token: cashierToken }), 403,
        "CAJERO sin permiso administrativo");

      await pool.query(`UPDATE usuarios SET rol_id = $1 WHERE id = $2`, [roleIds.ADMIN, cashier.id]);
      const updatedMe = expectStatus(await apiRequest(baseUrl, "/auth/me", { token: cashierToken }), 200,
        "sesión con rol actualizado");
      assert.equal(updatedMe.rol, "ADMIN");
      expectStatus(await apiRequest(baseUrl, "/usuarios", { token: cashierToken }), 200,
        "token antiguo autorizado con rol actual");
      await pool.query(`UPDATE usuarios SET rol_id = $1 WHERE id = $2`, [roleIds.CAJERO, cashier.id]);

      const deactivated = await createUser(pool, "CAJERO");
      const { token } = await login(baseUrl, deactivated);
      await pool.query(`UPDATE usuarios SET activo = FALSE WHERE id = $1`, [deactivated.id]);
      expectStatus(await apiRequest(baseUrl, "/auth/me", { token }), 401,
        "token de usuario desactivado");
    });

    await t.test("restringe la administración de usuarios exclusivamente a ADMIN", async () => {
      ({ token: supervisorToken } = await login(baseUrl, supervisor));
      expectStatus(await apiRequest(baseUrl, "/usuarios"), 401, "usuarios sin sesión");
      expectStatus(await apiRequest(baseUrl, "/usuarios", { token: cashierToken }), 403,
        "usuarios como CAJERO");
      expectStatus(await apiRequest(baseUrl, "/usuarios", { token: supervisorToken }), 403,
        "usuarios como SUPERVISOR");

      const response = await apiRequest(baseUrl, "/usuarios", { token: adminToken });
      const users = expectStatus(response, 200, "usuarios como ADMIN");
      assert.ok(users.length >= 3);
      assert.ok(users.every((user) => !("password_hash" in user)));
      assert.match(response.headers.get("cache-control") || "", /no-store/i);
    });

    await t.test("crea usuarios con política segura y sin exponer la contraseña", async () => {
      const email = `  NUEVO.AUTH.${++sequence}@EXAMPLE.COM  `;
      const password = "NuevaClaveSegura!2026";
      const createdResponse = await apiRequest(baseUrl, "/usuarios", {
        method: "POST",
        token: adminToken,
        body: { nombre: "  Usuario Nuevo  ", email, password, rol_id: roleIds.CAJERO },
      });
      const created = expectStatus(createdResponse, 201, "alta de usuario");
      assert.deepEqual(created, {
        id: created.id,
        nombre: "Usuario Nuevo",
        email: email.trim().toLowerCase(),
      });
      assert.match(createdResponse.headers.get("cache-control") || "", /no-store/i);

      const stored = await pool.query(
        `SELECT nombre, email, password_hash FROM usuarios WHERE id = $1`, [created.id]
      );
      assert.equal(stored.rows[0].nombre, "Usuario Nuevo");
      assert.equal(stored.rows[0].email, email.trim().toLowerCase());
      assert.notEqual(stored.rows[0].password_hash, password);
      assert.equal(await bcrypt.compare(password, stored.rows[0].password_hash), true);

      const createdLogin = await apiRequest(baseUrl, "/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      });
      expectStatus(createdLogin, 200, "login del usuario creado");

      expectStatus(await apiRequest(baseUrl, "/usuarios", {
        method: "POST", token: adminToken,
        body: { nombre: "Clave Corta", email: "corta@tests.local", password: "12345678", rol_id: roleIds.CAJERO },
      }), 400, "clave menor de 12 caracteres");
      expectStatus(await apiRequest(baseUrl, "/usuarios", {
        method: "POST", token: adminToken,
        body: { nombre: "Clave Larga", email: "larga@tests.local", password: "á".repeat(40), rol_id: roleIds.CAJERO },
      }), 400, "clave mayor de 72 bytes");
      expectStatus(await apiRequest(baseUrl, "/usuarios", {
        method: "POST", token: adminToken,
        body: { nombre: "Rol Inexistente", email: "rol@tests.local", password, rol_id: 32767 },
      }), 400, "rol inexistente");
      expectStatus(await apiRequest(baseUrl, "/usuarios", {
        method: "POST", token: adminToken,
        body: { nombre: "Duplicado", email: email.trim(), password, rol_id: roleIds.CAJERO },
      }), 409, "correo duplicado");
    });

    await t.test("no limita las validaciones legítimas de sesión", async () => {
      for (let attempt = 0; attempt < 25; attempt++) {
        expectStatus(await apiRequest(baseUrl, "/auth/me", { token: adminToken }), 200,
          `validación de sesión ${attempt + 1}`);
      }
    });

    await t.test("limita los intentos repetidos de inicio de sesión", async () => {
      let limited = null;
      for (let attempt = 0; attempt < 30 && !limited; attempt++) {
        const response = await apiRequest(baseUrl, "/auth/login", {
          method: "POST",
          body: { email: "ataque@tests.local", password: "ClaveIncorrecta!2026" },
        });
        if (response.status === 429) limited = response;
      }
      assert.ok(limited, "el limitador debe responder 429 después de intentos repetidos");
      assert.match(limited.body.error, /Demasiados intentos/i);
    });
  } finally {
    await environment.cleanup();
  }
});
