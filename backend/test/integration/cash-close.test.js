const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const PASSWORD = "PruebasCorte!2026";
const num = Number;

function expectStatus(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body;
}

async function createUser(pool, baseUrl, role, name) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const created = (await pool.query(
    `INSERT INTO usuarios (nombre,email,password_hash,rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4 RETURNING id,nombre,email`,
    [name, `${name.toLowerCase()}@tests.local`, hash, role]
  )).rows[0];
  const login = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST", body: { email: created.email, password: PASSWORD },
  }), 200);
  return { ...created, token: login.token };
}

async function openCash(pool, baseUrl, owner, name, initial) {
  const register = (await pool.query(
    `INSERT INTO caja (nombre,activo) VALUES ($1,TRUE) RETURNING id,nombre`, [name]
  )).rows[0];
  const session = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST", token: owner.token,
    body: { caja_id: num(register.id), fondo_inicial: initial },
  }), 201);
  return { register, session };
}

function cut(baseUrl, actor, sessionId, counted, key = randomUUID()) {
  return apiRequest(baseUrl, "/caja/corte", {
    method: "POST", token: actor.token, idempotencyKey: key,
    body: { sesion_id: num(sessionId), efectivo_contado: counted },
  });
}

test("cierre y corte de caja conciliados", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    for (const role of ["SUPERVISOR", "CAJERO"]) {
      await pool.query(`INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`, [role]);
    }
    const owner = await createUser(pool, baseUrl, "CAJERO", "CajeroCorte");
    const other = await createUser(pool, baseUrl, "CAJERO", "OtroCajeroCorte");
    const supervisor = await createUser(pool, baseUrl, "SUPERVISOR", "SupervisorCorte");

    await t.test("concilia todos los medios, persiste la diferencia y bloquea ventas cerradas", async () => {
      const { register, session } = await openCash(pool, baseUrl, owner, "Caja corte integral", 100);
      const product = (await pool.query(
        `INSERT INTO productos (sku,titulo,precio,costo,stock,iva,activo)
         VALUES ('CORTE-10','Libro de corte',10,0,5,0,TRUE) RETURNING id`
      )).rows[0];
      for (const method of ["EFECTIVO", "TARJETA", "TRANSFERENCIA"]) {
        const body = {
          sesion_id: num(session.id), metodo_pago: method,
          items: [{ producto_id: num(product.id), cantidad: 1 }],
        };
        if (method === "EFECTIVO") body.recibido = 10;
        expectStatus(await apiRequest(baseUrl, "/ventas", {
          method: "POST", token: owner.token, idempotencyKey: randomUUID(), body,
        }), 201);
      }
      for (const [path, monto, concepto] of [
        ["ingreso", 5, "Ingreso de cambio"], ["retiro", 7, "Retiro autorizado"],
      ]) {
        expectStatus(await apiRequest(baseUrl, `/caja/${path}`, {
          method: "POST", token: supervisor.token, idempotencyKey: randomUUID(),
          body: { sesion_id: num(session.id), monto, concepto },
        }), 201);
      }
      const before = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: owner.token }
      ), 200);
      assert.equal(num(before.esperado), 108);
      const key = randomUUID();
      const result = expectStatus(await cut(baseUrl, owner, session.id, 106.50, key), 201);
      for (const [field, expected] of Object.entries({
        n_ventas: 3, ventas_efectivo: 10, ventas_tarjeta: 10, ventas_transf: 10,
        ingresos: 5, retiros: 7, efectivo_esperado: 108,
        efectivo_contado: 106.50, diferencia: -1.50,
      })) assert.equal(num(result[field]), expected, field);
      assert.equal(num(result.usuario_id), num(owner.id));
      assert.equal(num(result.sesion_id), num(session.id));

      const stored = (await pool.query(`SELECT * FROM cortes WHERE sesion_id=$1`, [session.id])).rows;
      assert.equal(stored.length, 1);
      assert.equal(num(stored[0].id), num(result.id));
      const closed = (await pool.query(
        `SELECT estado,fecha_apertura,fecha_cierre FROM sesiones_caja WHERE id=$1`, [session.id]
      )).rows[0];
      assert.equal(closed.estado, "CERRADA");
      assert.ok(new Date(closed.fecha_cierre).getTime() >= new Date(closed.fecha_apertura).getTime());
      const movements = (await pool.query(
        `SELECT * FROM movimientos WHERE sesion_id=$1 AND tipo='CIERRE'`, [session.id]
      )).rows;
      assert.equal(movements.length, 1);
      assert.equal(num(movements[0].caja_id), num(register.id));
      assert.equal(num(movements[0].usuario_id), num(owner.id));
      assert.equal(num(movements[0].monto), 0);

      const visible = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: owner.token }
      ), 200);
      assert.equal(visible.abierta, false);
      assert.equal(num(visible.ultimo_corte.id), num(result.id));
      assert.equal(num(visible.ultimo_corte.diferencia), -1.50);
      assert.equal(visible.ultimo_corte.responsable, owner.nombre);
      const foreign = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: other.token }
      ), 200);
      assert.equal("ultimo_corte" in foreign, false);
      const supervised = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: supervisor.token }
      ), 200);
      assert.equal(num(supervised.ultimo_corte.id), num(result.id));
      expectStatus(await apiRequest(baseUrl, "/caja/cortes", { token: owner.token }), 403);

      const replay = expectStatus(await cut(baseUrl, owner, session.id, 106.50, key), 200);
      assert.equal(num(replay.id), num(result.id));
      expectStatus(await cut(baseUrl, owner, session.id, 107, key), 409);
      expectStatus(await cut(baseUrl, owner, session.id, 106.50), 409);
      const sale = await apiRequest(baseUrl, "/ventas", {
        method: "POST", token: owner.token, idempotencyKey: randomUUID(),
        body: { sesion_id: num(session.id), metodo_pago: "EFECTIVO", recibido: 10,
          items: [{ producto_id: num(product.id), cantidad: 1 }] },
      });
      expectStatus(sale, 409);
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 2);
    });

    await t.test("rechaza importes y permisos inválidos; dos cierres no se duplican", async () => {
      const { session } = await openCash(pool, baseUrl, owner, "Caja concurrencia corte", 50);
      for (const amount of [-1, 1.001, 10000000000]) {
        expectStatus(await cut(baseUrl, owner, session.id, amount), 400);
      }
      expectStatus(await cut(baseUrl, other, session.id, 50), 403);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM cortes WHERE sesion_id=$1`, [session.id]
      )).rows[0].n, 0);
      const responses = await Promise.all([
        cut(baseUrl, owner, session.id, 50), cut(baseUrl, owner, session.id, 50),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM cortes WHERE sesion_id=$1`, [session.id]
      )).rows[0].n, 1);
    });

    await t.test("revierte corte, cierre y clave si falla el movimiento final", async () => {
      const { session } = await openCash(pool, baseUrl, owner, "Caja rollback corte", 20);
      await pool.query(
        `CREATE FUNCTION bloquear_cierre_prueba() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.tipo='CIERRE' THEN RAISE EXCEPTION 'Fallo de cierre simulado'; END IF;
           RETURN NEW;
         END $$`
      );
      await pool.query(
        `CREATE TRIGGER bloquear_cierre_prueba BEFORE INSERT ON movimientos
         FOR EACH ROW EXECUTE FUNCTION bloquear_cierre_prueba()`
      );
      const key = randomUUID();
      expectStatus(await cut(baseUrl, owner, session.id, 20, key), 500);
      assert.equal((await pool.query(`SELECT estado FROM sesiones_caja WHERE id=$1`, [session.id])).rows[0].estado,
        "ABIERTA");
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM cortes WHERE sesion_id=$1`, [session.id]
      )).rows[0].n, 0);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM movimientos WHERE sesion_id=$1 AND tipo='CIERRE'`, [session.id]
      )).rows[0].n, 0);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='CORTE_CAJA' AND clave=$2`, [owner.id, key]
      )).rows[0].n, 0);
      await pool.query(`DROP TRIGGER bloquear_cierre_prueba ON movimientos`);
      await pool.query(`DROP FUNCTION bloquear_cierre_prueba()`);
      expectStatus(await cut(baseUrl, owner, session.id, 20, key), 201);
    });
  } finally {
    await environment.cleanup();
  }
});
