const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "TiendaSegura!2026";
let sequence = 0;

const number = (value) => Number(value);
const next = (prefix) => `${prefix}-${++sequence}`;

function expectStatus(response, expected, context) {
  assert.equal(
    response.status,
    expected,
    `${context}: HTTP ${response.status} ${JSON.stringify(response.body)}`
  );
  return response.body;
}

function token() {
  return crypto.randomBytes(24).toString("base64url");
}

function actorFor(cartToken) {
  return `PUBLICO:${crypto.createHash("sha256").update(cartToken).digest("hex")}`;
}

async function storeRequest(baseUrl, pathName, {
  method = "GET",
  cartToken,
  idempotencyKey,
  body,
} = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cartToken) headers["X-Cart-Token"] = cartToken;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}/tienda${pathName}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const raw = await response.text();
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

async function runTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function seedSupervisor(pool) {
  await pool.query(`INSERT INTO roles (nombre) VALUES ('SUPERVISOR') ON CONFLICT DO NOTHING`);
  const label = next("supervisor-web");
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const user = (await pool.query(
    `INSERT INTO usuarios (nombre,email,password_hash,rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre='SUPERVISOR'
     RETURNING id,email`,
    [label, `${label}@tests.invalid`, passwordHash]
  )).rows[0];
  const login = expectStatus(await apiRequest(pool.baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, "login supervisor");
  return { ...user, token: login.token };
}

async function createCategory(baseUrl, authToken, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/categorias", {
    method: "POST",
    token: authToken,
    body: {
      nombre: `Categoría web ${suffix}`,
      slug: `categoria-web-${suffix}`,
      descripcion: "Categoría pública de prueba.",
      orden: suffix,
      ...overrides,
    },
  }), 201, "crear categoría web");
}

async function createProduct(baseUrl, authToken, {
  categoryId = null,
  stock = 5,
  price = 100,
  publish = true,
} = {}) {
  const suffix = ++sequence;
  const product = expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token: authToken,
    body: {
      sku: `WEB-${suffix}`,
      titulo: `Libro web ${suffix}`,
      autor: "Autora de prueba",
      editorial: "Editorial REM",
      categoria_id: categoryId == null ? null : number(categoryId),
      precio: price,
      costo: 30,
      stock,
      iva: 16,
      slug: `libro-web-${suffix}`,
      descripcion_comercial: `Descripción comercial ${suffix}.`,
    },
  }), 201, "crear producto web");
  if (!publish) return product;
  expectStatus(await apiRequest(baseUrl, `/productos/${product.id}/imagenes`, {
    method: "POST",
    token: authToken,
    body: {
      url: `https://images.example.test/${product.id}.jpg`,
      texto_alternativo: `Portada de ${product.titulo}`,
      orden: 0,
      principal: true,
    },
  }), 201, "crear portada web");
  return expectStatus(await apiRequest(baseUrl, `/productos/${product.id}/publicacion`, {
    method: "PATCH",
    token: authToken,
    body: { publicado_web: true },
  }), 200, "publicar producto web");
}

async function createWebPriceRule(baseUrl, authToken, productId) {
  return expectStatus(await apiRequest(baseUrl, "/precios/reglas", {
    method: "POST",
    token: authToken,
    body: {
      nombre: next("Precio-web"),
      canal: "WEB",
      tipo: "PORCENTAJE",
      valor: 20,
      producto_id: number(productId),
      cantidad_minima: 1,
      prioridad: 100,
      activo: true,
    },
  }), 201, "crear regla de precio web");
}

function pickupOrder(productId, quantity = 1, label = "Cliente web") {
  return {
    cliente: {
      nombre: label,
      telefono: "+52 55 1000 2000",
      email: "cliente.web@example.test",
    },
    tipo_entrega: "RECOLECCION",
    notas: "Preparar para recolección.",
    items: [{ producto_id: number(productId), cantidad: quantity }],
  };
}

async function productBalance(pool, productId) {
  const row = (await pool.query(
    `SELECT stock,stock_reservado,stock_disponible FROM productos WHERE id=$1`,
    [productId]
  )).rows[0];
  return {
    stock: number(row.stock),
    stock_reservado: number(row.stock_reservado),
    stock_disponible: number(row.stock_disponible),
  };
}

test("tienda pública omnicanal", { timeout: 180000 }, async (t) => {
  const previousWhatsapp = process.env.STORE_WHATSAPP_NUMBER;
  process.env.STORE_WHATSAPP_NUMBER = "+52 55 1234 5678";
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  pool.baseUrl = baseUrl;
  try {
    const supervisor = await seedSupervisor(pool);
    const category = await createCategory(baseUrl, supervisor.token);
    const emptyCategory = await createCategory(baseUrl, supervisor.token);
    const published = await createProduct(baseUrl, supervisor.token, {
      categoryId: category.id,
      stock: 6,
      price: 100,
    });
    const unpublished = await createProduct(baseUrl, supervisor.token, {
      categoryId: emptyCategory.id,
      stock: 4,
      price: 70,
      publish: false,
    });
    await createWebPriceRule(baseUrl, supervisor.token, published.id);

    await t.test("expone solo catálogo publicado y aplica el precio WEB", async () => {
      const config = expectStatus(await storeRequest(baseUrl, "/config"), 200, "config pública");
      assert.equal(config.nombre, "Librería REM");
      assert.equal(config.moneda, "MXN");
      assert.equal(config.whatsapp_disponible, true);
      assert.deepEqual(config.tipos_entrega, ["ENVIO", "RECOLECCION"]);

      const categories = expectStatus(
        await storeRequest(baseUrl, "/categorias"), 200, "categorías públicas"
      );
      assert.ok(categories.some((item) => item.slug === category.slug));
      assert.equal(categories.some((item) => item.slug === emptyCategory.slug), false);

      const catalog = expectStatus(await storeRequest(
        baseUrl, `/productos?categoria_slug=${category.slug}`
      ), 200, "catálogo por categoría");
      assert.equal(catalog.resultados.length, 1);
      assert.equal(number(catalog.resultados[0].id), number(published.id));
      assert.equal(number(catalog.resultados[0].precio_lista), 100);
      assert.equal(number(catalog.resultados[0].precio_unitario), 80);
      assert.equal(number(catalog.resultados[0].disponible), 6);
      assert.match(catalog.resultados[0].imagen_principal, /^https:\/\//);

      const detail = expectStatus(await storeRequest(
        baseUrl, `/productos/${published.slug}`
      ), 200, "detalle público");
      assert.equal(detail.imagenes.length, 1);
      assert.equal(detail.imagenes[0].principal, true);
      expectStatus(await storeRequest(
        baseUrl, `/productos/${unpublished.slug}`
      ), 404, "producto no publicado oculto");

      expectStatus(await storeRequest(baseUrl, "/cotizar", {
        method: "POST",
        body: { items: [{ producto_id: number(unpublished.id), cantidad: 1 }] },
      }), 404, "cotización rechaza producto oculto");
      const hiddenOrder = await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken: token(),
        idempotencyKey: crypto.randomUUID(),
        body: pickupOrder(unpublished.id),
      });
      expectStatus(hiddenOrder, 404, "pedido directo rechaza producto oculto");
      assert.equal(JSON.stringify(hiddenOrder.body).includes(unpublished.titulo), false);
    });

    await t.test("rechaza una creación directa si la categoría dejó de estar disponible", async () => {
      const inactiveCategory = await createCategory(baseUrl, supervisor.token);
      const hiddenProduct = await createProduct(baseUrl, supervisor.token, {
        categoryId: inactiveCategory.id,
        stock: 2,
      });
      expectStatus(await apiRequest(baseUrl, `/categorias/${inactiveCategory.id}`, {
        method: "DELETE",
        token: supervisor.token,
      }), 200, "desactivar categoría pública");

      expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken: token(),
        idempotencyKey: crypto.randomUUID(),
        body: pickupOrder(hiddenProduct.id),
      }), 404, "pedido con categoría inactiva");
      assert.deepEqual(await productBalance(pool, hiddenProduct.id), {
        stock: 2,
        stock_reservado: 0,
        stock_disponible: 2,
      });
    });

    await t.test("cotiza y crea el pedido con reserva e idempotencia pública", async () => {
      const quote = expectStatus(await storeRequest(baseUrl, "/cotizar", {
        method: "POST",
        body: { items: [{ producto_id: number(published.id), cantidad: 2 }] },
      }), 200, "cotización pública");
      assert.equal(quote.canal, "WEB");
      assert.equal(quote.lineas.length, 1);
      assert.equal(number(quote.lineas[0].precio_unitario), 80);
      assert.equal(number(quote.lineas[0].importe), 160);
      assert.equal(number(quote.total), 160);
      assert.equal(quote.lineas[0].disponible_suficiente, true);

      const cartToken = token();
      const key = crypto.randomUUID();
      const payload = pickupOrder(published.id, 2);
      const first = expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken,
        idempotencyKey: key,
        body: payload,
      }), 201, "crear pedido web");
      assert.match(first.folio, /^P-[0-9]{10}$/);
      assert.equal(first.estado, "RESERVADO");
      assert.equal(number(first.total), 160);
      assert.equal(first.detalle.length, 1);
      assert.equal(number(first.detalle[0].cantidad), 2);
      assert.equal("id" in first, false);
      assert.equal("publico_actor_clave" in first, false);
      assert.match(first.whatsapp_url, /^https:\/\/wa\.me\/525512345678\?text=/);

      const replay = expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken,
        idempotencyKey: key,
        body: payload,
      }), 200, "replay de pedido web");
      assert.equal(replay.folio, first.folio);
      expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken,
        idempotencyKey: key,
        body: pickupOrder(published.id, 3),
      }), 409, "misma clave con payload distinto");

      const stored = (await pool.query(
        `SELECT * FROM pedidos WHERE folio=$1`, [first.folio]
      )).rows[0];
      assert.equal(stored.canal, "WEB");
      assert.equal(stored.canal_precio, "WEB");
      assert.equal(stored.creado_por_usuario_id, null);
      assert.equal(stored.cliente_id, null);
      assert.equal(stored.publico_actor_clave, actorFor(cartToken));
      assert.equal(JSON.stringify(stored).includes(cartToken), false);
      assert.deepEqual(await productBalance(pool, published.id), {
        stock: 6,
        stock_reservado: 2,
        stock_disponible: 4,
      });
      const reservations = await pool.query(
        `SELECT * FROM reservas_stock WHERE pedido_id=$1`, [stored.id]
      );
      assert.equal(reservations.rowCount, 1);
      assert.equal(reservations.rows[0].estado, "ACTIVA");
      const reservationLedger = await pool.query(
        `SELECT * FROM inventario_movimientos WHERE pedido_id=$1 AND tipo='RESERVA'`,
        [stored.id]
      );
      assert.equal(reservationLedger.rowCount, 1);
      assert.equal(reservationLedger.rows[0].actor, "SISTEMA");
      assert.equal(reservationLedger.rows[0].usuario_id, null);
      assert.equal(number(reservationLedger.rows[0].delta_fisico), 0);
      assert.equal(number(reservationLedger.rows[0].delta_reservado), 2);

      expectStatus(await storeRequest(baseUrl, `/pedidos/${first.folio}`), 400, "consulta sin token");
      expectStatus(await storeRequest(baseUrl, `/pedidos/${first.folio}`, {
        cartToken: token(),
      }), 404, "privacidad entre carritos");
      const own = expectStatus(await storeRequest(baseUrl, `/pedidos/${first.folio}`, {
        cartToken,
      }), 200, "consulta del propio pedido");
      assert.equal(own.folio, first.folio);

      const cancelKey = crypto.randomUUID();
      expectStatus(await storeRequest(baseUrl, `/pedidos/${first.folio}/cancelacion`, {
        method: "POST",
        cartToken: token(),
        idempotencyKey: crypto.randomUUID(),
        body: { motivo: "Intento con carrito ajeno" },
      }), 404, "cancelación privada");
      const cancelled = expectStatus(await storeRequest(
        baseUrl, `/pedidos/${first.folio}/cancelacion`, {
          method: "POST",
          cartToken,
          idempotencyKey: cancelKey,
          body: { motivo: "El cliente cambió de opinión" },
        }
      ), 201, "cancelación pública");
      assert.equal(cancelled.estado, "CANCELADO");
      const cancelReplay = expectStatus(await storeRequest(
        baseUrl, `/pedidos/${first.folio}/cancelacion`, {
          method: "POST",
          cartToken,
          idempotencyKey: cancelKey,
          body: { motivo: "El cliente cambió de opinión" },
        }
      ), 200, "replay de cancelación pública");
      assert.equal(cancelReplay.estado, "CANCELADO");
      expectStatus(await storeRequest(baseUrl, `/pedidos/${first.folio}/cancelacion`, {
        method: "POST",
        cartToken,
        idempotencyKey: cancelKey,
        body: { motivo: "Motivo diferente no permitido" },
      }), 409, "cancelación con payload distinto");
      assert.deepEqual(await productBalance(pool, published.id), {
        stock: 6,
        stock_reservado: 0,
        stock_disponible: 6,
      });
      const releaseLedger = await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='LIBERACION_RESERVA'`,
        [stored.id]
      );
      assert.equal(releaseLedger.rowCount, 1);
      assert.equal(releaseLedger.rows[0].actor, "SISTEMA");
      assert.equal(number(releaseLedger.rows[0].delta_reservado), -2);
      const transition = (await pool.query(
        `SELECT actor FROM pedido_transiciones WHERE pedido_id=$1 ORDER BY id DESC LIMIT 1`,
        [stored.id]
      )).rows[0];
      assert.equal(transition.actor, "PUBLICO");
    });

    await t.test("permite pedidos secuenciales del mismo carrito con claves distintas", async () => {
      const reusableToken = token();
      const first = expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken: reusableToken,
        idempotencyKey: crypto.randomUUID(),
        body: pickupOrder(published.id, 1, "Cliente recurrente uno"),
      }), 201, "primer pedido del carrito reutilizado");
      const second = expectStatus(await storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken: reusableToken,
        idempotencyKey: crypto.randomUUID(),
        body: pickupOrder(published.id, 1, "Cliente recurrente dos"),
      }), 201, "segundo pedido del carrito reutilizado");
      assert.notEqual(first.folio, second.folio);
      const stored = await pool.query(
        `SELECT folio FROM pedidos
         WHERE publico_actor_clave=$1 AND folio=ANY($2::text[])
         ORDER BY folio`,
        [actorFor(reusableToken), [first.folio, second.folio]]
      );
      assert.equal(stored.rowCount, 2);
    });

    await t.test("expira perezosamente y libera la reserva una sola vez", async () => {
      const expiringProduct = await createProduct(baseUrl, supervisor.token, { stock: 2 });
      const expiringToken = token();
      const { crearPedidoReservado } = require("../../src/services/pedidos.service");
      const order = await runTransaction(pool, (client) => crearPedidoReservado(client, {
        canal: "WEB",
        actorClave: actorFor(expiringToken),
        cliente: pickupOrder(expiringProduct.id).cliente,
        tipoEntrega: "RECOLECCION",
        items: [{ producto_id: number(expiringProduct.id), cantidad: 1 }],
        duracionMinutos: 0.003,
      }));
      assert.equal(order.estado, "RESERVADO");
      assert.equal(number((await productBalance(pool, expiringProduct.id)).stock_reservado), 1);
      await new Promise((resolve) => setTimeout(resolve, 350));

      const expired = expectStatus(await storeRequest(baseUrl, `/pedidos/${order.folio}`, {
        cartToken: expiringToken,
      }), 200, "consulta procesa expiración");
      assert.equal(expired.estado, "EXPIRADO");
      assert.deepEqual(await productBalance(pool, expiringProduct.id), {
        stock: 2,
        stock_reservado: 0,
        stock_disponible: 2,
      });
      const finals = await pool.query(
        `SELECT tipo,delta_fisico,delta_reservado,actor
         FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='EXPIRACION_RESERVA'`,
        [order.id]
      );
      assert.equal(finals.rowCount, 1);
      assert.equal(number(finals.rows[0].delta_fisico), 0);
      assert.equal(number(finals.rows[0].delta_reservado), -1);
      assert.equal(finals.rows[0].actor, "SISTEMA");
      assert.equal((await pool.query(
        `SELECT estado FROM reservas_stock WHERE pedido_id=$1`, [order.id]
      )).rows[0].estado, "EXPIRADA");
    });

    await t.test("serializa dos carritos por la última unidad", async () => {
      const lastUnit = await createProduct(baseUrl, supervisor.token, { stock: 1 });
      const requests = ["A", "B"].map((label) => storeRequest(baseUrl, "/pedidos", {
        method: "POST",
        cartToken: token(),
        idempotencyKey: crypto.randomUUID(),
        body: pickupOrder(lastUnit.id, 1, `Cliente concurrente ${label}`),
      }));
      const responses = await Promise.all(requests);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.deepEqual(await productBalance(pool, lastUnit.id), {
        stock: 1,
        stock_reservado: 1,
        stock_disponible: 0,
      });
      const active = await pool.query(
        `SELECT id FROM reservas_stock WHERE producto_id=$1 AND estado='ACTIVA'`,
        [lastUnit.id]
      );
      assert.equal(active.rowCount, 1);
      const webOrders = await pool.query(
        `SELECT id FROM pedidos p
         WHERE p.canal='WEB'
           AND EXISTS (
             SELECT 1 FROM detalle_pedidos d
             WHERE d.pedido_id=p.id AND d.producto_id=$1
           )`,
        [lastUnit.id]
      );
      assert.equal(webOrders.rowCount, 1);
    });
  } finally {
    await environment.cleanup();
    if (previousWhatsapp === undefined) delete process.env.STORE_WHATSAPP_NUMBER;
    else process.env.STORE_WHATSAPP_NUMBER = previousWhatsapp;
  }
});
