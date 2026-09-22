const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const PASSWORD = "PruebasCaja!2026";
const num = Number;

function expectStatus(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body;
}

async function user(pool, baseUrl, role, name) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const created = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4 RETURNING id, nombre, email`,
    [name, `${name.toLowerCase()}@tests.local`, hash, role]
  );
  const token = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST", body: { email: created.rows[0].email, password: PASSWORD },
  }), 200).token;
  return { ...created.rows[0], token };
}

async function register(pool, baseUrl, owner, name, initial) {
  const caja = (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1,TRUE) RETURNING id, nombre`, [name]
  )).rows[0];
  const sesion = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST", token: owner.token,
    body: { caja_id: num(caja.id), fondo_inicial: initial },
  }), 201);
  return { caja, sesion };
}

function manual(baseUrl, actor, type, sesionId, monto, concepto, key = randomUUID()) {
  return apiRequest(baseUrl, `/caja/${type}`, {
    method: "POST", token: actor.token, idempotencyKey: key,
    body: { sesion_id: num(sesionId), monto, concepto },
  });
}

test("movimientos de caja conciliados e idempotentes", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    for (const role of ["SUPERVISOR", "CAJERO"]) {
      await pool.query(`INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`, [role]);
    }
    const supervisor = await user(pool, baseUrl, "SUPERVISOR", "SupervisorCaja");
    const cashier = await user(pool, baseUrl, "CAJERO", "CajeroCaja");

    await t.test("concilia ventas, ingresos y retiros con usuario, caja, sesión y fecha", async () => {
      const a = await register(pool, baseUrl, cashier, "Caja A", 100);
      const b = await register(pool, baseUrl, cashier, "Caja B", 200);
      const products = (await pool.query(
        `INSERT INTO productos (sku,titulo,precio,costo,stock,iva,activo)
         VALUES ('CAJA-50','Libro 50',50,0,5,0,TRUE),
                ('CAJA-30','Libro 30',30,0,5,0,TRUE)
         RETURNING id, precio`
      )).rows.sort((left, right) => num(left.id) - num(right.id));
      for (const [product, method] of [[products[0], "EFECTIVO"], [products[1], "TARJETA"]]) {
        const body = {
          sesion_id: num(a.sesion.id), metodo_pago: method,
          items: [{ producto_id: num(product.id), cantidad: 1 }],
        };
        if (method === "EFECTIVO") body.recibido = 100;
        expectStatus(await apiRequest(baseUrl, "/ventas", {
          method: "POST", token: cashier.token, idempotencyKey: randomUUID(), body,
        }), 201);
      }
      const ingreso = expectStatus(await manual(
        baseUrl, supervisor, "ingreso", a.sesion.id, 20.25, "Aporte de cambio"
      ), 201);
      const retiro = expectStatus(await manual(
        baseUrl, supervisor, "retiro", a.sesion.id, 40.10, "Retiro autorizado"
      ), 201);

      for (const [movement, type, amount, concept] of [
        [ingreso, "INGRESO", 20.25, "Aporte de cambio"],
        [retiro, "RETIRO", 40.10, "Retiro autorizado"],
      ]) {
        const stored = (await pool.query(`SELECT * FROM movimientos WHERE id=$1`, [movement.id])).rows[0];
        assert.equal(stored.tipo, type);
        assert.equal(num(stored.monto), amount);
        assert.equal(stored.concepto, concept);
        assert.equal(num(stored.usuario_id), num(supervisor.id));
        assert.equal(num(stored.caja_id), num(a.caja.id));
        assert.equal(num(stored.sesion_id), num(a.sesion.id));
        assert.ok(new Date(stored.creado_en).getTime() > 0);
        assert.equal(num(movement.id), num(stored.id));
      }
      const stateA = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${a.caja.id}`, { token: cashier.token }
      ), 200);
      const stateB = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${b.caja.id}`, { token: cashier.token }
      ), 200);
      assert.equal(num(stateA.ventas_efectivo), 50);
      assert.equal(num(stateA.ventas_tarjeta), 30);
      assert.equal(num(stateA.ingresos), 20.25);
      assert.equal(num(stateA.retiros), 40.10);
      assert.equal(num(stateA.esperado), 130.15);
      assert.equal(num(stateB.esperado), 200);
      assert.equal(stateB.movimientos.some((m) => num(m.id) === num(ingreso.id)), false);
      for (const movement of [ingreso, retiro]) {
        const visible = stateA.movimientos.find((m) => num(m.id) === num(movement.id));
        assert.equal(visible.usuario, supervisor.nombre);
        assert.equal(visible.concepto, movement.concepto);
        assert.equal(visible.creado_en, movement.creado_en);
      }
      const foreign = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${a.caja.id}`, { token: supervisor.token }
      ), 200);
      assert.equal(num(foreign.esperado), 130.15);
    });

    await t.test("rechaza importes, conceptos, permisos y sesiones inválidas sin escribir", async () => {
      const { caja, sesion } = await register(pool, baseUrl, cashier, "Caja validación", 100);
      expectStatus(await manual(baseUrl, cashier, "ingreso", sesion.id, 1, "Sin permiso"), 403);
      for (const [monto, concepto] of [[0, "Válido"], [-1, "Válido"],
        [1.001, "Válido"], [10000000000, "Válido"], [1, "No"], [1, "x".repeat(161)]]) {
        expectStatus(await manual(baseUrl, supervisor, "retiro", sesion.id, monto, concepto), 400);
      }
      expectStatus(await manual(baseUrl, supervisor, "retiro", sesion.id, 100.01, "Excede efectivo"), 409);
      expectStatus(await manual(baseUrl, supervisor, "ingreso", 999999, 1, "Sesión inexistente"), 409);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM movimientos WHERE sesion_id=$1 AND tipo IN ('INGRESO','RETIRO')`,
        [sesion.id]
      )).rows[0].n, 0);
      expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST", token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: num(sesion.id), efectivo_contado: 100 },
      }), 201);
      expectStatus(await manual(baseUrl, supervisor, "ingreso", sesion.id, 1, "Caja cerrada"), 409);
      assert.equal(expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${caja.id}`, { token: cashier.token }
      ), 200).abierta, false);
    });

    await t.test("reproduce la misma operación y serializa retiros concurrentes", async () => {
      const { sesion } = await register(pool, baseUrl, cashier, "Caja concurrencia", 100);
      const key = randomUUID();
      const responses = await Promise.all([
        manual(baseUrl, supervisor, "ingreso", sesion.id, 10, "Ingreso único", key),
        manual(baseUrl, supervisor, "ingreso", sesion.id, 10, "Ingreso único", key),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
      assert.equal(num(responses[0].body.id), num(responses[1].body.id));
      expectStatus(await manual(baseUrl, supervisor, "ingreso", sesion.id, 11, "Ingreso único", key), 409);
      const race = await Promise.all([
        manual(baseUrl, supervisor, "retiro", sesion.id, 70, "Primero"),
        manual(baseUrl, supervisor, "retiro", sesion.id, 70, "Segundo"),
      ]);
      assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
      const stored = await pool.query(
        `SELECT tipo, monto FROM movimientos WHERE sesion_id=$1 AND tipo IN ('INGRESO','RETIRO') ORDER BY id`,
        [sesion.id]
      );
      assert.deepEqual(stored.rows.map((m) => [m.tipo, num(m.monto)]),
        [["INGRESO", 10], ["RETIRO", 70]]);
      expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST", token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: num(sesion.id), efectivo_contado: 40 },
      }), 201);
      const recovered = expectStatus(await manual(
        baseUrl, supervisor, "ingreso", sesion.id, 10, "Ingreso único", key
      ), 200);
      assert.equal(num(recovered.id), num(responses[0].body.id));
    });

    await t.test("revierte el registro y la clave ante un fallo de PostgreSQL", async () => {
      const { sesion } = await register(pool, baseUrl, cashier, "Caja rollback", 100);
      await pool.query(
        `CREATE FUNCTION bloquear_ingreso_prueba() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.tipo='INGRESO' AND NEW.concepto='Fallo simulado' THEN
             RAISE EXCEPTION 'Fallo simulado';
           END IF;
           RETURN NEW;
         END $$`
      );
      await pool.query(
        `CREATE TRIGGER bloquear_ingreso_prueba BEFORE INSERT ON movimientos
         FOR EACH ROW EXECUTE FUNCTION bloquear_ingreso_prueba()`
      );
      const key = randomUUID();
      expectStatus(await manual(baseUrl, supervisor, "ingreso", sesion.id, 5,
        "Fallo simulado", key), 500);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM movimientos WHERE sesion_id=$1 AND tipo='INGRESO'`,
        [sesion.id]
      )).rows[0].n, 0);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='CAJA_INGRESO' AND clave=$2`,
        [supervisor.id, key]
      )).rows[0].n, 0);
      await pool.query(`DROP TRIGGER bloquear_ingreso_prueba ON movimientos`);
      await pool.query(`DROP FUNCTION bloquear_ingreso_prueba()`);
      expectStatus(await manual(baseUrl, supervisor, "ingreso", sesion.id, 5,
        "Fallo simulado", key), 201);
    });
  } finally {
    await environment.cleanup();
  }
});
