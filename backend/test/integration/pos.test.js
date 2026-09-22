const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "PruebasSeguras!2026";
let sequence = 0;

const number = (value) => Number(value);
const saleFrom = (body) => (body && body.venta ? body.venta : body);
const eventFrom = (body, name) => (body && body[name] ? body[name] : body);
const nextLabel = (prefix) => `${prefix}-${++sequence}`;

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
  const label = nextLabel(role.toLowerCase());
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1, $2, $3, id FROM roles WHERE nombre = $4
     RETURNING id, nombre, email`,
    [label, `${label}@tests.local`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login de ${user.email}`);
  assert.ok(body.token);
  return body.token;
}

async function createCashier(pool, baseUrl) {
  const user = await createUser(pool);
  return { ...user, token: await login(baseUrl, user) };
}

async function createRegister(pool) {
  const result = await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1, TRUE) RETURNING id, nombre, activo`,
    [nextLabel("Caja")]
  );
  return result.rows[0];
}

async function createProduct(pool, { stock = 10, price = 50 } = {}) {
  const label = nextLabel("libro");
  const result = await pool.query(
    `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
     VALUES ($1, $2, $3, 0, $4, 16, TRUE)
     RETURNING id, titulo, precio, stock`,
    [`T-${sequence}`, label, price, stock]
  );
  return result.rows[0];
}

async function openRegister(baseUrl, cashier, register, initial = 100) {
  const body = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST", token: cashier.token,
    body: { caja_id: number(register.id), fondo_inicial: initial },
  }), 201, "apertura de caja");
  const session = body.sesion || body;
  assert.ok(session.id);
  return session;
}

async function createSale(baseUrl, token, sessionId, productId, quantity, options = {}) {
  const paymentMethod = options.method || "EFECTIVO";
  const body = {
    sesion_id: number(sessionId),
    metodo_pago: paymentMethod,
    cliente: "CLIENTE DE PRUEBA",
    items: [{ producto_id: number(productId), cantidad: quantity }],
  };
  if (paymentMethod === "EFECTIVO") body.recibido = options.received ?? 10000;
  return apiRequest(baseUrl, "/ventas", {
    method: "POST", token, body,
    idempotencyKey: options.key || randomUUID(),
  });
}

test("POS estable: integración transaccional con PostgreSQL real", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await seedRoles(pool);
    const supervisor = await createUser(pool, "SUPERVISOR");
    supervisor.token = await login(baseUrl, supervisor);

    await t.test("asocia venta y movimiento con usuario, caja y sesión", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 5, price: 50 });
      const session = await openRegister(baseUrl, cashier, register, 100);
      const cashierProduct = expectStatus(await apiRequest(
        baseUrl, `/productos/${product.id}`, { token: cashier.token }
      ), 200, "producto visible para cajero");
      const supervisorProduct = expectStatus(await apiRequest(
        baseUrl, `/productos/${product.id}`, { token: supervisor.token }
      ), 200, "producto visible para supervisor");
      assert.equal("costo" in cashierProduct, false);
      assert.equal("costo" in supervisorProduct, true);
      const sale = saleFrom(expectStatus(
        await createSale(baseUrl, cashier.token, session.id, product.id, 2, { received: 100 }),
        201, "venta nueva"
      ));

      const stored = await pool.query(
        `SELECT v.*, s.caja_id AS caja_de_sesion
         FROM ventas v JOIN sesiones_caja s ON s.id = v.sesion_id WHERE v.id = $1`, [sale.id]
      );
      assert.equal(number(stored.rows[0].usuario_id), number(cashier.id));
      assert.equal(number(stored.rows[0].caja_id), number(register.id));
      assert.equal(number(stored.rows[0].sesion_id), number(session.id));
      assert.equal(number(stored.rows[0].caja_de_sesion), number(register.id));

      const movement = await pool.query(
        `SELECT * FROM movimientos WHERE venta_id = $1 AND tipo = 'VENTA'`, [sale.id]
      );
      assert.equal(movement.rowCount, 1);
      assert.equal(number(movement.rows[0].usuario_id), number(cashier.id));
      assert.equal(number(movement.rows[0].caja_id), number(register.id));
      assert.equal(number(movement.rows[0].sesion_id), number(session.id));
      assert.equal(movement.rows[0].metodo_pago, "EFECTIVO");
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 3);

      const recent = expectStatus(await apiRequest(baseUrl, "/ventas", {
        token: cashier.token,
      }), 200, "ventas recientes");
      const listed = recent.find((item) => number(item.id) === number(sale.id));
      assert.ok(listed);
      assert.equal(number(listed.caja_id), number(register.id));
      assert.equal(listed.caja_nombre, register.nombre);
    });

    await t.test("aísla dos cajas abiertas y exige la sesión correcta", async () => {
      const cashierA = await createCashier(pool, baseUrl);
      const cashierB = await createCashier(pool, baseUrl);
      const registerA = await createRegister(pool);
      const registerB = await createRegister(pool);
      const product = await createProduct(pool, { stock: 10, price: 25 });
      const sessionA = await openRegister(baseUrl, cashierA, registerA, 100);
      const sessionB = await openRegister(baseUrl, cashierB, registerB, 300);

      expectStatus(await createSale(baseUrl, cashierA.token, sessionB.id, product.id, 1),
        403, "cobro en sesión ajena");
      const sale = saleFrom(expectStatus(
        await createSale(baseUrl, cashierB.token, sessionB.id, product.id, 2, { received: 50 }),
        201, "venta en caja B"
      ));
      assert.equal(number(sale.caja_id), number(registerB.id));

      const stateA = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${registerA.id}`, { token: cashierA.token }
      ), 200, "estado caja A");
      const stateB = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${registerB.id}`, { token: cashierB.token }
      ), 200, "estado caja B");
      assert.equal(number(stateA.sesion.id), number(sessionA.id));
      assert.equal(number(stateB.sesion.id), number(sessionB.id));
      assert.equal(number(stateA.esperado), 100);
      assert.equal(number(stateB.esperado), 350);
      const foreignState = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${registerB.id}`, { token: cashierA.token }
      ), 200, "estado ajeno");
      assert.equal(foreignState.puede_operar, false);
      assert.equal("esperado" in foreignState, false);
      assert.equal("movimientos" in foreignState, false);
      assert.equal("fondo_inicial" in foreignState.sesion, false);

      const boxes = expectStatus(await apiRequest(baseUrl, "/caja/cajas", {
        token: cashierA.token,
      }), 200, "lista de cajas");
      assert.ok(boxes.some((box) => number(box.id) === number(registerA.id)));
      assert.ok(boxes.some((box) => number(box.id) === number(registerB.id)));
    });

    await t.test("aplica permisos de caja y permite cortar sólo la sesión propia", async () => {
      const owner = await createCashier(pool, baseUrl);
      const otherCashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, owner, register, 100);

      for (const [path, body] of [
        ["/caja/retiro", { sesion_id: number(session.id), monto: 20, concepto: "RETIRO DE PRUEBA" }],
        ["/caja/ingreso", { sesion_id: number(session.id), monto: 5, concepto: "INGRESO DE PRUEBA" }],
      ]) {
        expectStatus(await apiRequest(baseUrl, path, {
          method: "POST", token: owner.token, body,
        }), 403, `${path} por cajero`);
      }
      expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST", token: otherCashier.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), efectivo_contado: 85 },
      }), 403, "corte ajeno");

      expectStatus(await apiRequest(baseUrl, "/caja/retiro", {
        method: "POST", token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), monto: 20, concepto: "RETIRO SUPERVISADO" },
      }), 201, "retiro supervisor");
      expectStatus(await apiRequest(baseUrl, "/caja/ingreso", {
        method: "POST", token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), monto: 5, concepto: "INGRESO SUPERVISADO" },
      }), 201, "ingreso supervisor");

      const cutBody = expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST", token: owner.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), efectivo_contado: 85 },
      }), 201, "corte propio");
      const cut = eventFrom(cutBody, "corte");
      assert.equal(number(cut.efectivo_esperado), 85);
      assert.equal(number(cut.diferencia), 0);
      const state = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: owner.token }
      ), 200, "caja cerrada");
      assert.equal(state.abierta, false);
    });

    await t.test("reproduce una venta idempotente y rechaza otro payload", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 10, price: 30 });
      const session = await openRegister(baseUrl, cashier, register, 50);
      const key = randomUUID();
      const results = await Promise.all([
        createSale(baseUrl, cashier.token, session.id, product.id, 2, { key }),
        createSale(baseUrl, cashier.token, session.id, product.id, 2, { key }),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
      assert.equal(number(saleFrom(results[0].body).id), number(saleFrom(results[1].body).id));
      expectStatus(await createSale(baseUrl, cashier.token, session.id, product.id, 3, { key }),
        409, "clave repetida con payload distinto");
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 8);
      const stored = await pool.query(
        `SELECT COUNT(DISTINCT v.id)::int AS ventas, SUM(dv.cantidad)::int AS cantidad
         FROM ventas v JOIN detalle_ventas dv ON dv.venta_id=v.id WHERE dv.producto_id=$1`,
        [product.id]
      );
      assert.deepEqual(stored.rows[0], { ventas: 1, cantidad: 2 });
    });

    await t.test("serializa dos ventas por la última unidad", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 1, price: 20 });
      const session = await openRegister(baseUrl, cashier, register, 0);
      const results = await Promise.all([
        createSale(baseUrl, cashier.token, session.id, product.id, 1),
        createSale(baseUrl, cashier.token, session.id, product.id, 1),
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 0);
      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM detalle_ventas WHERE producto_id=$1`, [product.id]
      );
      assert.equal(count.rows[0].n, 1);
    });

    await t.test("cancela una venta una sola vez y revierte inventario y efectivo", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 5, price: 50 });
      const session = await openRegister(baseUrl, cashier, register, 100);
      const sale = saleFrom(expectStatus(
        await createSale(baseUrl, cashier.token, session.id, product.id, 2, { received: 100 }),
        201, "venta a cancelar"
      ));

      expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/cancelacion`, {
        method: "POST", token: cashier.token,
        body: { sesion_id: number(session.id), motivo: "SOLICITUD DEL CLIENTE" },
        idempotencyKey: randomUUID(),
      }), 403, "cancelación por cajero");

      const key = randomUUID();
      const cancelRequest = () => apiRequest(baseUrl, `/ventas/${sale.id}/cancelacion`, {
        method: "POST", token: supervisor.token,
        body: { sesion_id: number(session.id), motivo: "SOLICITUD DEL CLIENTE" },
        idempotencyKey: key,
      });
      const cancelledBody = expectStatus(await cancelRequest(), 201, "cancelación nueva");
      assert.equal(saleFrom(cancelledBody).estado, "CANCELADA");
      const replayBody = expectStatus(await cancelRequest(), 200, "replay de cancelación");
      assert.equal(number(eventFrom(cancelledBody, "cancelacion").id),
        number(eventFrom(replayBody, "cancelacion").id));

      expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/cancelacion`, {
        method: "POST", token: supervisor.token,
        body: { sesion_id: number(session.id), motivo: "SEGUNDO INTENTO" },
        idempotencyKey: randomUUID(),
      }), 409, "segunda cancelación");

      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 5);
      const cancellation = await pool.query(`SELECT * FROM cancelaciones_venta WHERE venta_id=$1`, [sale.id]);
      assert.equal(cancellation.rowCount, 1);
      assert.equal(number(cancellation.rows[0].usuario_id), number(supervisor.id));
      assert.equal(number(cancellation.rows[0].caja_id), number(register.id));
      assert.equal(number(cancellation.rows[0].sesion_id), number(session.id));
      const reversal = await pool.query(
        `SELECT m.* FROM movimientos m
         JOIN cancelaciones_venta c ON c.id=m.cancelacion_id
         WHERE c.venta_id=$1 AND m.tipo='CANCELACION'`, [sale.id]
      );
      assert.equal(reversal.rowCount, 1);
      assert.equal(number(reversal.rows[0].usuario_id), number(supervisor.id));
      const state = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: cashier.token }
      ), 200, "caja después de cancelar");
      assert.equal(number(state.esperado), 100);
    });

    await t.test("procesa devolución parcial y completa sin reintegrar de más", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 8, price: 40 });
      const session = await openRegister(baseUrl, cashier, register, 200);
      const sale = saleFrom(expectStatus(
        await createSale(baseUrl, cashier.token, session.id, product.id, 3, { received: 120 }),
        201, "venta para devolver"
      ));
      const ticket = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}`, {
        token: cashier.token,
      }), 200, "detalle de venta");
      const detail = ticket.detalle[0];
      assert.equal(number(detail.devuelto), 0);
      assert.equal(number(detail.disponible_devolver), 3);

      expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/devoluciones`, {
        method: "POST", token: cashier.token,
        body: {
          sesion_id: number(session.id), motivo: "DEVOLUCIÓN NO AUTORIZADA",
          items: [{ detalle_venta_id: number(detail.id), cantidad: 1 }],
        },
        idempotencyKey: randomUUID(),
      }), 403, "devolución por cajero");

      const partialBody = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/devoluciones`, {
        method: "POST", token: supervisor.token,
        body: {
          sesion_id: number(session.id), motivo: "PRODUCTO CAMBIADO",
          items: [{ detalle_venta_id: number(detail.id), cantidad: 1 }],
        },
        idempotencyKey: randomUUID(),
      }), 201, "devolución parcial");
      assert.equal(saleFrom(partialBody).estado, "PARCIALMENTE_DEVUELTA");

      const afterPartial = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}`, {
        token: cashier.token,
      }), 200, "detalle parcial");
      assert.equal(number(afterPartial.detalle[0].devuelto), 1);
      assert.equal(number(afterPartial.detalle[0].disponible_devolver), 2);

      const completeBody = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/devoluciones`, {
        method: "POST", token: supervisor.token,
        body: {
          sesion_id: number(session.id), motivo: "DEVOLUCIÓN DEL RESTO",
          items: [{ detalle_venta_id: number(detail.id), cantidad: 2 }],
        },
        idempotencyKey: randomUUID(),
      }), 201, "devolución completa");
      assert.equal(saleFrom(completeBody).estado, "DEVUELTA");

      expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}/devoluciones`, {
        method: "POST", token: supervisor.token,
        body: {
          sesion_id: number(session.id), motivo: "EXCESO",
          items: [{ detalle_venta_id: number(detail.id), cantidad: 1 }],
        },
        idempotencyKey: randomUUID(),
      }), 409, "devolución excesiva");

      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 8);
      const returned = await pool.query(
        `SELECT COUNT(DISTINCT d.id)::int AS devoluciones,
                COALESCE(SUM(dd.cantidad),0)::int AS cantidad
         FROM devoluciones d JOIN detalle_devoluciones dd ON dd.devolucion_id=d.id
         WHERE d.venta_id=$1`, [sale.id]
      );
      assert.deepEqual(returned.rows[0], { devoluciones: 2, cantidad: 3 });
      const movements = await pool.query(
        `SELECT m.* FROM movimientos m JOIN devoluciones d ON d.id=m.devolucion_id
         WHERE d.venta_id=$1 AND m.tipo='DEVOLUCION'`, [sale.id]
      );
      assert.equal(movements.rowCount, 2);
      assert.ok(movements.rows.every((row) => number(row.usuario_id) === number(supervisor.id)));
      const state = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: cashier.token }
      ), 200, "caja después de devolución");
      assert.equal(number(state.devoluciones_efectivo), 120);
      assert.equal(number(state.esperado), 200);
    });

    await t.test("registra reembolsos de tarjeta y transferencia en el estado y corte", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const cardProduct = await createProduct(pool, { stock: 3, price: 30 });
      const transferProduct = await createProduct(pool, { stock: 3, price: 40 });
      const session = await openRegister(baseUrl, cashier, register, 50);

      const cardSale = saleFrom(expectStatus(await createSale(
        baseUrl, cashier.token, session.id, cardProduct.id, 2, { method: "TARJETA" }
      ), 201, "venta con tarjeta"));
      expectStatus(await apiRequest(baseUrl, `/ventas/${cardSale.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        body: { sesion_id: number(session.id), motivo: "CANCELACIÓN DE TARJETA" },
        idempotencyKey: randomUUID(),
      }), 201, "cancelación de tarjeta");

      const transferSale = saleFrom(expectStatus(await createSale(
        baseUrl, cashier.token, session.id, transferProduct.id, 2, { method: "TRANSFERENCIA" }
      ), 201, "venta con transferencia"));
      const transferTicket = expectStatus(await apiRequest(
        baseUrl, `/ventas/${transferSale.id}`, { token: supervisor.token }
      ), 200, "detalle de transferencia");
      expectStatus(await apiRequest(baseUrl, `/ventas/${transferSale.id}/devoluciones`, {
        method: "POST",
        token: supervisor.token,
        body: {
          sesion_id: number(session.id),
          motivo: "DEVOLUCIÓN DE TRANSFERENCIA",
          items: [{ detalle_venta_id: number(transferTicket.detalle[0].id), cantidad: 1 }],
        },
        idempotencyKey: randomUUID(),
      }), 201, "devolución de transferencia");

      const state = expectStatus(await apiRequest(
        baseUrl, `/caja/estado?caja_id=${register.id}`, { token: cashier.token }
      ), 200, "resumen con reembolsos no efectivos");
      assert.equal(number(state.ventas_tarjeta), 60);
      assert.equal(number(state.devoluciones_tarjeta), 60);
      assert.equal(number(state.ventas_transf), 80);
      assert.equal(number(state.devoluciones_transf), 40);
      assert.equal(number(state.esperado), 50);

      const cut = expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), efectivo_contado: 50 },
      }), 201, "corte con reembolsos no efectivos");
      assert.equal(number(cut.devoluciones_tarjeta), 60);
      assert.equal(number(cut.devoluciones_transf), 40);
      assert.equal(number(cut.efectivo_esperado), 50);
    });

    await t.test("serializa devoluciones concurrentes y no excede lo vendido", async () => {
      const cashier = await createCashier(pool, baseUrl);
      const register = await createRegister(pool);
      const product = await createProduct(pool, { stock: 2, price: 35 });
      const session = await openRegister(baseUrl, cashier, register, 100);
      const sale = saleFrom(expectStatus(
        await createSale(baseUrl, cashier.token, session.id, product.id, 2, { received: 70 }),
        201, "venta para devolución concurrente"
      ));
      const ticket = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}`, {
        token: supervisor.token,
      }), 200, "detalle concurrente");
      const detailId = number(ticket.detalle[0].id);
      const refund = (key) => apiRequest(baseUrl, `/ventas/${sale.id}/devoluciones`, {
        method: "POST", token: supervisor.token,
        body: {
          sesion_id: number(session.id), motivo: "SOLICITUD CONCURRENTE",
          items: [{ detalle_venta_id: detailId, cantidad: 2 }],
        },
        idempotencyKey: key,
      });
      const results = await Promise.all([refund(randomUUID()), refund(randomUUID())]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 2);
      const returned = await pool.query(
        `SELECT COALESCE(SUM(dd.cantidad),0)::int AS cantidad
         FROM devoluciones d JOIN detalle_devoluciones dd ON dd.devolucion_id=d.id
         WHERE d.venta_id=$1`, [sale.id]
      );
      assert.equal(returned.rows[0].cantidad, 2);
      assert.equal((await pool.query(`SELECT estado FROM ventas WHERE id=$1`, [sale.id])).rows[0].estado,
        "DEVUELTA");
    });
  } finally {
    await environment.cleanup();
  }
});
