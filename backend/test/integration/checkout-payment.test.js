const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "PruebasSeguras!2026";
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

async function createCashier(pool, baseUrl) {
  const label = nextLabel("cajero-cobro");
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1, $2, $3, id FROM roles WHERE nombre='CAJERO'
     RETURNING id, nombre, email`,
    [label, `${label}@tests.local`, passwordHash]
  );
  const cashier = result.rows[0];
  const login = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: cashier.email, password: TEST_PASSWORD },
  }), 200, "login del cajero");
  return { ...cashier, token: login.token };
}

async function createRegister(pool) {
  const result = await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1, TRUE) RETURNING id, nombre`,
    [nextLabel("Caja cobro")]
  );
  return result.rows[0];
}

async function createProduct(pool, { stock = 10, price = 100 } = {}) {
  const label = nextLabel("libro-cobro");
  const result = await pool.query(
    `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
     VALUES ($1, $2, $3, 0, $4, 16, TRUE)
     RETURNING id, titulo, precio, stock`,
    [`COB-${sequence}`, label, price, stock]
  );
  return result.rows[0];
}

async function openRegister(baseUrl, cashier, register, initial = 0) {
  const body = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token: cashier.token,
    body: { caja_id: number(register.id), fondo_inicial: initial },
  }), 201, "apertura de caja");
  return body.sesion || body;
}

function saleRequest(baseUrl, cashier, session, product, {
  method = "EFECTIVO",
  received,
  key = randomUUID(),
  items,
} = {}) {
  const body = {
    sesion_id: number(session.id),
    metodo_pago: method,
    cliente: "CLIENTE DE PRUEBA",
    items: items || [{ producto_id: number(product.id), cantidad: 1 }],
  };
  if (received !== undefined) body.recibido = received;
  return apiRequest(baseUrl, "/ventas", {
    method: "POST",
    token: cashier.token,
    body,
    idempotencyKey: key,
  });
}

async function mutationSnapshot(pool, { cashierId, sessionId, productId }) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM ventas WHERE sesion_id=$1) AS ventas,
       (SELECT COUNT(*)::int
          FROM detalle_ventas dv
          JOIN ventas v ON v.id=dv.venta_id
         WHERE v.sesion_id=$1) AS detalles,
       (SELECT COUNT(*)::int
          FROM movimientos
         WHERE sesion_id=$1 AND tipo='VENTA') AS movimientos,
       (SELECT COUNT(*)::int
          FROM inventario_movimientos
         WHERE producto_id=$2 AND tipo='VENTA') AS kardex,
       (SELECT COUNT(*)::int
          FROM operaciones_idempotentes
         WHERE usuario_id=$3 AND operacion='VENTA_POS') AS idempotencias,
       (SELECT stock::int FROM productos WHERE id=$2) AS stock`,
    [sessionId, productId, cashierId]
  );
  return result.rows[0];
}

test("cobro POS: importes, métodos, validaciones y atomicidad", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;

  try {
    await seedRoles(pool);
    const cashier = await createCashier(pool, baseUrl);

    await t.test("cobra efectivo exacto y sobrepago, guarda cambio y suma sólo el total a caja", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 50);
      const exactProduct = await createProduct(pool, { stock: 2, price: 116 });
      const overpaymentProduct = await createProduct(pool, { stock: 2, price: 58 });

      const exact = expectStatus(await saleRequest(baseUrl, cashier, session, exactProduct, {
        received: 116,
      }), 201, "pago exacto");
      assert.equal(number(exact.total), 116);
      assert.equal(number(exact.recibido), 116);
      assert.equal(number(exact.cambio), 0);

      const overpayment = expectStatus(await saleRequest(
        baseUrl,
        cashier,
        session,
        overpaymentProduct,
        { received: 100 }
      ), 201, "sobrepago en efectivo");
      assert.equal(number(overpayment.total), 58);
      assert.equal(number(overpayment.recibido), 100);
      assert.equal(number(overpayment.cambio), 42);

      const movements = await pool.query(
        `SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(monto),0) AS monto
         FROM movimientos
         WHERE sesion_id=$1 AND tipo='VENTA' AND metodo_pago='EFECTIVO'`,
        [session.id]
      );
      assert.equal(movements.rows[0].cantidad, 2);
      assert.equal(number(movements.rows[0].monto), 174);

      const state = expectStatus(await apiRequest(
        baseUrl,
        `/caja/estado?caja_id=${register.id}`,
        { token: cashier.token }
      ), 200, "estado de caja tras pagos en efectivo");
      assert.equal(number(state.ventas_efectivo), 174);
      assert.equal(number(state.esperado), 224);
    });

    await t.test("cobra tarjeta y transferencia sin recibido ni cambio y registra sus movimientos", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 25);
      const cardProduct = await createProduct(pool, { stock: 2, price: 80 });
      const transferProduct = await createProduct(pool, { stock: 2, price: 40 });

      const card = expectStatus(await saleRequest(baseUrl, cashier, session, cardProduct, {
        method: "TARJETA",
      }), 201, "pago con tarjeta");
      const transfer = expectStatus(await saleRequest(baseUrl, cashier, session, transferProduct, {
        method: "TRANSFERENCIA",
      }), 201, "pago con transferencia");

      for (const sale of [card, transfer]) {
        assert.equal(sale.recibido, null);
        assert.equal(sale.cambio, null);
      }

      const stored = await pool.query(
        `SELECT v.metodo_pago, v.recibido, v.cambio, m.monto, m.metodo_pago AS movimiento_metodo
         FROM ventas v
         JOIN movimientos m ON m.venta_id=v.id AND m.tipo='VENTA'
         WHERE v.id = ANY($1::int[])
         ORDER BY v.id`,
        [[number(card.id), number(transfer.id)]]
      );
      assert.deepEqual(stored.rows.map((row) => ({
        metodo: row.metodo_pago,
        recibido: row.recibido,
        cambio: row.cambio,
        monto: number(row.monto),
        movimientoMetodo: row.movimiento_metodo,
      })), [
        {
          metodo: "TARJETA", recibido: null, cambio: null,
          monto: 80, movimientoMetodo: "TARJETA",
        },
        {
          metodo: "TRANSFERENCIA", recibido: null, cambio: null,
          monto: 40, movimientoMetodo: "TRANSFERENCIA",
        },
      ]);

      const state = expectStatus(await apiRequest(
        baseUrl,
        `/caja/estado?caja_id=${register.id}`,
        { token: cashier.token }
      ), 200, "estado de caja tras pagos no efectivos");
      assert.equal(number(state.ventas_tarjeta), 80);
      assert.equal(number(state.ventas_transf), 40);
      assert.equal(number(state.esperado), 25);
    });

    await t.test("rechaza cobros inválidos sin mutar venta, caja, inventario ni idempotencia", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 10);
      const product = await createProduct(pool, { stock: 5, price: 100 });
      const baseline = await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      });

      const invalidCases = [
        ["efectivo sin recibido", { received: undefined }],
        ["efectivo insuficiente", { received: 99.99 }],
        ["efectivo negativo", { received: -1 }],
        ["efectivo con tres decimales", { received: 100.001 }],
        ["efectivo fuera de NUMERIC(12,2)", { received: 10_000_000_000 }],
        ["método inválido", { method: "CHEQUE", received: 100 }],
        ["clave idempotente ausente", { received: 100, key: null }],
        ["clave idempotente corta", { received: 100, key: "corta" }],
        ["más de cien líneas", {
          received: 100,
          items: Array.from(
            { length: 101 },
            () => ({ producto_id: number(product.id), cantidad: 1 })
          ),
        }],
      ];

      for (const [label, options] of invalidCases) {
        expectStatus(
          await saleRequest(baseUrl, cashier, session, product, options),
          400,
          label
        );
      }

      assert.deepEqual(await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      }), baseline);

      const state = expectStatus(await apiRequest(
        baseUrl,
        `/caja/estado?caja_id=${register.id}`,
        { token: cashier.token }
      ), 200, "caja después de cobros inválidos");
      assert.equal(number(state.esperado), 10);
    });

    await t.test("rechaza un total calculado fuera del rango monetario antes de escribir", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 0);
      const products = [];
      for (let index = 0; index < 11; index++) {
        products.push(await createProduct(pool, { stock: 999, price: 999_999 }));
      }
      const key = randomUUID();
      expectStatus(await saleRequest(baseUrl, cashier, session, products[0], {
        received: 9_999_999_999.99,
        key,
        items: products.map((product) => ({
          producto_id: number(product.id),
          cantidad: 999,
        })),
      }), 400, "total superior a NUMERIC(12,2)");

      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM ventas WHERE sesion_id=$1`,
        [session.id]
      )).rows[0].n), 0);
      const stocks = await pool.query(
        `SELECT stock FROM productos WHERE id=ANY($1::int[]) ORDER BY id`,
        [products.map((product) => number(product.id))]
      );
      assert.ok(stocks.rows.every((row) => number(row.stock) === 999));
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='VENTA_POS' AND clave=$2`,
        [cashier.id, key]
      )).rows[0].n), 0);
    });

    await t.test("impide cobrar después de cerrar la caja sin dejar mutaciones", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 30);
      const product = await createProduct(pool, { stock: 2, price: 75 });

      expectStatus(await apiRequest(baseUrl, "/caja/corte", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { sesion_id: number(session.id), efectivo_contado: 30 },
      }), 201, "cierre de caja");

      const baseline = await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      });
      expectStatus(await saleRequest(baseUrl, cashier, session, product, {
        received: 75,
      }), 409, "venta con caja cerrada");
      assert.deepEqual(await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      }), baseline);
    });

    await t.test("revierte por completo un fallo al insertar el movimiento y permite reintentar la clave", async () => {
      const register = await createRegister(pool);
      const session = await openRegister(baseUrl, cashier, register, 20);
      const product = await createProduct(pool, { stock: 3, price: 75 });
      const key = randomUUID();
      const baseline = await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      });

      await pool.query(`
        ALTER TABLE movimientos
        ADD CONSTRAINT checkout_payment_block_sale_movement_check
        CHECK (tipo <> 'VENTA') NOT VALID
      `);
      try {
        expectStatus(await saleRequest(baseUrl, cashier, session, product, {
          received: 75,
          key,
        }), 400, "fallo inducido al registrar el movimiento de venta");
      } finally {
        await pool.query(`
          ALTER TABLE movimientos
          DROP CONSTRAINT checkout_payment_block_sale_movement_check
        `);
      }

      assert.deepEqual(await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      }), baseline);

      const retried = expectStatus(await saleRequest(baseUrl, cashier, session, product, {
        received: 75,
        key,
      }), 201, "reintento con la misma clave después del rollback");
      assert.equal(number(retried.total), 75);

      const finalState = await mutationSnapshot(pool, {
        cashierId: cashier.id,
        sessionId: session.id,
        productId: product.id,
      });
      assert.deepEqual(finalState, {
        ventas: 1,
        detalles: 1,
        movimientos: 1,
        kardex: 1,
        idempotencias: baseline.idempotencias + 1,
        stock: 2,
      });

      const operation = await pool.query(
        `SELECT recurso_tipo, recurso_id, completado_en
         FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='VENTA_POS' AND clave=$2`,
        [cashier.id, key]
      );
      assert.equal(operation.rowCount, 1);
      assert.equal(operation.rows[0].recurso_tipo, "venta");
      assert.equal(number(operation.rows[0].recurso_id), number(retried.id));
      assert.ok(operation.rows[0].completado_en);
    });
  } finally {
    await environment.cleanup();
  }
});
