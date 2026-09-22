const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "CarritoSeguro!2026";
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
     SELECT $1, $2, $3, id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@cart.tests`, passwordHash, role]
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

async function createProduct(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `CART-${suffix}`,
      titulo: `Libro carrito ${suffix}`,
      precio: 116,
      costo: 40,
      stock: 5,
      iva: 16,
      ...overrides,
    },
  }), 201, `crear producto ${suffix}`);
}

function quoteRequest(baseUrl, token, items, overrides = {}) {
  return apiRequest(baseUrl, "/precios/cotizar", {
    method: "POST",
    token,
    body: { canal: "POS", items, ...overrides },
  });
}

test("carrito y preparación de venta verificados de extremo a extremo", { timeout: 120000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await seedRoles(pool);
    const supervisor = await createUser(pool, "SUPERVISOR");
    supervisor.token = await login(baseUrl, supervisor);
    const cashier = await createUser(pool, "CAJERO");
    cashier.token = await login(baseUrl, cashier);

    let product;
    await t.test("rechaza acceso, carrito vacío e identificadores o cantidades inválidas", async () => {
      expectStatus(await quoteRequest(baseUrl, null, [{ producto_id: 1, cantidad: 1 }]), 401,
        "cotización sin sesión");

      const invalidItems = [
        [],
        [{ producto_id: 0, cantidad: 1 }],
        [{ producto_id: 1, cantidad: 0 }],
        [{ producto_id: 1, cantidad: -1 }],
        [{ producto_id: 1, cantidad: 1.5 }],
        [{ producto_id: 1, cantidad: 1000 }],
        Array.from({ length: 101 }, () => ({ producto_id: 1, cantidad: 1 })),
      ];
      for (const items of invalidItems) {
        expectStatus(await quoteRequest(baseUrl, cashier.token, items), 400,
          `carrito inválido ${JSON.stringify(items)}`);
      }
    });

    await t.test("consolida duplicados y calcula subtotal, descuento, IVA y total exactos", async () => {
      product = await createProduct(baseUrl, supervisor.token, { stock: 1000 });
      const quote = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(product.id), cantidad: 2 },
        { producto_id: number(product.id), cantidad: 3 },
      ]), 200, "cotización con producto repetido");

      assert.equal(quote.lineas.length, 1);
      assert.equal(number(quote.lineas[0].cantidad), 5);
      assert.equal(number(quote.lineas[0].precio_lista), 116);
      assert.equal(number(quote.lineas[0].precio_unitario), 116);
      assert.equal(number(quote.lineas[0].importe), 580);
      assert.equal(number(quote.lineas[0].disponible), 1000);
      assert.equal(quote.lineas[0].disponible_suficiente, true);
      assert.equal(number(quote.subtotal), 500);
      assert.equal(number(quote.descuento), 0);
      assert.equal(number(quote.iva), 80);
      assert.equal(number(quote.total), 580);

      const max = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(product.id), cantidad: 600 },
        { producto_id: number(product.id), cantidad: 399 },
      ]), 200, "cantidad acumulada máxima");
      assert.equal(number(max.lineas[0].cantidad), 999);

      expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(product.id), cantidad: 600 },
        { producto_id: number(product.id), cantidad: 400 },
      ]), 400, "cantidad acumulada superior a 999");
    });

    await t.test("rechaza productos inexistentes e inactivos", async () => {
      const missingId = number(product.id) + 1000000;
      expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: missingId, cantidad: 1 },
      ]), 404, "producto inexistente");

      expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { activo: false },
      }), 200, "desactivar producto");
      expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(product.id), cantidad: 1 },
      ]), 409, "producto inactivo");
      expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { activo: true },
      }), 200, "reactivar producto");
    });

    await t.test("actualiza la disponibilidad al cambiar el inventario y marca el exceso", async () => {
      const changing = await createProduct(baseUrl, supervisor.token, {
        sku: nextLabel("STOCK-CART"),
        titulo: "Libro con existencia cambiante",
        precio: 58,
        stock: 5,
      });
      const initial = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(changing.id), cantidad: 4 },
      ]), 200, "cotización antes del ajuste");
      assert.equal(number(initial.lineas[0].disponible), 5);
      assert.equal(initial.lineas[0].disponible_suficiente, true);
      assert.equal(number(initial.subtotal), 200);
      assert.equal(number(initial.iva), 32);
      assert.equal(number(initial.total), 232);

      expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: {
          producto_id: number(changing.id),
          delta: -3,
          motivo: "Prueba de stock obsoleto en carrito",
        },
      }), 201, "reducir inventario");

      const stale = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(changing.id), cantidad: 4 },
      ]), 200, "recotización con cantidad superior al stock");
      assert.equal(number(stale.lineas[0].disponible), 2);
      assert.equal(stale.lineas[0].disponible_suficiente, false);

      const adjusted = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(changing.id), cantidad: 2 },
      ]), 200, "recotización dentro del stock actual");
      assert.equal(number(adjusted.lineas[0].disponible), 2);
      assert.equal(adjusted.lineas[0].disponible_suficiente, true);
      assert.equal(number(adjusted.subtotal), 100);
      assert.equal(number(adjusted.iva), 16);
      assert.equal(number(adjusted.total), 116);
    });

    await t.test("usa el stock disponible común después de una reserva", async () => {
      const reserved = await createProduct(baseUrl, supervisor.token, {
        sku: nextLabel("RESERVA-CART"),
        titulo: "Libro reservado para otro canal",
        stock: 3,
      });
      expectStatus(await apiRequest(baseUrl, "/pedidos", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: {
          cliente: { nombre: "Cliente prueba carrito", telefono: "5555555555" },
          tipo_entrega: "RECOLECCION",
          items: [{ producto_id: number(reserved.id), cantidad: 2 }],
        },
      }), 201, "reservar dos unidades");

      const quote = expectStatus(await quoteRequest(baseUrl, cashier.token, [
        { producto_id: number(reserved.id), cantidad: 2 },
      ]), 200, "cotización posterior a reserva");
      assert.equal(number(quote.lineas[0].disponible), 1);
      assert.equal(quote.lineas[0].disponible_suficiente, false);
    });
  } finally {
    await environment.cleanup();
  }
});
