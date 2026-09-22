const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "InventarioSeguro!2026";
let sequence = 0;

const number = (value) => Number(value);
const saleFrom = (body) => (body && body.venta ? body.venta : body);
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
     SELECT $1, $2, $3, id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@inventory.tests`, passwordHash, role]
  );
  return result.rows[0];
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`);
  assert.ok(body.token);
  return body.token;
}

async function createProduct(baseUrl, token, { stock, price = 50 } = {}) {
  const label = nextLabel("producto");
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `INV-${sequence}`,
      titulo: label,
      precio: price,
      costo: 0,
      stock,
      iva: 16,
    },
  }), 201, `alta de ${label}`);
}

async function openRegister(pool, baseUrl, cashier, initial = 100) {
  const register = (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1, TRUE) RETURNING *`,
    [nextLabel("Caja")]
  )).rows[0];
  const session = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token: cashier.token,
    body: { caja_id: number(register.id), fondo_inicial: initial },
  }), 201, "apertura de caja");
  return { register, session: session.sesion || session };
}

async function createSale(baseUrl, token, sessionId, productId, quantity, key) {
  return apiRequest(baseUrl, "/ventas", {
    method: "POST",
    token,
    idempotencyKey: key,
    body: {
      sesion_id: number(sessionId),
      metodo_pago: "EFECTIVO",
      recibido: 10000,
      cliente: "CLIENTE INVENTARIO",
      items: [{ producto_id: number(productId), cantidad: quantity }],
    },
  });
}

async function inventoryRows(pool, where, params) {
  return (await pool.query(
    `SELECT * FROM inventario_movimientos WHERE ${where} ORDER BY id`,
    params
  )).rows;
}

test("núcleo de inventario y kardex", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { runMigrations } = require("../../src/scripts/migrate-db");
  const { baseUrl, pool } = environment;
  try {
    await seedRoles(pool);
    const supervisor = await createUser(pool, "SUPERVISOR");
    supervisor.token = await login(baseUrl, supervisor);
    const cashier = await createUser(pool, "CAJERO");
    cashier.token = await login(baseUrl, cashier);

    await t.test("backfill crea saldo inicial y el kardex rechaza UPDATE y DELETE", async () => {
      const label = nextLabel("legacy");
      const legacy = (await pool.query(
        `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
         VALUES ($1,$2,25,0,6,16,TRUE)
         RETURNING id`,
        [`LEG-${sequence}`, label]
      )).rows[0];
      assert.equal((await inventoryRows(pool, "producto_id=$1", [legacy.id])).length, 0);

      const removed = await pool.query(
        `DELETE FROM schema_migrations WHERE version='003_inventario_kardex' RETURNING version`
      );
      assert.equal(removed.rowCount, 1);
      await runMigrations(pool, { logger: { log() {} } });

      const rows = await inventoryRows(pool, "producto_id=$1", [legacy.id]);
      assert.equal(rows.length, 1);
      const initial = rows[0];
      assert.equal(initial.tipo, "INICIAL");
      assert.equal(number(initial.delta_fisico), 6);
      assert.equal(number(initial.delta_reservado), 0);
      assert.equal(number(initial.stock_fisico_resultante), 6);
      assert.equal(number(initial.stock_reservado_resultante), 0);
      assert.equal(initial.actor, "MIGRACION");
      assert.equal(initial.usuario_id, null);
      assert.equal(initial.origen_clave, `MIGRACION:003:PRODUCTO:${legacy.id}`);
      assert.ok(initial.creado_en);

      await assert.rejects(
        pool.query(`UPDATE inventario_movimientos SET motivo='alterado' WHERE id=$1`, [initial.id]),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(`DELETE FROM inventario_movimientos WHERE id=$1`, [initial.id]),
        (error) => error.code === "55000"
      );
      const preserved = await inventoryRows(pool, "id=$1", [initial.id]);
      assert.equal(preserved.length, 1);

      const kardex = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/kardex?producto_id=${legacy.id}`,
        { token: supervisor.token }
      ), 200, "consulta del kardex");
      assert.ok(Array.isArray(kardex));
      assert.equal(number(kardex[0].id), number(initial.id));
    });

    await t.test("ajustes positivos y negativos conservan actor, motivo e idempotencia", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 10 });
      const positiveKey = randomUUID();
      const positiveRequest = () => apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: positiveKey,
        body: { producto_id: number(product.id), delta: 5, motivo: "CONTEO FÍSICO POSITIVO" },
      });

      const positive = expectStatus(await positiveRequest(), 201, "ajuste positivo");
      assert.equal(positive.tipo, "AJUSTE");
      assert.equal(number(positive.delta_fisico), 5);
      assert.equal(number(positive.delta_reservado), 0);
      assert.equal(positive.actor, "USUARIO");
      assert.equal(number(positive.usuario_id), number(supervisor.id));
      assert.equal(positive.motivo, "CONTEO FÍSICO POSITIVO");
      assert.equal(number(positive.stock_fisico_resultante), 15);
      assert.equal(number(positive.stock), 15);
      assert.equal(number(positive.stock_disponible), 15);
      assert.ok(positive.creado_en);

      const replay = expectStatus(await positiveRequest(), 200, "replay de ajuste");
      assert.equal(number(replay.id), number(positive.id));
      expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: positiveKey,
        body: { producto_id: number(product.id), delta: 6, motivo: "CONTEO FÍSICO POSITIVO" },
      }), 409, "clave de ajuste con payload distinto");

      const negativeKey = randomUUID();
      const negative = expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: negativeKey,
        body: { producto_id: number(product.id), delta: -3, motivo: "MERMA CONFIRMADA" },
      }), 201, "ajuste negativo");
      assert.equal(number(negative.delta_fisico), -3);
      assert.equal(number(negative.stock_fisico_resultante), 12);
      assert.equal(number(negative.stock), 12);

      const adjusted = await inventoryRows(
        pool,
        "origen_clave=ANY($1::text[])",
        [[`AJUSTE:${supervisor.id}:${positiveKey}`, `AJUSTE:${supervisor.id}:${negativeKey}`]]
      );
      assert.equal(adjusted.length, 2);
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0].stock, 12);
    });

    await t.test("rechaza saldo físico negativo o inferior a lo reservado", async () => {
      const low = await createProduct(baseUrl, supervisor.token, { stock: 2 });
      const before = (await inventoryRows(pool, "producto_id=$1", [low.id])).length;
      expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: { producto_id: number(low.id), delta: -3, motivo: "AJUSTE INVÁLIDO" },
      }), 409, "ajuste bajo cero");
      assert.equal((await pool.query(`SELECT stock FROM productos WHERE id=$1`, [low.id])).rows[0].stock, 2);
      assert.equal((await inventoryRows(pool, "producto_id=$1", [low.id])).length, before);

      const reserved = await createProduct(baseUrl, supervisor.token, { stock: 5 });
      await pool.query(`UPDATE productos SET stock_reservado=2 WHERE id=$1`, [reserved.id]);
      const availability = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/existencias?producto_id=${reserved.id}`,
        { token: cashier.token }
      ), 200, "existencia con reserva");
      assert.ok(Array.isArray(availability));
      assert.equal(availability.length, 1);
      assert.equal(number(availability[0].fisico), 5);
      assert.equal(number(availability[0].reservado), 2);
      assert.equal(number(availability[0].disponible), 3);

      const reservedBefore = (await inventoryRows(pool, "producto_id=$1", [reserved.id])).length;
      expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: { producto_id: number(reserved.id), delta: -4, motivo: "AFECTARÍA RESERVA" },
      }), 409, "ajuste por debajo de reserva");
      const unchanged = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible FROM productos WHERE id=$1`,
        [reserved.id]
      )).rows[0];
      assert.deepEqual(unchanged, { stock: 5, stock_reservado: 2, stock_disponible: 3 });
      assert.equal((await inventoryRows(pool, "producto_id=$1", [reserved.id])).length, reservedBefore);
    });

    await t.test("venta, cancelación y devolución crean kardex una vez incluso con replay", async () => {
      const { session } = await openRegister(pool, baseUrl, cashier, 100);

      const cancelProduct = await createProduct(baseUrl, supervisor.token, { stock: 10, price: 30 });
      const saleKey = randomUUID();
      const saleRequest = () => createSale(
        baseUrl, cashier.token, session.id, cancelProduct.id, 3, saleKey
      );
      const cancellableSale = saleFrom(expectStatus(await saleRequest(), 201, "venta para cancelar"));
      assert.equal(number(saleFrom(expectStatus(await saleRequest(), 200, "replay de venta")).id),
        number(cancellableSale.id));
      let saleInventory = await inventoryRows(
        pool, "tipo='VENTA' AND venta_id=$1 AND producto_id=$2", [cancellableSale.id, cancelProduct.id]
      );
      assert.equal(saleInventory.length, 1);
      assert.equal(number(saleInventory[0].delta_fisico), -3);
      assert.equal(number(saleInventory[0].usuario_id), number(cashier.id));
      assert.equal(number(saleInventory[0].stock_fisico_resultante), 7);

      const cancelKey = randomUUID();
      const cancelRequest = () => apiRequest(baseUrl, `/ventas/${cancellableSale.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: cancelKey,
        body: { sesion_id: number(session.id), motivo: "CANCELACIÓN DE PRUEBA" },
      });
      const cancelled = expectStatus(await cancelRequest(), 201, "cancelación");
      const cancellationId = number(cancelled.cancelacion.id);
      assert.equal(number(expectStatus(await cancelRequest(), 200, "replay de cancelación").cancelacion.id),
        cancellationId);
      const cancelInventory = await inventoryRows(
        pool,
        "tipo='CANCELACION' AND cancelacion_id=$1 AND producto_id=$2",
        [cancellationId, cancelProduct.id]
      );
      assert.equal(cancelInventory.length, 1);
      assert.equal(number(cancelInventory[0].delta_fisico), 3);
      assert.equal(number(cancelInventory[0].usuario_id), number(supervisor.id));
      assert.equal(number(cancelInventory[0].stock_fisico_resultante), 10);
      saleInventory = await inventoryRows(
        pool, "tipo='VENTA' AND venta_id=$1 AND producto_id=$2", [cancellableSale.id, cancelProduct.id]
      );
      assert.equal(saleInventory.length, 1);

      const returnProduct = await createProduct(baseUrl, supervisor.token, { stock: 8, price: 40 });
      const returnSaleKey = randomUUID();
      const returnSaleRequest = () => createSale(
        baseUrl, cashier.token, session.id, returnProduct.id, 3, returnSaleKey
      );
      const returnableSale = saleFrom(expectStatus(await returnSaleRequest(), 201, "venta para devolver"));
      expectStatus(await returnSaleRequest(), 200, "replay de venta a devolver");
      const ticket = expectStatus(await apiRequest(baseUrl, `/ventas/${returnableSale.id}`, {
        token: supervisor.token,
      }), 200, "detalle de venta a devolver");
      const detailId = number(ticket.detalle[0].id);

      const refundKey = randomUUID();
      const refundRequest = () => apiRequest(baseUrl, `/ventas/${returnableSale.id}/devoluciones`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: refundKey,
        body: {
          sesion_id: number(session.id),
          motivo: "DEVOLUCIÓN DE PRUEBA",
          items: [{ detalle_venta_id: detailId, cantidad: 2 }],
        },
      });
      const refunded = expectStatus(await refundRequest(), 201, "devolución");
      const refundId = number(refunded.devolucion.id);
      assert.equal(number(expectStatus(await refundRequest(), 200, "replay de devolución").devolucion.id),
        refundId);
      const returnInventory = await inventoryRows(
        pool,
        "tipo='DEVOLUCION' AND devolucion_id=$1 AND producto_id=$2",
        [refundId, returnProduct.id]
      );
      assert.equal(returnInventory.length, 1);
      assert.equal(number(returnInventory[0].delta_fisico), 2);
      assert.equal(number(returnInventory[0].usuario_id), number(supervisor.id));
      assert.equal(number(returnInventory[0].stock_fisico_resultante), 7);
      const returnSaleInventory = await inventoryRows(
        pool, "tipo='VENTA' AND venta_id=$1 AND producto_id=$2", [returnableSale.id, returnProduct.id]
      );
      assert.equal(returnSaleInventory.length, 1);

      const finalStocks = await pool.query(
        `SELECT id, stock FROM productos WHERE id=ANY($1::int[]) ORDER BY id`,
        [[cancelProduct.id, returnProduct.id]]
      );
      const stockByProduct = new Map(finalStocks.rows.map((row) => [number(row.id), row.stock]));
      assert.equal(stockByProduct.get(number(cancelProduct.id)), 10);
      assert.equal(stockByProduct.get(number(returnProduct.id)), 7);
    });
  } finally {
    await environment.cleanup();
  }
});
