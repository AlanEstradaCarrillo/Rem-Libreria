const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");
const { expirarPedidosVencidos } = require("../../src/services/pedidos.service");

const TEST_PASSWORD = "PedidoCajaSeguro!2026";
let sequence = 0;

const number = (value) => Number(value);
const nextLabel = (prefix) => `${prefix}-${++sequence}`;

function expectStatus(response, expected, context) {
  assert.equal(
    response.status,
    expected,
    `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`
  );
  return response.body;
}

async function seedRoles(pool) {
  for (const role of ["ADMIN", "SUPERVISOR", "CAJERO"]) {
    await pool.query(
      `INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`,
      [role]
    );
  }
}

async function createUser(pool, role) {
  const label = nextLabel(role.toLowerCase());
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@order-pos.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  return expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`).token;
}

async function createProduct(baseUrl, token, { stock = 6, price = 116 } = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `OP-${suffix}`,
      titulo: `Libro cobro pedido ${suffix}`,
      precio: price,
      costo: 20,
      stock,
      iva: 16,
    },
  }), 201, "crear producto");
}

function contact(label) {
  const suffix = ++sequence;
  return {
    nombre: `${label} ${suffix}`,
    telefono: `555200${String(suffix).padStart(4, "0")}`,
    email: `pedido-caja-${suffix}@tests.local`,
    direccion: `Dirección de prueba ${suffix}`,
  };
}

async function createOrder(baseUrl, token, productId, quantity = 1) {
  return expectStatus(await apiRequest(baseUrl, "/pedidos", {
    method: "POST",
    token,
    idempotencyKey: randomUUID(),
    body: {
      cliente: contact("Cliente caja"),
      tipo_entrega: "RECOLECCION",
      items: [{ producto_id: number(productId), cantidad: quantity }],
    },
  }), 201, "crear pedido reservado");
}

async function createRegister(pool) {
  return (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1,TRUE) RETURNING *`,
    [nextLabel("Caja pedido")]
  )).rows[0];
}

async function openRegister(baseUrl, user, register) {
  const body = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token: user.token,
    body: { caja_id: number(register.id), fondo_inicial: 100 },
  }), 201, "abrir caja");
  return body.sesion || body;
}

function chargeOrder(baseUrl, token, orderId, sessionId, {
  key = randomUUID(),
  method = "EFECTIVO",
  received = 10000,
} = {}) {
  const body = {
    sesion_id: number(sessionId),
    metodo_pago: method,
  };
  if (method === "EFECTIVO") body.recibido = received;
  return apiRequest(baseUrl, `/ventas/desde-pedido/${orderId}`, {
    method: "POST",
    token,
    idempotencyKey: key,
    body,
  });
}

async function runTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("cobro de pedidos reservados en POS", { timeout: 180000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await seedRoles(pool);
    const supervisor = await createUser(pool, "SUPERVISOR");
    supervisor.token = await login(baseUrl, supervisor);
    const cashier = await createUser(pool, "CAJERO");
    cashier.token = await login(baseUrl, cashier);
    const register = await createRegister(pool);
    const session = await openRegister(baseUrl, cashier, register);

    await t.test("cobra snapshots exactos y consume la reserva una sola vez", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 6, price: 116 });
      const order = await createOrder(baseUrl, cashier.token, product.id, 2);
      assert.deepEqual(
        (await pool.query(
          `SELECT stock, stock_reservado, stock_disponible FROM productos WHERE id=$1`,
          [product.id]
        )).rows[0],
        { stock: 6, stock_reservado: 2, stock_disponible: 4 }
      );

      const sale = expectStatus(await chargeOrder(
        baseUrl,
        cashier.token,
        order.id,
        session.id
      ), 201, "cobrar pedido");
      assert.equal(number(sale.pedido_id), number(order.id));
      assert.equal(number(sale.usuario_id), number(cashier.id));
      assert.equal(number(sale.sesion_id), number(session.id));
      assert.equal(number(sale.caja_id), number(register.id));
      assert.equal(number(sale.total), number(order.total));
      assert.equal(number(sale.subtotal), number(order.subtotal));
      assert.equal(number(sale.iva), number(order.iva));

      const stored = await pool.query(
        `SELECT v.*, p.estado AS pedido_estado
         FROM ventas v JOIN pedidos p ON p.id=v.pedido_id
         WHERE v.id=$1`,
        [sale.id]
      );
      assert.equal(stored.rows[0].pedido_estado, "COMPLETADO");
      assert.equal(number(stored.rows[0].pedido_id), number(order.id));
      const detail = await pool.query(
        `SELECT dv.*, dp.precio_lista AS pedido_precio_lista,
                dp.descuento_unitario AS pedido_descuento,
                dp.precio_unitario AS pedido_precio, dp.importe AS pedido_importe
         FROM detalle_ventas dv
         JOIN detalle_pedidos dp
           ON dp.pedido_id=$2 AND dp.producto_id=dv.producto_id
         WHERE dv.venta_id=$1`,
        [sale.id, order.id]
      );
      assert.equal(detail.rowCount, 1);
      assert.equal(detail.rows[0].precio_lista, detail.rows[0].pedido_precio_lista);
      assert.equal(detail.rows[0].descuento_unitario, detail.rows[0].pedido_descuento);
      assert.equal(detail.rows[0].precio_unitario, detail.rows[0].pedido_precio);
      assert.equal(detail.rows[0].importe, detail.rows[0].pedido_importe);

      assert.deepEqual(
        (await pool.query(
          `SELECT stock, stock_reservado, stock_disponible FROM productos WHERE id=$1`,
          [product.id]
        )).rows[0],
        { stock: 4, stock_reservado: 0, stock_disponible: 4 }
      );
      const consumption = await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE venta_id=$1 AND producto_id=$2`,
        [sale.id, product.id]
      );
      assert.equal(consumption.rowCount, 1);
      assert.equal(consumption.rows[0].tipo, "CONSUMO_RESERVA");
      assert.equal(number(consumption.rows[0].delta_fisico), -2);
      assert.equal(number(consumption.rows[0].delta_reservado), -2);
      assert.equal(number(consumption.rows[0].pedido_id), number(order.id));
      assert.ok(consumption.rows[0].reserva_id);
      assert.equal(
        number((await pool.query(
          `SELECT COUNT(*) AS n FROM inventario_movimientos
           WHERE venta_id=$1 AND tipo='VENTA'`,
          [sale.id]
        )).rows[0].n),
        0
      );
      assert.equal(
        (await pool.query(
          `SELECT estado FROM reservas_stock WHERE pedido_id=$1`,
          [order.id]
        )).rows[0].estado,
        "CONSUMIDA"
      );
      assert.equal(
        number((await pool.query(
          `SELECT COUNT(*) AS n FROM movimientos WHERE venta_id=$1 AND tipo='VENTA'`,
          [sale.id]
        )).rows[0].n),
        1
      );
      const transitions = await pool.query(
        `SELECT estado_nuevo FROM pedido_transiciones WHERE pedido_id=$1 ORDER BY id`,
        [order.id]
      );
      assert.deepEqual(transitions.rows.map((row) => row.estado_nuevo), [
        "RESERVADO",
        "COMPLETADO",
      ]);
      assert.equal(
        (await pool.query(
          `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
          [product.id]
        )).rows[0].conciliado,
        true
      );
    });

    await t.test("reproduce la misma clave y serializa claves distintas", async () => {
      const replayProduct = await createProduct(baseUrl, supervisor.token, { stock: 3, price: 50 });
      const replayOrder = await createOrder(baseUrl, cashier.token, replayProduct.id, 1);
      const replayKey = randomUUID();
      const replayResults = await Promise.all([
        chargeOrder(baseUrl, cashier.token, replayOrder.id, session.id, { key: replayKey }),
        chargeOrder(baseUrl, cashier.token, replayOrder.id, session.id, { key: replayKey }),
      ]);
      assert.deepEqual(replayResults.map((response) => response.status).sort(), [200, 201]);
      assert.equal(number(replayResults[0].body.id), number(replayResults[1].body.id));
      expectStatus(await chargeOrder(
        baseUrl,
        cashier.token,
        replayOrder.id,
        session.id,
        { key: randomUUID() }
      ), 409, "otra clave después del cobro");

      const raceProduct = await createProduct(baseUrl, supervisor.token, { stock: 3, price: 60 });
      const raceOrder = await createOrder(baseUrl, cashier.token, raceProduct.id, 1);
      const raceResults = await Promise.all([
        chargeOrder(baseUrl, cashier.token, raceOrder.id, session.id, { key: randomUUID() }),
        chargeOrder(baseUrl, cashier.token, raceOrder.id, session.id, { key: randomUUID() }),
      ]);
      assert.deepEqual(raceResults.map((response) => response.status).sort(), [201, 409]);
      const stored = await pool.query(
        `SELECT COUNT(*)::int AS ventas FROM ventas WHERE pedido_id=$1`,
        [raceOrder.id]
      );
      assert.equal(stored.rows[0].ventas, 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='CONSUMO_RESERVA'`,
        [raceOrder.id]
      )).rows[0].n), 1);
    });

    await t.test("revierte íntegramente un efectivo insuficiente", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 2, price: 100 });
      const order = await createOrder(baseUrl, cashier.token, product.id, 1);
      const key = randomUUID();
      expectStatus(await chargeOrder(baseUrl, cashier.token, order.id, session.id, {
        key,
        received: 99,
      }), 400, "efectivo insuficiente");

      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM ventas WHERE pedido_id=$1`,
        [order.id]
      )).rows[0].n), 0);
      assert.equal((await pool.query(
        `SELECT estado FROM pedidos WHERE id=$1`,
        [order.id]
      )).rows[0].estado, "RESERVADO");
      assert.equal((await pool.query(
        `SELECT estado FROM reservas_stock WHERE pedido_id=$1`,
        [order.id]
      )).rows[0].estado, "ACTIVA");
      assert.deepEqual((await pool.query(
        `SELECT stock, stock_reservado FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0], { stock: 2, stock_reservado: 1 });
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='CONSUMO_RESERVA'`,
        [order.id]
      )).rows[0].n), 0);

      expectStatus(await chargeOrder(baseUrl, cashier.token, order.id, session.id, {
        key,
        received: 100,
      }), 201, "reintento después del rollback");
    });

    await t.test("rechaza pedidos cancelados y expirados", async () => {
      const cancelledProduct = await createProduct(baseUrl, supervisor.token, {
        stock: 2,
        price: 80,
      });
      const cancelledOrder = await createOrder(
        baseUrl,
        cashier.token,
        cancelledProduct.id,
        1
      );
      expectStatus(await apiRequest(baseUrl, `/pedidos/${cancelledOrder.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: { motivo: "Cliente canceló antes de pagar" },
      }), 201, "cancelar pedido");
      expectStatus(await chargeOrder(
        baseUrl,
        cashier.token,
        cancelledOrder.id,
        session.id
      ), 409, "cobro de pedido cancelado");

      const expiredProduct = await createProduct(baseUrl, supervisor.token, {
        stock: 2,
        price: 90,
      });
      const expiredOrder = await createOrder(baseUrl, cashier.token, expiredProduct.id, 1);
      const cutoff = new Date(new Date(expiredOrder.expira_en).getTime() + 1000);
      const expiredIds = await runTransaction(pool, (client) =>
        expirarPedidosVencidos(client, { limit: 100, hasta: cutoff })
      );
      assert.ok(expiredIds.includes(number(expiredOrder.id)));
      expectStatus(await chargeOrder(
        baseUrl,
        cashier.token,
        expiredOrder.id,
        session.id
      ), 409, "cobro de pedido expirado");

      const terminalSales = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ventas WHERE pedido_id=ANY($1::bigint[])`,
        [[cancelledOrder.id, expiredOrder.id]]
      );
      assert.equal(terminalSales.rows[0].n, 0);
    });

    await t.test("serializa cobro contra cancelación sin consumir y liberar a la vez", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 2, price: 75 });
      const order = await createOrder(baseUrl, cashier.token, product.id, 1);
      const [charge, cancellation] = await Promise.all([
        chargeOrder(baseUrl, cashier.token, order.id, session.id, { key: randomUUID() }),
        apiRequest(baseUrl, `/pedidos/${order.id}/cancelacion`, {
          method: "POST",
          token: supervisor.token,
          idempotencyKey: randomUUID(),
          body: { motivo: "Carrera entre cancelación y cobro" },
        }),
      ]);
      assert.deepEqual([charge.status, cancellation.status].sort(), [201, 409]);

      const storedOrder = (await pool.query(
        `SELECT estado FROM pedidos WHERE id=$1`, [order.id]
      )).rows[0];
      const reservation = (await pool.query(
        `SELECT estado FROM reservas_stock WHERE pedido_id=$1`, [order.id]
      )).rows[0];
      const finals = await pool.query(
        `SELECT tipo FROM inventario_movimientos
         WHERE pedido_id=$1
           AND tipo IN ('CONSUMO_RESERVA','LIBERACION_RESERVA')`,
        [order.id]
      );
      assert.equal(finals.rowCount, 1);
      if (storedOrder.estado === "COMPLETADO") {
        assert.equal(reservation.estado, "CONSUMIDA");
        assert.equal(finals.rows[0].tipo, "CONSUMO_RESERVA");
      } else {
        assert.equal(storedOrder.estado, "CANCELADO");
        assert.equal(reservation.estado, "LIBERADA");
        assert.equal(finals.rows[0].tipo, "LIBERACION_RESERVA");
      }
      assert.equal((await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`, [product.id]
      )).rows[0].conciliado, true);
    });

    await t.test("serializa cobro contra expiración sin doble salida", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 2, price: 85 });
      const order = await createOrder(baseUrl, cashier.token, product.id, 1);
      const cutoff = new Date(new Date(order.expira_en).getTime() + 1000);
      const [charge, expiredIds] = await Promise.all([
        chargeOrder(baseUrl, cashier.token, order.id, session.id, { key: randomUUID() }),
        runTransaction(pool, (client) => expirarPedidosVencidos(client, {
          limit: 100,
          hasta: cutoff,
        })),
      ]);
      const expirationWon = expiredIds.includes(number(order.id));
      assert.equal((charge.status === 201) !== expirationWon, true);
      if (charge.status !== 201) assert.equal(charge.status, 409);

      const storedOrder = (await pool.query(
        `SELECT estado FROM pedidos WHERE id=$1`, [order.id]
      )).rows[0];
      const reservation = (await pool.query(
        `SELECT estado FROM reservas_stock WHERE pedido_id=$1`, [order.id]
      )).rows[0];
      const finals = await pool.query(
        `SELECT tipo FROM inventario_movimientos
         WHERE pedido_id=$1
           AND tipo IN ('CONSUMO_RESERVA','EXPIRACION_RESERVA')`,
        [order.id]
      );
      assert.equal(finals.rowCount, 1);
      if (storedOrder.estado === "COMPLETADO") {
        assert.equal(reservation.estado, "CONSUMIDA");
        assert.equal(finals.rows[0].tipo, "CONSUMO_RESERVA");
      } else {
        assert.equal(storedOrder.estado, "EXPIRADO");
        assert.equal(reservation.estado, "EXPIRADA");
        assert.equal(finals.rows[0].tipo, "EXPIRACION_RESERVA");
      }
      assert.equal((await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`, [product.id]
      )).rows[0].conciliado, true);
    });
  } finally {
    await environment.cleanup();
  }
});
