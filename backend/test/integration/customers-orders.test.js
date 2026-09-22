const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");
const { expirarPedidosVencidos } = require("../../src/services/pedidos.service");

const TEST_PASSWORD = "PedidosSeguros!2026";
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
    [label, `${label}@orders.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`);
  return body.token;
}

async function createProduct(baseUrl, token, { stock = 5, price = 100 } = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `ORD-${suffix}`,
      titulo: `Libro pedido ${suffix}`,
      precio: price,
      costo: 20,
      stock,
      iva: 16,
    },
  }), 201, "crear producto para pedido");
}

async function createCustomer(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/clientes", {
    method: "POST",
    token,
    body: {
      nombre: `Cliente ${suffix}`,
      telefono: `555000${String(suffix).padStart(4, "0")}`,
      email: `cliente-${suffix}@orders.tests`,
      direccion: `Calle de prueba ${suffix}`,
      ...overrides,
    },
  }), 201, "crear cliente");
}

function contact(label) {
  const suffix = ++sequence;
  return {
    nombre: `${label} ${suffix}`,
    telefono: `555100${String(suffix).padStart(4, "0")}`,
    email: `${label.toLowerCase().replace(/\s+/g, "-")}-${suffix}@orders.tests`,
    direccion: `Dirección ${suffix}`,
  };
}

async function createOrder(baseUrl, token, {
  key = randomUUID(),
  customerId = null,
  customer = null,
  delivery = "RECOLECCION",
  items,
  notes = null,
} = {}) {
  const body = {
    tipo_entrega: delivery,
    items,
  };
  if (customerId != null) body.cliente_id = number(customerId);
  else body.cliente = customer || contact("Contacto");
  if (notes != null) body.notas = notes;
  return apiRequest(baseUrl, "/pedidos", {
    method: "POST",
    token,
    idempotencyKey: key,
    body,
  });
}

async function productBalance(pool, productId) {
  return (await pool.query(
    `SELECT stock, stock_reservado, stock_disponible
     FROM productos WHERE id=$1`,
    [productId]
  )).rows[0];
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

test("clientes, pedidos y reservas omnicanal", { timeout: 180000 }, async (t) => {
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

    let activeCustomer;

    await t.test("aplica CRUD y permisos sobre clientes con baja lógica", async () => {
      expectStatus(await apiRequest(baseUrl, "/clientes"), 401, "clientes sin autenticación");
      activeCustomer = await createCustomer(baseUrl, cashier.token);
      assert.equal(number(activeCustomer.creado_por_usuario_id), number(cashier.id));

      const detail = expectStatus(await apiRequest(
        baseUrl, `/clientes/${activeCustomer.id}`, { token: cashier.token }
      ), 200, "detalle de cliente por cajero");
      assert.equal(detail.email, activeCustomer.email);

      const list = expectStatus(await apiRequest(
        baseUrl, `/clientes?q=${encodeURIComponent(activeCustomer.nombre)}`, {
          token: cashier.token,
        }
      ), 200, "búsqueda de clientes");
      assert.ok(list.resultados.some((row) => number(row.id) === number(activeCustomer.id)));

      expectStatus(await apiRequest(baseUrl, `/clientes/${activeCustomer.id}`, {
        method: "PATCH",
        token: cashier.token,
        body: { notas: "Intento no autorizado" },
      }), 403, "edición de cliente por cajero");
      expectStatus(await apiRequest(baseUrl, `/clientes/${activeCustomer.id}`, {
        method: "DELETE",
        token: cashier.token,
      }), 403, "baja de cliente por cajero");

      const updated = expectStatus(await apiRequest(baseUrl, `/clientes/${activeCustomer.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { notas: "Cliente verificado", telefono: "+52 55 1234 5678" },
      }), 200, "edición de cliente por supervisor");
      assert.equal(updated.notas, "Cliente verificado");
      assert.equal(updated.telefono, "+52 55 1234 5678");
      activeCustomer = updated;

      expectStatus(await apiRequest(baseUrl, "/clientes", {
        method: "POST",
        token: cashier.token,
        body: {
          nombre: "Duplicado",
          telefono: "5551234567",
          email: activeCustomer.email.toUpperCase(),
        },
      }), 409, "correo duplicado sin distinguir mayúsculas");

      const removable = await createCustomer(baseUrl, cashier.token);
      const removed = expectStatus(await apiRequest(baseUrl, `/clientes/${removable.id}`, {
        method: "DELETE",
        token: admin.token,
      }), 200, "baja lógica de cliente");
      assert.equal(removed.activo, false);
      const activeOnly = expectStatus(await apiRequest(baseUrl, "/clientes", {
        token: cashier.token,
      }), 200, "lista activa");
      assert.equal(
        activeOnly.resultados.some((row) => number(row.id) === number(removable.id)),
        false
      );
      const includingInactive = expectStatus(await apiRequest(
        baseUrl, "/clientes?incluir_inactivos=true", { token: cashier.token }
      ), 200, "lista con inactivos");
      assert.ok(includingInactive.resultados.some(
        (row) => number(row.id) === number(removable.id) && !row.activo
      ));

      const product = await createProduct(baseUrl, supervisor.token, { stock: 2 });
      expectStatus(await createOrder(baseUrl, cashier.token, {
        customerId: removable.id,
        items: [{ producto_id: number(product.id), cantidad: 1 }],
      }), 409, "pedido para cliente inactivo");
    });

    await t.test("crea una reserva atómica con snapshots e idempotencia", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 5, price: 100 });
      const key = randomUUID();
      const request = () => createOrder(baseUrl, cashier.token, {
        key,
        customerId: activeCustomer.id,
        items: [
          { producto_id: number(product.id), cantidad: 1 },
          { producto_id: number(product.id), cantidad: 1 },
        ],
        notes: "Apartado interno",
      });

      const order = expectStatus(await request(), 201, "crear pedido reservado");
      assert.equal(order.estado, "RESERVADO");
      assert.equal(order.canal, "INTERNO");
      assert.equal(order.canal_precio, "POS");
      assert.equal(number(order.cliente_id), number(activeCustomer.id));
      assert.equal(order.cliente_nombre, activeCustomer.nombre);
      assert.equal(order.detalle.length, 1);
      assert.equal(number(order.detalle[0].cantidad), 2);
      assert.equal(number(order.detalle[0].precio_lista), 100);
      assert.equal(number(order.detalle[0].precio_unitario), 100);
      assert.equal(number(order.detalle[0].importe), 200);
      assert.equal(order.detalle[0].reserva_estado, "ACTIVA");
      assert.equal(number(order.total), 200);
      assert.equal(order.transiciones.length, 1);
      assert.equal(order.transiciones[0].estado_nuevo, "RESERVADO");

      const replay = expectStatus(await request(), 200, "replay del pedido");
      assert.equal(number(replay.id), number(order.id));
      expectStatus(await createOrder(baseUrl, cashier.token, {
        key,
        customerId: activeCustomer.id,
        items: [{ producto_id: number(product.id), cantidad: 3 }],
      }), 409, "misma clave con otra solicitud");

      assert.deepEqual(await productBalance(pool, product.id), {
        stock: 5,
        stock_reservado: 2,
        stock_disponible: 3,
      });
      const reservations = await pool.query(
        `SELECT * FROM reservas_stock WHERE pedido_id=$1`,
        [order.id]
      );
      assert.equal(reservations.rowCount, 1);
      assert.equal(number(reservations.rows[0].cantidad), 2);
      const ledger = await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE pedido_id=$1 AND tipo='RESERVA'`,
        [order.id]
      );
      assert.equal(ledger.rowCount, 1);
      assert.equal(number(ledger.rows[0].delta_fisico), 0);
      assert.equal(number(ledger.rows[0].delta_reservado), 2);
      assert.equal(number(ledger.rows[0].usuario_id), number(cashier.id));
      const idempotency = (await pool.query(
        `SELECT actor_clave FROM operaciones_idempotentes
         WHERE operacion='PEDIDO_INTERNO' AND recurso_id=$1`,
        [order.id]
      )).rows[0];
      assert.equal(idempotency.actor_clave, `USUARIO:${cashier.id}`);
    });

    await t.test("revierte todo el pedido si una línea no tiene disponibilidad", async () => {
      const enough = await createProduct(baseUrl, supervisor.token, { stock: 3 });
      const empty = await createProduct(baseUrl, supervisor.token, { stock: 0 });
      const before = number((await pool.query(`SELECT COUNT(*) AS n FROM pedidos`)).rows[0].n);
      expectStatus(await createOrder(baseUrl, cashier.token, {
        customer: contact("Rollback"),
        delivery: "ENVIO",
        items: [
          { producto_id: number(enough.id), cantidad: 2 },
          { producto_id: number(empty.id), cantidad: 1 },
        ],
      }), 409, "pedido sin stock en una línea");
      const after = number((await pool.query(`SELECT COUNT(*) AS n FROM pedidos`)).rows[0].n);
      assert.equal(after, before);
      assert.equal(number((await productBalance(pool, enough.id)).stock_reservado), 0);
      assert.equal(number((await productBalance(pool, empty.id)).stock_reservado), 0);
      const movements = await pool.query(
        `SELECT id FROM inventario_movimientos
         WHERE producto_id=ANY($1::int[]) AND tipo='RESERVA'`,
        [[enough.id, empty.id]]
      );
      assert.equal(movements.rowCount, 0);
    });

    await t.test("serializa dos pedidos concurrentes por la última unidad", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 1 });
      const makeRequest = (label) => createOrder(baseUrl, cashier.token, {
        key: randomUUID(),
        customer: contact(label),
        items: [{ producto_id: number(product.id), cantidad: 1 }],
      });
      const responses = await Promise.all([
        makeRequest("Concurrente A"),
        makeRequest("Concurrente B"),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.deepEqual(await productBalance(pool, product.id), {
        stock: 1,
        stock_reservado: 1,
        stock_disponible: 0,
      });
      const active = await pool.query(
        `SELECT r.id
         FROM reservas_stock r
         WHERE r.producto_id=$1 AND r.estado='ACTIVA'`,
        [product.id]
      );
      assert.equal(active.rowCount, 1);
    });

    await t.test("marca listo y cancela liberando exactamente una vez", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 4 });
      const order = expectStatus(await createOrder(baseUrl, cashier.token, {
        customer: contact("Cancelar"),
        items: [{ producto_id: number(product.id), cantidad: 2 }],
      }), 201, "pedido para cancelar");

      expectStatus(await apiRequest(baseUrl, `/pedidos/${order.id}/listo`, {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: {},
      }), 403, "cajero intenta marcar listo");
      const readyKey = randomUUID();
      const readyRequest = () => apiRequest(baseUrl, `/pedidos/${order.id}/listo`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: readyKey,
        body: {},
      });
      const ready = expectStatus(await readyRequest(), 201, "marcar listo");
      assert.equal(ready.estado, "LISTO");
      assert.equal(expectStatus(await readyRequest(), 200, "replay listo").estado, "LISTO");
      assert.equal(number((await productBalance(pool, product.id)).stock_reservado), 2);

      expectStatus(await apiRequest(baseUrl, `/pedidos/${order.id}/cancelacion`, {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { motivo: "Sin permiso" },
      }), 403, "cajero intenta cancelar pedido");
      const cancelKey = randomUUID();
      const cancelRequest = () => apiRequest(baseUrl, `/pedidos/${order.id}/cancelacion`, {
        method: "POST",
        token: admin.token,
        idempotencyKey: cancelKey,
        body: { motivo: "Cliente desistió de la compra" },
      });
      const cancelled = expectStatus(await cancelRequest(), 201, "cancelar pedido");
      assert.equal(cancelled.estado, "CANCELADO");
      assert.equal(
        expectStatus(await cancelRequest(), 200, "replay cancelación").estado,
        "CANCELADO"
      );
      assert.deepEqual(await productBalance(pool, product.id), {
        stock: 4,
        stock_reservado: 0,
        stock_disponible: 4,
      });
      const finalLedger = await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE pedido_id=$1
           AND tipo IN ('LIBERACION_RESERVA','EXPIRACION_RESERVA','CONSUMO_RESERVA')`,
        [order.id]
      );
      assert.equal(finalLedger.rowCount, 1);
      assert.equal(finalLedger.rows[0].tipo, "LIBERACION_RESERVA");
      assert.equal(number(finalLedger.rows[0].delta_fisico), 0);
      assert.equal(number(finalLedger.rows[0].delta_reservado), -2);
      const states = cancelled.transiciones.map((transition) => transition.estado_nuevo);
      assert.deepEqual(states, ["RESERVADO", "LISTO", "CANCELADO"]);
    });

    await t.test("expira reservas y resuelve la carrera con cancelación sin duplicar", async () => {
      const product = await createProduct(baseUrl, supervisor.token, { stock: 4 });
      const expiring = expectStatus(await createOrder(baseUrl, cashier.token, {
        customer: contact("Expirar"),
        items: [{ producto_id: number(product.id), cantidad: 1 }],
      }), 201, "pedido para expirar");
      const expiryCutoff = new Date(new Date(expiring.expira_en).getTime() + 1000);

      expectStatus(await apiRequest(baseUrl, "/pedidos/expiraciones/procesar", {
        method: "POST",
        token: cashier.token,
        body: { limite: 100 },
      }), 403, "cajero intenta procesar expiraciones");
      const expired = await runTransaction(pool, (client) =>
        expirarPedidosVencidos(client, { limit: 100, hasta: expiryCutoff })
      );
      assert.ok(expired.includes(number(expiring.id)));
      const expiredOrder = expectStatus(await apiRequest(
        baseUrl, `/pedidos/${expiring.id}`, { token: cashier.token }
      ), 200, "leer pedido expirado");
      assert.equal(expiredOrder.estado, "EXPIRADO");
      assert.equal(expiredOrder.detalle[0].reserva_estado, "EXPIRADA");
      const repeated = expectStatus(await apiRequest(
        baseUrl, "/pedidos/expiraciones/procesar", {
          method: "POST",
          token: admin.token,
          body: { limite: 100 },
        }
      ), 200, "repetir expirador");
      assert.equal(repeated.procesados, 0);

      const racing = expectStatus(await createOrder(baseUrl, cashier.token, {
        customer: contact("Carrera"),
        items: [{ producto_id: number(product.id), cantidad: 2 }],
      }), 201, "pedido para carrera cancelación-expiración");
      const raceCutoff = new Date(new Date(racing.expira_en).getTime() + 1000);
      const [cancelResponse, expiredByRace] = await Promise.all([
        apiRequest(baseUrl, `/pedidos/${racing.id}/cancelacion`, {
          method: "POST",
          token: supervisor.token,
          idempotencyKey: randomUUID(),
          body: { motivo: "Carrera de finalización" },
        }),
        runTransaction(pool, (client) =>
          expirarPedidosVencidos(client, { limit: 100, hasta: raceCutoff })
        ),
      ]);
      assert.ok([201, 409].includes(cancelResponse.status), JSON.stringify(cancelResponse.body));
      assert.ok(Array.isArray(expiredByRace));

      const terminal = expectStatus(await apiRequest(
        baseUrl, `/pedidos/${racing.id}`, { token: cashier.token }
      ), 200, "pedido después de carrera");
      assert.ok(["CANCELADO", "EXPIRADO"].includes(terminal.estado));
      assert.ok(["LIBERADA", "EXPIRADA"].includes(terminal.detalle[0].reserva_estado));
      const finals = await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE pedido_id=$1
           AND tipo IN ('LIBERACION_RESERVA','EXPIRACION_RESERVA','CONSUMO_RESERVA')`,
        [racing.id]
      );
      assert.equal(finals.rowCount, 1);
      assert.equal(number(finals.rows[0].delta_reservado), -2);
      assert.equal(number((await productBalance(pool, product.id)).stock_reservado), 0);

      const reconciliation = await pool.query(
        `SELECT producto_id, conciliado FROM inventario_conciliacion
         WHERE producto_id=$1`,
        [product.id]
      );
      assert.equal(reconciliation.rows[0].conciliado, true);
    });
  } finally {
    await environment.cleanup();
  }
});
