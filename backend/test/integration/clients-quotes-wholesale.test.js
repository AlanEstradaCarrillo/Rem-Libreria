const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");
const { expirarCotizacionesVencidas } = require("../../src/services/cotizaciones.service");

const TEST_PASSWORD = "ClientesCotizaciones!2026";
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
    [label, `${label}@quotes.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  return expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`).token;
}

async function createProduct(baseUrl, token, { stock = 10, price = 100 } = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `CQM-${suffix}`,
      titulo: `Libro cotización ${suffix}`,
      precio: price,
      costo: 20,
      stock,
      iva: 0,
    },
  }), 201, "crear producto");
}

async function createCustomer(baseUrl, token, {
  segment = "PUBLICO",
  phone = null,
} = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/clientes", {
    method: "POST",
    token,
    body: {
      nombre: `Cliente cotización ${suffix}`,
      telefono: phone || `555300${String(suffix).padStart(4, "0")}`,
      email: `cliente-cotizacion-${suffix}@tests.local`,
      direccion: `Calle editorial ${suffix}`,
      segmento_precio: segment,
    },
  }), 201, "crear cliente");
}

async function createRule(baseUrl, token, {
  productId,
  name,
  segment = "TODOS",
  value,
  priority = 10,
} = {}) {
  return expectStatus(await apiRequest(baseUrl, "/precios/reglas", {
    method: "POST",
    token,
    body: {
      nombre: name,
      canal: "POS",
      segmento_cliente: segment,
      tipo: "PORCENTAJE",
      valor: value,
      producto_id: number(productId),
      categoria_id: null,
      cantidad_minima: 1,
      prioridad: priority,
      vigente_desde: null,
      vigente_hasta: null,
      activo: true,
    },
  }), 201, `crear regla ${name}`);
}

async function createRegister(pool) {
  return (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1,TRUE) RETURNING *`,
    [nextLabel("Caja cotizaciones")]
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

function createQuoteRequest(baseUrl, token, {
  customerId,
  productId,
  quantity = 1,
  key = randomUUID(),
  notes = "Cotización de prueba",
  validityDays = 7,
} = {}) {
  return apiRequest(baseUrl, "/cotizaciones", {
    method: "POST",
    token,
    idempotencyKey: key,
    body: {
      cliente_id: number(customerId),
      notas: notes,
      vigencia_dias: validityDays,
      items: [{ producto_id: number(productId), cantidad: quantity }],
    },
  });
}

function convertQuoteRequest(baseUrl, token, quoteId, {
  key = randomUUID(),
  delivery = "RECOLECCION",
} = {}) {
  return apiRequest(baseUrl, `/cotizaciones/${quoteId}/conversion`, {
    method: "POST",
    token,
    idempotencyKey: key,
    body: { tipo_entrega: delivery },
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

async function stockBalance(pool, productId) {
  return (await pool.query(
    `SELECT stock, stock_reservado, stock_disponible
     FROM productos WHERE id=$1`,
    [productId]
  )).rows[0];
}

test("clientes, cotizaciones persistentes y mayoreo", { timeout: 240000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await seedRoles(pool);
    const admin = await createUser(pool, "ADMIN");
    admin.token = await login(baseUrl, admin);
    const supervisor = await createUser(pool, "SUPERVISOR");
    supervisor.token = await login(baseUrl, supervisor);
    const cashier = await createUser(pool, "CAJERO");
    cashier.token = await login(baseUrl, cashier);
    const register = await createRegister(pool);
    const session = await openRegister(baseUrl, cashier, register);

    let wholesaleCustomer;
    let product;
    let publicRule;
    let wholesaleRule;

    await t.test("resuelve el segmento en servidor y aplica permisos de mayoreo", async () => {
      expectStatus(await apiRequest(baseUrl, "/clientes", {
        method: "POST",
        token: cashier.token,
        body: {
          nombre: "Asignación no autorizada",
          telefono: "5553009999",
          segmento_precio: "MAYOREO",
        },
      }), 403, "cajero asigna mayoreo");

      wholesaleCustomer = await createCustomer(baseUrl, admin.token, { segment: "MAYOREO" });
      const publicCustomer = await createCustomer(baseUrl, cashier.token);
      assert.equal(wholesaleCustomer.segmento_precio, "MAYOREO");
      assert.equal(publicCustomer.segmento_precio, "PUBLICO");
      expectStatus(await apiRequest(baseUrl, `/clientes/${publicCustomer.id}`, {
        method: "PATCH",
        token: cashier.token,
        body: { segmento_precio: "MAYOREO" },
      }), 403, "cajero cambia segmento");

      product = await createProduct(baseUrl, supervisor.token, { stock: 20, price: 100 });
      publicRule = await createRule(baseUrl, supervisor.token, {
        productId: product.id,
        name: nextLabel("Público 10"),
        segment: "TODOS",
        value: 10,
      });
      wholesaleRule = await createRule(baseUrl, supervisor.token, {
        productId: product.id,
        name: nextLabel("Mayoreo 40"),
        segment: "MAYOREO",
        value: 40,
      });

      const quote = async (customerId = null) => {
        const body = {
          canal: "POS",
          items: [{ producto_id: number(product.id), cantidad: 1 }],
        };
        if (customerId != null) body.cliente_id = number(customerId);
        return expectStatus(await apiRequest(baseUrl, "/precios/cotizar", {
          method: "POST",
          token: cashier.token,
          body,
        }), 200, "cotizar segmento");
      };
      const publicPrice = await quote();
      const registeredPublicPrice = await quote(publicCustomer.id);
      const wholesalePrice = await quote(wholesaleCustomer.id);
      assert.equal(publicPrice.segmento_cliente, "PUBLICO");
      assert.equal(number(publicPrice.lineas[0].precio_unitario), 90);
      assert.equal(number(publicPrice.lineas[0].regla_precio_id), number(publicRule.id));
      assert.equal(number(registeredPublicPrice.lineas[0].precio_unitario), 90);
      assert.equal(wholesalePrice.segmento_cliente, "MAYOREO");
      assert.equal(number(wholesalePrice.lineas[0].precio_unitario), 60);
      assert.equal(number(wholesalePrice.lineas[0].regla_precio_id), number(wholesaleRule.id));

      expectStatus(await apiRequest(baseUrl, "/precios/cotizar", {
        method: "POST",
        token: cashier.token,
        body: {
          canal: "WEB",
          cliente_id: number(wholesaleCustomer.id),
          items: [{ producto_id: number(product.id), cantidad: 1 }],
        },
      }), 400, "web no acepta segmento registrado");
    });

    await t.test("asocia la venta directa y conserva su snapshot al reproducir", async () => {
      const key = randomUUID();
      const body = {
        sesion_id: number(session.id),
        metodo_pago: "EFECTIVO",
        cliente_id: number(wholesaleCustomer.id),
        recibido: 100,
        items: [{ producto_id: number(product.id), cantidad: 1 }],
      };
      const sell = () => apiRequest(baseUrl, "/ventas", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: key,
        body,
      });
      const responses = await Promise.all([sell(), sell()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      const sale = responses[0].body;
      assert.equal(number(sale.cliente_id), number(wholesaleCustomer.id));
      assert.equal(sale.cliente, wholesaleCustomer.nombre);
      assert.equal(sale.segmento_precio, "MAYOREO");
      assert.equal(number(sale.total), 60);
      assert.equal(number(sale.detalle[0].regla_precio_id), number(wholesaleRule.id));
      assert.equal(number(sale.usuario_id), number(cashier.id));
      assert.equal(number(sale.sesion_id), number(session.id));
      assert.equal(number(sale.caja_id), number(register.id));

      expectStatus(await apiRequest(baseUrl, `/clientes/${wholesaleCustomer.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { nombre: "Cliente renombrado", segmento_precio: "PUBLICO" },
      }), 200, "cambiar cliente después de venta");
      const replay = expectStatus(await sell(), 200, "replay después de cambiar cliente");
      assert.equal(replay.cliente, wholesaleCustomer.nombre);
      assert.equal(replay.segmento_precio, "MAYOREO");
      assert.equal(number(replay.total), 60);

      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM ventas WHERE id=$1`, [sale.id]
      )).rows[0].n), 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM movimientos WHERE venta_id=$1`, [sale.id]
      )).rows[0].n), 1);
      expectStatus(await apiRequest(baseUrl, "/ventas", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { ...body, cliente: "Nombre incompatible" },
      }), 400, "venta combina dos identidades");

      wholesaleCustomer = expectStatus(await apiRequest(
        baseUrl, `/clientes/${wholesaleCustomer.id}`, {
          method: "PATCH",
          token: supervisor.token,
          body: { nombre: wholesaleCustomer.nombre, segmento_precio: "MAYOREO" },
        }
      ), 200, "restaurar cliente mayoreo");
    });

    let persistentQuote;
    await t.test("crea un documento idempotente sin reservar inventario", async () => {
      const before = await stockBalance(pool, product.id);
      const ledgerBefore = number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n);
      const key = randomUUID();
      const request = () => apiRequest(baseUrl, "/cotizaciones", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: key,
        body: {
          cliente_id: number(wholesaleCustomer.id),
          notas: "Dos ejemplares para editorial",
          vigencia_dias: 10,
          items: [
            { producto_id: number(product.id), cantidad: 1 },
            { producto_id: number(product.id), cantidad: 1 },
          ],
        },
      });
      const responses = await Promise.all([request(), request()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      assert.equal(number(responses[0].body.id), number(responses[1].body.id));
      persistentQuote = responses[0].body;
      assert.equal(persistentQuote.estado, "VIGENTE");
      assert.equal(persistentQuote.segmento_precio, "MAYOREO");
      assert.equal(persistentQuote.detalle.length, 1);
      assert.equal(number(persistentQuote.detalle[0].cantidad), 2);
      assert.equal(number(persistentQuote.detalle[0].precio_unitario), 60);
      assert.equal(number(persistentQuote.total), 120);
      assert.deepEqual(persistentQuote.transiciones.map((row) => row.estado_nuevo), ["VIGENTE"]);
      assert.deepEqual(await stockBalance(pool, product.id), before);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM reservas_stock WHERE producto_id=$1`, [product.id]
      )).rows[0].n), 0);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n), ledgerBefore);

      await assert.rejects(
        pool.query(`UPDATE cotizaciones SET total=1 WHERE id=$1`, [persistentQuote.id]),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `UPDATE detalle_cotizaciones SET cantidad=3 WHERE cotizacion_id=$1`,
          [persistentQuote.id]
        ),
        (error) => error.code === "55000"
      );
    });

    await t.test("convierte con snapshots exactos, reserva una vez y cobra sin doble salida", async () => {
      expectStatus(await apiRequest(baseUrl, `/precios/reglas/${wholesaleRule.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { valor: 50 },
      }), 200, "cambiar regla después de cotizar");
      expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { precio: 120 },
      }), 200, "cambiar precio después de cotizar");
      expectStatus(await apiRequest(baseUrl, `/clientes/${wholesaleCustomer.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { segmento_precio: "PUBLICO" },
      }), 200, "cambiar segmento después de cotizar");

      const key = randomUUID();
      const convert = () => convertQuoteRequest(
        baseUrl,
        cashier.token,
        persistentQuote.id,
        { key }
      );
      const responses = await Promise.all([convert(), convert()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      assert.equal(number(responses[0].body.pedido.id), number(responses[1].body.pedido.id));
      const conversion = responses[0].body;
      const order = conversion.pedido;
      assert.equal(conversion.cotizacion.estado, "CONVERTIDA");
      assert.equal(number(order.cotizacion_id), number(persistentQuote.id));
      assert.equal(order.segmento_precio, "MAYOREO");
      assert.equal(number(order.total), 120);
      assert.equal(number(order.detalle[0].precio_unitario), 60);
      assert.equal(number(order.detalle[0].regla_precio_id), number(wholesaleRule.id));
      assert.equal(order.estado, "RESERVADO");
      assert.equal(order.detalle[0].reserva_estado, "ACTIVA");
      assert.deepEqual(await stockBalance(pool, product.id), {
        stock: 19,
        stock_reservado: 2,
        stock_disponible: 17,
      });
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='RESERVA'`,
        [order.id]
      )).rows[0].n), 1);

      const sale = expectStatus(await apiRequest(
        baseUrl, `/ventas/desde-pedido/${order.id}`, {
          method: "POST",
          token: cashier.token,
          idempotencyKey: randomUUID(),
          body: {
            sesion_id: number(session.id),
            metodo_pago: "EFECTIVO",
            recibido: 200,
          },
        }
      ), 201, "cobrar pedido de cotización");
      assert.equal(number(sale.total), 120);
      assert.equal(sale.segmento_precio, "MAYOREO");
      assert.equal(number(sale.detalle[0].precio_unitario), 60);
      assert.deepEqual(await stockBalance(pool, product.id), {
        stock: 17,
        stock_reservado: 0,
        stock_disponible: 17,
      });
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='CONSUMO_RESERVA'`,
        [order.id]
      )).rows[0].n), 1);
      const replay = expectStatus(await convert(), 200, "replay de conversión ya cobrada");
      assert.equal(replay.pedido.estado, "COMPLETADO");
      assert.equal(number(replay.pedido.id), number(order.id));
      expectStatus(await convertQuoteRequest(
        baseUrl, cashier.token, persistentQuote.id, { key: randomUUID() }
      ), 409, "segunda conversión con otra clave");
    });

    await t.test("cancela y vence cotizaciones sin tocar inventario", async () => {
      const before = await stockBalance(pool, product.id);
      const cancelled = expectStatus(await createQuoteRequest(baseUrl, cashier.token, {
        customerId: wholesaleCustomer.id,
        productId: product.id,
      }), 201, "cotización a cancelar");
      expectStatus(await apiRequest(baseUrl, `/cotizaciones/${cancelled.id}/cancelacion`, {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { motivo: "Sin permiso" },
      }), 403, "cajero cancela cotización");
      const cancelKey = randomUUID();
      const cancel = () => apiRequest(baseUrl, `/cotizaciones/${cancelled.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: cancelKey,
        body: { motivo: "Cliente ya no requiere la propuesta" },
      });
      assert.equal(expectStatus(await cancel(), 201, "cancelar cotización").estado, "CANCELADA");
      assert.equal(expectStatus(await cancel(), 200, "replay cancelación").estado, "CANCELADA");
      expectStatus(await convertQuoteRequest(baseUrl, cashier.token, cancelled.id), 409,
        "convertir cotización cancelada");

      const expiring = expectStatus(await createQuoteRequest(baseUrl, cashier.token, {
        customerId: wholesaleCustomer.id,
        productId: product.id,
        validityDays: 1,
      }), 201, "cotización a vencer");
      const cutoff = new Date(new Date(expiring.vigente_hasta).getTime() + 1000);
      const expiredIds = await runTransaction(pool, (client) =>
        expirarCotizacionesVencidas(client, { limit: 100, hasta: cutoff })
      );
      assert.ok(expiredIds.includes(number(expiring.id)));
      const expired = expectStatus(await apiRequest(
        baseUrl, `/cotizaciones/${expiring.id}`, { token: cashier.token }
      ), 200, "leer cotización vencida");
      assert.equal(expired.estado, "VENCIDA");
      assert.equal(expired.transiciones.at(-1).actor, "SISTEMA");
      assert.deepEqual(await runTransaction(pool, (client) =>
        expirarCotizacionesVencidas(client, { limit: 100, hasta: cutoff })
      ), []);
      expectStatus(await convertQuoteRequest(baseUrl, cashier.token, expiring.id), 409,
        "convertir cotización vencida");
      assert.deepEqual(await stockBalance(pool, product.id), before);
    });

    await t.test("revierte falta de stock y serializa conversiones con claves distintas", async () => {
      const emptyProduct = await createProduct(baseUrl, supervisor.token, { stock: 0, price: 50 });
      const noStockQuote = expectStatus(await createQuoteRequest(baseUrl, cashier.token, {
        customerId: wholesaleCustomer.id,
        productId: emptyProduct.id,
      }), 201, "cotización sin stock reservado");
      expectStatus(await convertQuoteRequest(baseUrl, cashier.token, noStockQuote.id), 409,
        "conversión sin stock");
      const unchanged = expectStatus(await apiRequest(
        baseUrl, `/cotizaciones/${noStockQuote.id}`, { token: cashier.token }
      ), 200, "cotización sigue vigente");
      assert.equal(unchanged.estado, "VIGENTE");
      assert.equal(unchanged.pedido_id, null);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM reservas_stock WHERE producto_id=$1`,
        [emptyProduct.id]
      )).rows[0].n), 0);

      const lastProduct = await createProduct(baseUrl, supervisor.token, { stock: 1, price: 70 });
      const racingQuote = expectStatus(await createQuoteRequest(baseUrl, cashier.token, {
        customerId: wholesaleCustomer.id,
        productId: lastProduct.id,
      }), 201, "cotización para carrera");
      const results = await Promise.all([
        convertQuoteRequest(baseUrl, cashier.token, racingQuote.id, { key: randomUUID() }),
        convertQuoteRequest(baseUrl, cashier.token, racingQuote.id, { key: randomUUID() }),
      ]);
      assert.deepEqual(
        results.map((response) => response.status).sort(),
        [201, 409],
        JSON.stringify(results.map((response) => response.body))
      );
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM pedidos WHERE cotizacion_id=$1`,
        [racingQuote.id]
      )).rows[0].n), 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM reservas_stock r
         JOIN pedidos p ON p.id=r.pedido_id WHERE p.cotizacion_id=$1`,
        [racingQuote.id]
      )).rows[0].n), 1);
      assert.deepEqual(await stockBalance(pool, lastProduct.id), {
        stock: 1,
        stock_reservado: 1,
        stock_disponible: 0,
      });
    });
  } finally {
    await environment.cleanup();
  }
});
