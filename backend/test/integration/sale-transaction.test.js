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

async function seedCashier(pool, baseUrl) {
  await pool.query(
    `INSERT INTO roles (nombre) VALUES ('CAJERO') ON CONFLICT (nombre) DO NOTHING`
  );
  const label = nextLabel("cajero-venta-integral");
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const user = (await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1, $2, $3, id FROM roles WHERE nombre='CAJERO'
     RETURNING id, nombre, email`,
    [label, `${label}@tests.local`, passwordHash]
  )).rows[0];
  const login = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, "login del cajero");
  return { ...user, token: login.token };
}

async function createProduct(pool, { sku, title, price, stock, iva }) {
  return (await pool.query(
    `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
     VALUES ($1,$2,$3,0,$4,$5,TRUE)
     RETURNING id, sku, titulo, precio, stock, iva`,
    [sku, title, price, stock, iva]
  )).rows[0];
}

test("registro transaccional integral de la venta", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;

  try {
    const cashier = await seedCashier(pool, baseUrl);
    const register = (await pool.query(
      `INSERT INTO caja (nombre, activo) VALUES ($1,TRUE) RETURNING id, nombre`,
      [nextLabel("Caja venta integral")]
    )).rows[0];
    const open = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
      method: "POST",
      token: cashier.token,
      body: { caja_id: number(register.id), fondo_inicial: 70 },
    }), 201, "apertura de caja");
    const session = open.sesion || open;
    const first = await createProduct(pool, {
      sku: nextLabel("TX-A"),
      title: "Libro histórico A",
      price: 116,
      stock: 5,
      iva: 16,
    });
    const second = await createProduct(pool, {
      sku: nextLabel("TX-B"),
      title: "Libro histórico B",
      price: 50,
      stock: 4,
      iva: 0,
    });
    const key = randomUUID();
    const body = {
      sesion_id: number(session.id),
      metodo_pago: "EFECTIVO",
      cliente: "LECTOR DE PRUEBA",
      recibido: 400,
      items: [
        { producto_id: number(first.id), cantidad: 1 },
        { producto_id: number(second.id), cantidad: 2 },
        { producto_id: number(first.id), cantidad: 1 },
      ],
    };

    await t.test("concilia encabezado, partidas, inventario, kardex, caja e historia", async () => {
      const sale = expectStatus(await apiRequest(baseUrl, "/ventas", {
        method: "POST",
        token: cashier.token,
        body,
        idempotencyKey: key,
      }), 201, "venta integral");

      assert.equal(number(sale.sesion_id), number(session.id));
      assert.equal(number(sale.caja_id), number(register.id));
      assert.equal(number(sale.usuario_id), number(cashier.id));
      assert.equal(sale.cajero, cashier.nombre);
      assert.equal(sale.caja_nombre, register.nombre);
      assert.equal(sale.metodo_pago, "EFECTIVO");
      assert.equal(sale.cliente, "LECTOR DE PRUEBA");
      assert.equal(number(sale.subtotal), 300);
      assert.equal(number(sale.iva), 32);
      assert.equal(number(sale.total), 332);
      assert.equal(number(sale.recibido), 400);
      assert.equal(number(sale.cambio), 68);
      assert.equal(sale.estado, "COMPLETADA");
      assert.ok(Number.isFinite(Date.parse(sale.creado_en)));
      assert.equal(sale.detalle.length, 2);
      assert.deepEqual(sale.detalle.map((row) => ({
        sku: row.sku,
        titulo: row.titulo,
        cantidad: number(row.cantidad),
        precio: number(row.precio_unitario),
        importe: number(row.importe),
      })), [
        { sku: first.sku, titulo: first.titulo, cantidad: 2, precio: 116, importe: 232 },
        { sku: second.sku, titulo: second.titulo, cantidad: 2, precio: 50, importe: 100 },
      ]);

      const storedSale = (await pool.query(
        `SELECT v.*, s.caja_id AS sesion_caja_id
         FROM ventas v
         JOIN sesiones_caja s ON s.id=v.sesion_id
         WHERE v.id=$1`,
        [sale.id]
      )).rows[0];
      assert.equal(number(storedSale.usuario_id), number(cashier.id));
      assert.equal(number(storedSale.caja_id), number(register.id));
      assert.equal(number(storedSale.sesion_caja_id), number(register.id));
      assert.equal(number(storedSale.total), 332);

      const details = (await pool.query(
        `SELECT * FROM detalle_ventas WHERE venta_id=$1 ORDER BY producto_id`,
        [sale.id]
      )).rows;
      assert.deepEqual(details.map((row) => ({
        producto_id: number(row.producto_id),
        sku: row.producto_sku,
        titulo: row.producto_titulo,
        cantidad: number(row.cantidad),
        precio: number(row.precio_unitario),
        iva: number(row.iva_porcentaje),
        importe: number(row.importe),
      })), [
        {
          producto_id: number(first.id),
          sku: first.sku,
          titulo: first.titulo,
          cantidad: 2,
          precio: 116,
          iva: 16,
          importe: 232,
        },
        {
          producto_id: number(second.id),
          sku: second.sku,
          titulo: second.titulo,
          cantidad: 2,
          precio: 50,
          iva: 0,
          importe: 100,
        },
      ]);

      const stocks = (await pool.query(
        `SELECT id, stock FROM productos WHERE id=ANY($1::int[]) ORDER BY id`,
        [[first.id, second.id]]
      )).rows;
      assert.deepEqual(stocks.map((row) => number(row.stock)), [3, 2]);

      const inventory = (await pool.query(
        `SELECT producto_id, usuario_id, delta_fisico, stock_fisico_resultante
         FROM inventario_movimientos
         WHERE venta_id=$1 AND tipo='VENTA'
         ORDER BY producto_id`,
        [sale.id]
      )).rows;
      assert.deepEqual(inventory.map((row) => ({
        producto_id: number(row.producto_id),
        usuario_id: number(row.usuario_id),
        delta: number(row.delta_fisico),
        saldo: number(row.stock_fisico_resultante),
      })), [
        { producto_id: number(first.id), usuario_id: number(cashier.id), delta: -2, saldo: 3 },
        { producto_id: number(second.id), usuario_id: number(cashier.id), delta: -2, saldo: 2 },
      ]);

      const movement = (await pool.query(
        `SELECT * FROM movimientos WHERE venta_id=$1 AND tipo='VENTA'`,
        [sale.id]
      )).rows;
      assert.equal(movement.length, 1);
      assert.equal(number(movement[0].sesion_id), number(session.id));
      assert.equal(number(movement[0].caja_id), number(register.id));
      assert.equal(number(movement[0].usuario_id), number(cashier.id));
      assert.equal(movement[0].metodo_pago, "EFECTIVO");
      assert.equal(number(movement[0].monto), 332);
      assert.equal(movement[0].referencia, sale.folio);

      const operation = (await pool.query(
        `SELECT recurso_tipo, recurso_id, completado_en
         FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='VENTA_POS' AND clave=$2`,
        [cashier.id, key]
      )).rows;
      assert.equal(operation.length, 1);
      assert.equal(operation[0].recurso_tipo, "venta");
      assert.equal(number(operation[0].recurso_id), number(sale.id));
      assert.ok(operation[0].completado_en);

      await pool.query(
        `UPDATE productos
         SET sku=CASE id WHEN $1 THEN $3 ELSE $4 END,
             titulo=CASE id WHEN $1 THEN $5 ELSE $6 END,
             precio=999
         WHERE id=ANY($2::int[])`,
        [
          first.id,
          [first.id, second.id],
          nextLabel("EDIT-A"),
          nextLabel("EDIT-B"),
          "Título editado A",
          "Título editado B",
        ]
      );

      const historical = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}`, {
        token: cashier.token,
      }), 200, "consulta histórica");
      assert.deepEqual(historical.detalle.map((row) => ({
        sku: row.sku,
        titulo: row.titulo,
        precio: number(row.precio_unitario),
      })), [
        { sku: first.sku, titulo: first.titulo, precio: 116 },
        { sku: second.sku, titulo: second.titulo, precio: 50 },
      ]);

      const replay = expectStatus(await apiRequest(baseUrl, "/ventas", {
        method: "POST",
        token: cashier.token,
        body,
        idempotencyKey: key,
      }), 200, "repetición idempotente");
      assert.equal(number(replay.id), number(sale.id));
      assert.deepEqual(replay.detalle.map((row) => row.titulo), [first.titulo, second.titulo]);

      const counts = (await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM ventas WHERE id=$1) AS ventas,
           (SELECT COUNT(*)::int FROM detalle_ventas WHERE venta_id=$1) AS detalles,
           (SELECT COUNT(*)::int FROM movimientos WHERE venta_id=$1) AS movimientos,
           (SELECT COUNT(*)::int FROM inventario_movimientos WHERE venta_id=$1) AS kardex`,
        [sale.id]
      )).rows[0];
      assert.deepEqual(counts, { ventas: 1, detalles: 2, movimientos: 1, kardex: 2 });
    });
  } finally {
    await environment.cleanup();
  }
});
