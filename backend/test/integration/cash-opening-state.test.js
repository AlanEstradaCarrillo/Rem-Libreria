const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "PruebasSeguras!2026";
let sequence = 0;

const number = (value) => Number(value);

function expectStatus(response, expected, context) {
  assert.equal(response.status, expected,
    `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

async function seedRoles(pool) {
  for (const role of ["ADMIN", "SUPERVISOR", "CAJERO"]) {
    await pool.query(`INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`, [role]);
  }
}

async function createUser(pool, role = "CAJERO") {
  const label = `${role.toLowerCase()}-caja-${++sequence}`;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1, $2, $3, id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@tests.local`, passwordHash, role]
  );
  const user = { ...result.rows[0], role };
  const login = expectStatus(await apiRequest(pool.baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${role}`);
  return { ...user, token: login.token };
}

async function createRegister(pool, { active = true } = {}) {
  const result = await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1, $2) RETURNING id, nombre, activo`,
    [`Caja prueba ${++sequence}`, active]
  );
  return result.rows[0];
}

function openRegister(baseUrl, token, registerId, initial = 100) {
  return apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token,
    body: { caja_id: number(registerId), fondo_inicial: initial },
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("apertura y recuperación del estado de caja", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  pool.baseUrl = baseUrl;
  try {
    await seedRoles(pool);
    const admin = await createUser(pool, "ADMIN");
    const supervisor = await createUser(pool, "SUPERVISOR");
    const cashier = await createUser(pool, "CAJERO");
    const otherCashier = await createUser(pool, "CAJERO");

    await t.test("protege el catálogo de cajas y respeta cajas activas", async () => {
      const active = await createRegister(pool);
      const inactive = await createRegister(pool, { active: false });
      expectStatus(await apiRequest(baseUrl, "/caja/cajas"), 401, "cajas sin sesión");

      const cashierBoxes = expectStatus(await apiRequest(baseUrl, "/caja/cajas", {
        token: cashier.token,
      }), 200, "cajas para CAJERO");
      assert.ok(cashierBoxes.some((box) => number(box.id) === number(active.id)));
      assert.ok(!cashierBoxes.some((box) => number(box.id) === number(inactive.id)));

      const adminBoxes = expectStatus(await apiRequest(baseUrl, "/caja/cajas", {
        token: admin.token,
      }), 200, "cajas para ADMIN");
      const listedInactive = adminBoxes.find((box) => number(box.id) === number(inactive.id));
      assert.ok(listedInactive);
      assert.equal(listedInactive.activo, false);
      assert.equal(listedInactive.puede_operar, false);
    });

    await t.test("registra usuario, caja, fondo, fecha y movimiento en una transacción", async () => {
      const register = await createRegister(pool);
      const session = expectStatus(
        await openRegister(baseUrl, cashier.token, register.id, 125.50),
        201,
        "apertura válida"
      );
      assert.equal(number(session.caja_id), number(register.id));
      assert.equal(number(session.usuario_id), number(cashier.id));
      assert.equal(number(session.fondo_inicial), 125.5);
      assert.equal(session.estado, "ABIERTA");
      assert.equal(session.fecha_cierre, null);
      assert.ok(Number.isFinite(Date.parse(session.fecha_apertura)));

      const persisted = await pool.query(
        `SELECT s.*, m.id AS movimiento_id, m.caja_id AS movimiento_caja_id,
                m.usuario_id AS movimiento_usuario_id, m.monto AS movimiento_monto,
                m.actor_inferido
         FROM sesiones_caja s
         JOIN movimientos m ON m.sesion_id=s.id AND m.tipo='APERTURA'
         WHERE s.id=$1`,
        [session.id]
      );
      assert.equal(persisted.rowCount, 1);
      assert.equal(number(persisted.rows[0].movimiento_caja_id), number(register.id));
      assert.equal(number(persisted.rows[0].movimiento_usuario_id), number(cashier.id));
      assert.equal(number(persisted.rows[0].movimiento_monto), 125.5);
      assert.equal(persisted.rows[0].actor_inferido, false);

      const state = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: cashier.token }
      ), 200, "estado persistido");
      assert.equal(state.abierta, true);
      assert.equal(state.puede_operar, true);
      assert.equal(number(state.sesion.id), number(session.id));
      assert.equal(number(state.sesion.usuario_id), number(cashier.id));
      assert.equal(number(state.sesion.fondo_inicial), 125.5);
      assert.equal(number(state.esperado), 125.5);

      const boxes = expectStatus(await apiRequest(baseUrl, "/caja/cajas", {
        token: cashier.token,
      }), 200, "metadatos de sesión en cajas");
      const listed = boxes.find((box) => number(box.id) === number(register.id));
      assert.equal(listed.abierta, true);
      assert.equal(listed.puede_operar, true);
      assert.equal(number(listed.sesion_id), number(session.id));
      assert.equal(number(listed.sesion_usuario_id), number(cashier.id));
      assert.equal(listed.sesion_operador, cashier.nombre);
    });

    await t.test("rechaza fondos y cajas inválidos sin dejar registros parciales", async () => {
      const register = await createRegister(pool);
      for (const [label, body] of [
        ["fondo ausente", { caja_id: number(register.id) }],
        ["fondo negativo", { caja_id: number(register.id), fondo_inicial: -1 }],
        ["más de dos decimales", { caja_id: number(register.id), fondo_inicial: 10.001 }],
        ["fuera de rango", { caja_id: number(register.id), fondo_inicial: 10000000000 }],
        ["fondo de texto", { caja_id: number(register.id), fondo_inicial: "100" }],
      ]) {
        expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
          method: "POST", token: cashier.token, body,
        }), 400, label);
      }
      expectStatus(await openRegister(baseUrl, cashier.token, 2147483647, 10), 404,
        "caja inexistente");
      const inactive = await createRegister(pool, { active: false });
      expectStatus(await openRegister(baseUrl, cashier.token, inactive.id, 10), 409,
        "caja inactiva");
      expectStatus(await openRegister(baseUrl, null, register.id, 10), 401,
        "apertura sin sesión");

      const totals = await pool.query(
        `SELECT COUNT(*)::int AS total FROM sesiones_caja WHERE caja_id=$1`, [register.id]
      );
      assert.equal(totals.rows[0].total, 0);
    });

    await t.test("evita aperturas duplicadas secuenciales y concurrentes", async () => {
      const sequentialRegister = await createRegister(pool);
      expectStatus(await openRegister(baseUrl, cashier.token, sequentialRegister.id, 50), 201,
        "primera apertura");
      expectStatus(await openRegister(baseUrl, cashier.token, sequentialRegister.id, 50), 409,
        "segunda apertura");

      const concurrentRegister = await createRegister(pool);
      const results = await Promise.all([
        openRegister(baseUrl, cashier.token, concurrentRegister.id, 80),
        openRegister(baseUrl, otherCashier.token, concurrentRegister.id, 90),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      const stored = await pool.query(
        `SELECT s.id, COUNT(m.id)::int AS aperturas
         FROM sesiones_caja s
         JOIN movimientos m ON m.sesion_id=s.id AND m.tipo='APERTURA'
         WHERE s.caja_id=$1 AND s.estado='ABIERTA'
         GROUP BY s.id`,
        [concurrentRegister.id]
      );
      assert.equal(stored.rowCount, 1);
      assert.equal(stored.rows[0].aperturas, 1);
    });

    await t.test("revierte la sesión si falla el movimiento de apertura", async () => {
      const register = await createRegister(pool);
      await pool.query(`
        ALTER TABLE movimientos
        ADD CONSTRAINT prueba_bloquear_apertura_check
        CHECK (tipo <> 'APERTURA') NOT VALID
      `);
      try {
        expectStatus(await openRegister(baseUrl, cashier.token, register.id, 20), 400,
          "fallo provocado del movimiento");
      } finally {
        await pool.query(`ALTER TABLE movimientos DROP CONSTRAINT prueba_bloquear_apertura_check`);
      }
      const sessions = await pool.query(
        `SELECT COUNT(*)::int AS total FROM sesiones_caja WHERE caja_id=$1`, [register.id]
      );
      assert.equal(sessions.rows[0].total, 0);
    });

    await t.test("oculta importes a otro cajero y permite supervisión", async () => {
      const register = await createRegister(pool);
      const session = expectStatus(await openRegister(baseUrl, cashier.token, register.id, 70), 201,
        "apertura para privacidad");

      const foreign = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: otherCashier.token }
      ), 200, "estado para otro cajero");
      assert.equal(foreign.abierta, true);
      assert.equal(foreign.puede_operar, false);
      assert.equal(number(foreign.sesion.id), number(session.id));
      assert.equal("fondo_inicial" in foreign.sesion, false);
      assert.equal("esperado" in foreign, false);
      assert.equal("movimientos" in foreign, false);

      const privileged = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: supervisor.token }
      ), 200, "estado para supervisor");
      assert.equal(privileged.puede_operar, true);
      assert.equal(number(privileged.sesion.fondo_inicial), 70);
      assert.equal(number(privileged.esperado), 70);
    });

    await t.test("recupera la misma sesión desde una instancia nueva de la aplicación", async () => {
      const register = await createRegister(pool);
      const session = expectStatus(await openRegister(baseUrl, cashier.token, register.id, 33), 201,
        "apertura antes de reinicio");
      const { createApp } = require("../../src/app");
      const secondApp = createApp();
      const secondServer = await new Promise((resolve, reject) => {
        const server = secondApp.listen(0, "127.0.0.1", () => resolve(server));
        server.once("error", reject);
      });
      try {
        const address = secondServer.address();
        const secondBaseUrl = `http://127.0.0.1:${address.port}/api`;
        const recovered = expectStatus(await apiRequest(
          secondBaseUrl, `/caja/estado?caja_id=${register.id}`, { token: cashier.token }
        ), 200, "estado después de nueva instancia");
        assert.equal(recovered.abierta, true);
        assert.equal(number(recovered.sesion.id), number(session.id));
        assert.equal(number(recovered.esperado), 33);
      } finally {
        await closeServer(secondServer);
      }
    });

    await t.test("hace cumplir en PostgreSQL las invariantes de sesión y auditoría", async () => {
      const register = await createRegister(pool);
      await assert.rejects(
        pool.query(
          `INSERT INTO sesiones_caja
             (caja_id, usuario_id, fondo_inicial, estado, fecha_cierre)
           VALUES ($1,$2,0,'CERRADA',NULL)`,
          [register.id, cashier.id]
        ),
        (error) => error.code === "23514"
      );

      const session = expectStatus(await openRegister(baseUrl, admin.token, register.id, 0), 201,
        "apertura para índice de auditoría");
      await assert.rejects(
        pool.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, concepto, monto, actor_inferido)
           VALUES ($1,$2,$3,'APERTURA','Apertura duplicada',0,FALSE)`,
          [session.id, register.id, admin.id]
        ),
        (error) => error.code === "23505"
      );
    });
  } finally {
    delete pool.baseUrl;
    await environment.cleanup();
  }
});
