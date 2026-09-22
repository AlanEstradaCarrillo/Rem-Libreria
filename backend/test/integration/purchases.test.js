const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "ComprasSeguras!2026";
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
    [label, `${label}@purchases.tests`, passwordHash, role]
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

async function createProduct(baseUrl, token, {
  stock = 0,
  cost = 20,
  price = 100,
  iva = 0,
} = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `CMP-${suffix}`,
      titulo: `Libro compra ${suffix}`,
      precio: price,
      costo: cost,
      stock,
      iva,
    },
  }), 201, "crear producto para compras");
}

async function createProvider(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return apiRequest(baseUrl, "/proveedores", {
    method: "POST",
    token,
    body: {
      nombre: `Editorial proveedora ${suffix}`,
      razon_social: `Editorial proveedora ${suffix}, S.A. de C.V.`,
      rfc: `REM${String(suffix).padStart(9, "0")}`,
      contacto: `Contacto ${suffix}`,
      telefono: `555200${String(suffix).padStart(4, "0")}`,
      email: `proveedor-${suffix}@purchases.tests`,
      direccion: `Calle editorial ${suffix}`,
      ...overrides,
    },
  });
}

function orderRequest(baseUrl, token, providerId, items, {
  key = randomUUID(),
  reference = null,
  notes = null,
} = {}) {
  const body = { proveedor_id: number(providerId), items };
  if (reference != null) body.referencia = reference;
  if (notes != null) body.notas = notes;
  return apiRequest(baseUrl, "/compras/ordenes", {
    method: "POST",
    token,
    idempotencyKey: key,
    body,
  });
}

function receiptRequest(baseUrl, token, orderId, items, {
  key = randomUUID(),
  reference = null,
  notes = null,
} = {}) {
  const body = { items };
  if (reference != null) body.referencia = reference;
  if (notes != null) body.notas = notes;
  return apiRequest(baseUrl, `/compras/ordenes/${orderId}/recepciones`, {
    method: "POST",
    token,
    idempotencyKey: key,
    body,
  });
}

function returnRequest(baseUrl, token, orderId, items, {
  key = randomUUID(),
  reason = "Devolución confirmada al proveedor",
  reference = null,
  notes = null,
} = {}) {
  const body = { motivo: reason, items };
  if (reference != null) body.referencia = reference;
  if (notes != null) body.notas = notes;
  return apiRequest(baseUrl, `/compras/ordenes/${orderId}/devoluciones`, {
    method: "POST",
    token,
    idempotencyKey: key,
    body,
  });
}

async function productBalance(pool, productId) {
  return (await pool.query(
    `SELECT stock, stock_reservado, stock_disponible, costo
     FROM productos WHERE id=$1`,
    [productId]
  )).rows[0];
}

function reservedOrderRequest(baseUrl, token, productId, quantity) {
  const suffix = ++sequence;
  return apiRequest(baseUrl, "/pedidos", {
    method: "POST",
    token,
    idempotencyKey: randomUUID(),
    body: {
      cliente: {
        nombre: `Cliente reserva ${suffix}`,
        telefono: `555300${String(suffix).padStart(4, "0")}`,
        email: `reserva-${suffix}@purchases.tests`,
        direccion: `Calle reserva ${suffix}`,
      },
      tipo_entrega: "RECOLECCION",
      items: [{ producto_id: number(productId), cantidad: quantity }],
    },
  });
}

async function createReservedOrder(baseUrl, token, productId, quantity) {
  return expectStatus(
    await reservedOrderRequest(baseUrl, token, productId, quantity),
    201,
    "crear reserva para proteger existencia"
  );
}

test("proveedores, órdenes, recepciones y devoluciones", { timeout: 240000 }, async (t) => {
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

    let provider;
    await t.test("aplica CRUD, baja lógica y RBAC a proveedores", async () => {
      expectStatus(await createProvider(baseUrl, cashier.token), 403, "alta de proveedor por cajero");
      expectStatus(await apiRequest(baseUrl, "/proveedores", {
        token: cashier.token,
      }), 403, "listado de proveedores por cajero");

      provider = expectStatus(
        await createProvider(baseUrl, supervisor.token),
        201,
        "alta de proveedor"
      );
      assert.equal(provider.activo, true);
      assert.equal(number(provider.creado_por_usuario_id), number(supervisor.id));

      const listed = expectStatus(await apiRequest(
        baseUrl,
        `/proveedores?q=${encodeURIComponent(provider.nombre)}&page=1&limit=10`,
        { token: admin.token }
      ), 200, "buscar proveedor");
      assert.equal(listed.resultados.length, 1);
      assert.equal(number(listed.resultados[0].id), number(provider.id));

      const patched = expectStatus(await apiRequest(baseUrl, `/proveedores/${provider.id}`, {
        method: "PATCH",
        token: admin.token,
        body: { contacto: "Nueva persona de contacto" },
      }), 200, "actualizar proveedor");
      assert.equal(patched.contacto, "Nueva persona de contacto");

      const inactive = expectStatus(
        await createProvider(baseUrl, admin.token, { nombre: `Proveedor inactivo ${++sequence}` }),
        201,
        "crear proveedor para baja"
      );
      expectStatus(await apiRequest(baseUrl, `/proveedores/${inactive.id}`, {
        method: "DELETE",
        token: supervisor.token,
      }), 200, "baja lógica de proveedor");
      const inactiveList = expectStatus(await apiRequest(
        baseUrl,
        "/proveedores?incluir_inactivos=true&limit=100",
        { token: admin.token }
      ), 200, "listar inactivos");
      assert.ok(inactiveList.resultados.some((item) => (
        number(item.id) === number(inactive.id) && item.activo === false
      )));

      const product = await createProduct(baseUrl, admin.token);
      expectStatus(await orderRequest(baseUrl, admin.token, inactive.id, [{
        producto_id: number(product.id), cantidad: 1, costo_unitario: 10,
      }]), 409, "orden para proveedor inactivo");
    });

    let primaryOrder;
    let firstReceipt;
    let productA;
    let productB;
    await t.test("crea una orden inmutable e idempotente sin mover inventario", async () => {
      productA = await createProduct(baseUrl, admin.token, { stock: 2, cost: 20, iva: 0 });
      productB = await createProduct(baseUrl, admin.token, { stock: 1, cost: 30, iva: 16 });
      const items = [
        {
          producto_id: number(productA.id),
          cantidad: 3,
          costo_unitario: 40,
          iva_porcentaje: 0,
        },
        {
          producto_id: number(productB.id),
          cantidad: 2,
          costo_unitario: 50,
          iva_porcentaje: 16,
        },
      ];
      expectStatus(await orderRequest(baseUrl, cashier.token, provider.id, items),
        403, "orden por cajero");

      const key = randomUUID();
      const requests = await Promise.all([
        orderRequest(baseUrl, supervisor.token, provider.id, items, {
          key,
          reference: "SOLICITUD EDITORIAL 100",
        }),
        orderRequest(baseUrl, supervisor.token, provider.id, [...items].reverse(), {
          key,
          reference: "SOLICITUD EDITORIAL 100",
        }),
      ]);
      assert.deepEqual(requests.map((response) => response.status).sort(), [200, 201]);
      assert.equal(number(requests[0].body.id), number(requests[1].body.id));
      primaryOrder = requests.find((response) => response.status === 201).body;
      assert.equal(primaryOrder.estado, "EMITIDA");
      assert.equal(number(primaryOrder.subtotal), 220);
      assert.equal(number(primaryOrder.iva), 16);
      assert.equal(number(primaryOrder.total), 236);
      assert.deepEqual(primaryOrder.transiciones.map((row) => row.estado_nuevo), ["EMITIDA"]);
      assert.equal(primaryOrder.detalle.length, 2);
      assert.deepEqual(await productBalance(pool, productA.id), {
        stock: 2,
        stock_reservado: 0,
        stock_disponible: 2,
        costo: "20.00",
      });
      const purchaseMovements = await pool.query(
        `SELECT id FROM inventario_movimientos
         WHERE producto_id=ANY($1::int[])
           AND tipo IN ('RECEPCION_COMPRA','DEVOLUCION_PROVEEDOR')`,
        [[productA.id, productB.id]]
      );
      assert.equal(purchaseMovements.rowCount, 0);

      expectStatus(await orderRequest(baseUrl, supervisor.token, provider.id, [{
        ...items[0], cantidad: 4,
      }], { key, reference: "SOLICITUD EDITORIAL 100" }),
      409, "misma clave con orden distinta");
      const count = await pool.query(
        `SELECT COUNT(*)::int AS n FROM ordenes_compra WHERE proveedor_id=$1`,
        [provider.id]
      );
      assert.equal(count.rows[0].n, 1);

      const list = expectStatus(await apiRequest(
        baseUrl,
        `/compras/ordenes?estado=EMITIDA&proveedor_id=${provider.id}&q=${primaryOrder.folio}`,
        { token: admin.token }
      ), 200, "listar órdenes");
      assert.equal(list.resultados.length, 1);
      assert.equal(number(list.resultados[0].unidades_pendientes), 5);
    });

    await t.test("recibe parcial y totalmente con último costo, rollback y kardex exacto", async () => {
      const detailA = primaryOrder.detalle.find((line) => (
        number(line.producto_id) === number(productA.id)
      ));
      const detailB = primaryOrder.detalle.find((line) => (
        number(line.producto_id) === number(productB.id)
      ));
      const items = [
        { detalle_orden_compra_id: number(detailA.id), cantidad: 2, costo_unitario: 42 },
        { detalle_orden_compra_id: number(detailB.id), cantidad: 2, costo_unitario: 55 },
      ];
      expectStatus(await receiptRequest(baseUrl, cashier.token, primaryOrder.id, items),
        403, "recepción por cajero");

      const key = randomUUID();
      const responses = await Promise.all([
        receiptRequest(baseUrl, supervisor.token, primaryOrder.id, items, {
          key,
          reference: "REMISIÓN PARCIAL 1",
        }),
        receiptRequest(baseUrl, supervisor.token, primaryOrder.id, [...items].reverse(), {
          key,
          reference: "REMISIÓN PARCIAL 1",
        }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      const created = responses.find((response) => response.status === 201).body;
      firstReceipt = created.recepcion;
      primaryOrder = created.orden;
      assert.equal(primaryOrder.estado, "PARCIAL");
      assert.equal(firstReceipt.referencia, "REMISIÓN PARCIAL 1");
      assert.equal(firstReceipt.detalle.length, 2);
      assert.deepEqual(await productBalance(pool, productA.id), {
        stock: 4,
        stock_reservado: 0,
        stock_disponible: 4,
        costo: "42.00",
      });
      assert.deepEqual(await productBalance(pool, productB.id), {
        stock: 3,
        stock_reservado: 0,
        stock_disponible: 3,
        costo: "55.00",
      });
      const movements = await pool.query(
        `SELECT im.*, dr.cantidad
         FROM inventario_movimientos im
         JOIN detalle_recepciones_compra dr ON dr.id=im.detalle_recepcion_compra_id
         WHERE im.recepcion_compra_id=$1
         ORDER BY im.producto_id`,
        [firstReceipt.id]
      );
      assert.equal(movements.rowCount, 2);
      for (const movement of movements.rows) {
        assert.equal(movement.tipo, "RECEPCION_COMPRA");
        assert.equal(number(movement.delta_fisico), number(movement.cantidad));
        assert.equal(number(movement.usuario_id), number(supervisor.id));
      }

      const before = number((await pool.query(
        `SELECT COUNT(*) AS n FROM recepciones_compra WHERE orden_compra_id=$1`,
        [primaryOrder.id]
      )).rows[0].n);
      expectStatus(await receiptRequest(baseUrl, admin.token, primaryOrder.id, [{
        detalle_orden_compra_id: number(detailA.id), cantidad: 2,
      }]), 409, "sobrerrecepción");
      const after = number((await pool.query(
        `SELECT COUNT(*) AS n FROM recepciones_compra WHERE orden_compra_id=$1`,
        [primaryOrder.id]
      )).rows[0].n);
      assert.equal(after, before);

      const completed = expectStatus(await receiptRequest(
        baseUrl,
        admin.token,
        primaryOrder.id,
        [{ detalle_orden_compra_id: number(detailA.id), cantidad: 1, costo_unitario: 43 }],
        { reference: "REMISIÓN FINAL 2" }
      ), 201, "completar orden");
      primaryOrder = completed.orden;
      assert.equal(primaryOrder.estado, "RECIBIDA");
      assert.deepEqual(primaryOrder.transiciones.map((row) => row.estado_nuevo), [
        "EMITIDA", "PARCIAL", "RECIBIDA",
      ]);
      assert.equal(number((await productBalance(pool, productA.id)).costo), 43);
      expectStatus(await apiRequest(
        baseUrl,
        `/compras/ordenes/${primaryOrder.id}/cancelacion`,
        {
          method: "POST",
          token: admin.token,
          idempotencyKey: randomUUID(),
          body: { motivo: "No debe cancelar una orden completa" },
        }
      ), 409, "cancelar orden recibida");
    });

    let firstReturn;
    await t.test("devuelve por línea recibida sin duplicar ni alterar el último costo", async () => {
      const receivedA = firstReceipt.detalle.find((line) => (
        number(line.producto_id) === number(productA.id)
      ));
      const item = [{ detalle_recepcion_compra_id: number(receivedA.id), cantidad: 1 }];
      expectStatus(await returnRequest(baseUrl, cashier.token, primaryOrder.id, item),
        403, "devolución por cajero");

      const key = randomUUID();
      const responses = await Promise.all([
        returnRequest(baseUrl, supervisor.token, primaryOrder.id, item, {
          key,
          reference: "RETORNO EDITORIAL 1",
        }),
        returnRequest(baseUrl, supervisor.token, primaryOrder.id, item, {
          key,
          reference: "RETORNO EDITORIAL 1",
        }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      const created = responses.find((response) => response.status === 201).body;
      firstReturn = created.devolucion;
      assert.equal(firstReturn.referencia, "RETORNO EDITORIAL 1");
      assert.equal(number(firstReturn.detalle[0].detalle_recepcion_compra_id), number(receivedA.id));
      assert.equal(number((await productBalance(pool, productA.id)).costo), 43);

      const movement = (await pool.query(
        `SELECT * FROM inventario_movimientos
         WHERE devolucion_proveedor_id=$1`,
        [firstReturn.id]
      )).rows;
      assert.equal(movement.length, 1);
      assert.equal(movement[0].tipo, "DEVOLUCION_PROVEEDOR");
      assert.equal(number(movement[0].delta_fisico), -1);

      expectStatus(await returnRequest(baseUrl, supervisor.token, primaryOrder.id, [{
        detalle_recepcion_compra_id: number(receivedA.id), cantidad: 2,
      }]), 409, "devolución superior a lo disponible");
      const afterFailure = await productBalance(pool, productA.id);
      assert.equal(number(afterFailure.stock), 4);
      assert.equal(number(afterFailure.costo), 43);
    });

    await t.test("cancela el remanente parcial sin revertir lo recibido", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 0, cost: 10 });
      let order = expectStatus(await orderRequest(baseUrl, admin.token, provider.id, [{
        producto_id: number(product.id), cantidad: 3, costo_unitario: 15,
      }]), 201, "crear orden cancelable");
      const detail = order.detalle[0];
      const received = expectStatus(await receiptRequest(baseUrl, admin.token, order.id, [{
        detalle_orden_compra_id: number(detail.id), cantidad: 1,
      }]), 201, "recibir parcialmente antes de cancelar");
      order = received.orden;
      assert.equal(order.estado, "PARCIAL");

      const key = randomUUID();
      const cancel = () => apiRequest(baseUrl, `/compras/ordenes/${order.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: key,
        body: { motivo: "Proveedor no surtirá el remanente" },
      });
      const cancelled = expectStatus(await cancel(), 201, "cancelar orden parcial");
      assert.equal(cancelled.estado, "CANCELADA");
      assert.equal(number(cancelled.detalle[0].cantidad_recibida), 1);
      assert.equal(number(cancelled.detalle[0].cantidad_pendiente), 0);
      assert.equal(number(cancelled.detalle[0].cantidad_cancelada), 2);
      assert.equal(expectStatus(await cancel(), 200, "replay cancelación").estado, "CANCELADA");
      assert.equal(number((await productBalance(pool, product.id)).stock), 1);
      expectStatus(await receiptRequest(baseUrl, admin.token, order.id, [{
        detalle_orden_compra_id: number(detail.id), cantidad: 1,
      }]), 409, "recibir después de cancelar");
    });

    await t.test("protege reservas omnicanal frente a devolución al proveedor", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 0, cost: 8 });
      const order = expectStatus(await orderRequest(baseUrl, admin.token, provider.id, [{
        producto_id: number(product.id), cantidad: 2, costo_unitario: 12,
      }]), 201, "crear orden para reserva");
      const received = expectStatus(await receiptRequest(baseUrl, admin.token, order.id, [{
        detalle_orden_compra_id: number(order.detalle[0].id), cantidad: 2,
      }]), 201, "recibir existencia para reserva");
      await createReservedOrder(baseUrl, cashier.token, product.id, 2);
      assert.deepEqual(await productBalance(pool, product.id), {
        stock: 2,
        stock_reservado: 2,
        stock_disponible: 0,
        costo: "12.00",
      });
      const before = number((await pool.query(
        `SELECT COUNT(*) AS n FROM devoluciones_proveedor WHERE orden_compra_id=$1`,
        [order.id]
      )).rows[0].n);
      expectStatus(await returnRequest(baseUrl, supervisor.token, order.id, [{
        detalle_recepcion_compra_id: number(received.recepcion.detalle[0].id),
        cantidad: 1,
      }]), 409, "devolución que afectaría reserva");
      const after = number((await pool.query(
        `SELECT COUNT(*) AS n FROM devoluciones_proveedor WHERE orden_compra_id=$1`,
        [order.id]
      )).rows[0].n);
      assert.equal(after, before);
      assert.equal(number((await productBalance(pool, product.id)).stock), 2);
    });

    await t.test("serializa recepciones y devoluciones concurrentes", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 0, cost: 5 });
      const order = expectStatus(await orderRequest(baseUrl, admin.token, provider.id, [{
        producto_id: number(product.id), cantidad: 1, costo_unitario: 7,
      }]), 201, "crear orden concurrente");
      const detailId = number(order.detalle[0].id);
      const receive = (label) => receiptRequest(baseUrl, supervisor.token, order.id, [{
        detalle_orden_compra_id: detailId,
        cantidad: 1,
      }], { key: randomUUID(), reference: `CONCURRENTE ${label}` });
      const receiptRace = await Promise.all([receive("A"), receive("B")]);
      assert.deepEqual(receiptRace.map((response) => response.status).sort(), [201, 409]);
      const winner = receiptRace.find((response) => response.status === 201).body;
      assert.equal(winner.orden.estado, "RECIBIDA");
      assert.equal(winner.orden.recepciones.length, 1);
      assert.equal(number((await productBalance(pool, product.id)).stock), 1);

      const receiptDetailId = number(winner.recepcion.detalle[0].id);
      const giveBack = () => returnRequest(baseUrl, supervisor.token, order.id, [{
        detalle_recepcion_compra_id: receiptDetailId,
        cantidad: 1,
      }], { key: randomUUID() });
      const returnRace = await Promise.all([giveBack(), giveBack()]);
      assert.deepEqual(returnRace.map((response) => response.status).sort(), [201, 409]);
      assert.equal(number((await productBalance(pool, product.id)).stock), 0);
      const finalMovements = await pool.query(
        `SELECT tipo, COUNT(*)::int AS n
         FROM inventario_movimientos
         WHERE producto_id=$1
           AND tipo IN ('RECEPCION_COMPRA','DEVOLUCION_PROVEEDOR')
         GROUP BY tipo ORDER BY tipo`,
        [product.id]
      );
      assert.deepEqual(finalMovements.rows, [
        { tipo: "DEVOLUCION_PROVEEDOR", n: 1 },
        { tipo: "RECEPCION_COMPRA", n: 1 },
      ]);
    });

    await t.test("serializa recepción contra cancelación de la misma orden", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 0, cost: 9 });
      const order = expectStatus(await orderRequest(baseUrl, admin.token, provider.id, [{
        producto_id: number(product.id), cantidad: 1, costo_unitario: 11,
      }]), 201, "crear orden para carrera recepción-cancelación");
      const [receiptResponse, cancellationResponse] = await Promise.all([
        receiptRequest(baseUrl, supervisor.token, order.id, [{
          detalle_orden_compra_id: number(order.detalle[0].id),
          cantidad: 1,
        }], { key: randomUUID(), reference: "CARRERA RECEPCIÓN" }),
        apiRequest(baseUrl, `/compras/ordenes/${order.id}/cancelacion`, {
          method: "POST",
          token: admin.token,
          idempotencyKey: randomUUID(),
          body: { motivo: "Carrera entre recepción y cancelación" },
        }),
      ]);
      assert.deepEqual(
        [receiptResponse.status, cancellationResponse.status].sort(),
        [201, 409]
      );

      const finalOrder = expectStatus(await apiRequest(
        baseUrl,
        `/compras/ordenes/${order.id}`,
        { token: supervisor.token }
      ), 200, "orden después de carrera recepción-cancelación");
      assert.ok(["RECIBIDA", "CANCELADA"].includes(finalOrder.estado));
      const balance = await productBalance(pool, product.id);
      const receipts = await pool.query(
        `SELECT id FROM recepciones_compra WHERE orden_compra_id=$1`,
        [order.id]
      );
      const movements = await pool.query(
        `SELECT id, delta_fisico FROM inventario_movimientos
         WHERE producto_id=$1 AND tipo='RECEPCION_COMPRA'`,
        [product.id]
      );
      if (finalOrder.estado === "RECIBIDA") {
        assert.equal(receiptResponse.status, 201);
        assert.equal(cancellationResponse.status, 409);
        assert.equal(number(balance.stock), 1);
        assert.equal(receipts.rowCount, 1);
        assert.equal(movements.rowCount, 1);
        assert.equal(number(movements.rows[0].delta_fisico), 1);
      } else {
        assert.equal(receiptResponse.status, 409);
        assert.equal(cancellationResponse.status, 201);
        assert.equal(number(balance.stock), 0);
        assert.equal(receipts.rowCount, 0);
        assert.equal(movements.rowCount, 0);
      }
      await pool.query(`SELECT validar_orden_compra_conciliada($1)`, [order.id]);
      const reconciliation = (await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(reconciliation.conciliado, true);
    });

    await t.test("serializa devolución contra reserva de las últimas unidades", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 0, cost: 6 });
      const order = expectStatus(await orderRequest(baseUrl, admin.token, provider.id, [{
        producto_id: number(product.id), cantidad: 1, costo_unitario: 10,
      }]), 201, "crear orden para carrera devolución-reserva");
      const received = expectStatus(await receiptRequest(baseUrl, admin.token, order.id, [{
        detalle_orden_compra_id: number(order.detalle[0].id),
        cantidad: 1,
      }]), 201, "recibir última unidad para carrera");
      const receiptDetailId = number(received.recepcion.detalle[0].id);

      const [returnResponse, reservationResponse] = await Promise.all([
        returnRequest(baseUrl, supervisor.token, order.id, [{
          detalle_recepcion_compra_id: receiptDetailId,
          cantidad: 1,
        }], { key: randomUUID(), reason: "Carrera con reserva de cliente" }),
        reservedOrderRequest(baseUrl, cashier.token, product.id, 1),
      ]);
      assert.deepEqual(
        [returnResponse.status, reservationResponse.status].sort(),
        [201, 409]
      );

      const balance = await productBalance(pool, product.id);
      const returnMovements = await pool.query(
        `SELECT id, delta_fisico FROM inventario_movimientos
         WHERE producto_id=$1 AND tipo='DEVOLUCION_PROVEEDOR'`,
        [product.id]
      );
      const activeReservations = await pool.query(
        `SELECT id, cantidad FROM reservas_stock
         WHERE producto_id=$1 AND estado='ACTIVA'`,
        [product.id]
      );
      if (returnResponse.status === 201) {
        assert.equal(reservationResponse.status, 409);
        assert.deepEqual(balance, {
          stock: 0,
          stock_reservado: 0,
          stock_disponible: 0,
          costo: "10.00",
        });
        assert.equal(returnMovements.rowCount, 1);
        assert.equal(number(returnMovements.rows[0].delta_fisico), -1);
        assert.equal(activeReservations.rowCount, 0);
        await pool.query(
          `SELECT validar_devolucion_proveedor_conciliada($1)`,
          [returnResponse.body.devolucion.id]
        );
      } else {
        assert.equal(returnResponse.status, 409);
        assert.equal(reservationResponse.status, 201);
        assert.deepEqual(balance, {
          stock: 1,
          stock_reservado: 1,
          stock_disponible: 0,
          costo: "10.00",
        });
        assert.equal(returnMovements.rowCount, 0);
        assert.equal(activeReservations.rowCount, 1);
        assert.equal(number(activeReservations.rows[0].cantidad), 1);
      }
      assert.ok(number(balance.stock_reservado) <= number(balance.stock));
      await pool.query(`SELECT validar_orden_compra_conciliada($1)`, [order.id]);
      await pool.query(
        `SELECT validar_recepcion_compra_conciliada($1)`,
        [received.recepcion.id]
      );
      const reconciliation = (await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(reconciliation.conciliado, true);
    });

    await t.test("conserva documentos y kardex inmutables y conciliados", async () => {
      await assert.rejects(
        pool.query(
          `UPDATE detalle_ordenes_compra SET cantidad=cantidad WHERE id=$1`,
          [primaryOrder.detalle[0].id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(`DELETE FROM recepciones_compra WHERE id=$1`, [firstReceipt.id]),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(`DELETE FROM devoluciones_proveedor WHERE id=$1`, [firstReturn.id]),
        (error) => error.code === "55000"
      );
      const movement = (await pool.query(
        `SELECT id FROM inventario_movimientos
         WHERE devolucion_proveedor_id=$1 LIMIT 1`,
        [firstReturn.id]
      )).rows[0];
      await assert.rejects(
        pool.query(`DELETE FROM inventario_movimientos WHERE id=$1`, [movement.id]),
        (error) => error.code === "55000"
      );

      await pool.query(`SELECT validar_orden_compra_conciliada($1)`, [primaryOrder.id]);
      await pool.query(`SELECT validar_recepcion_compra_conciliada($1)`, [firstReceipt.id]);
      await pool.query(`SELECT validar_devolucion_proveedor_conciliada($1)`, [firstReturn.id]);
      const reconciliation = await pool.query(
        `SELECT producto_id, conciliado
         FROM inventario_conciliacion
         WHERE producto_id=ANY($1::int[])`,
        [[productA.id, productB.id]]
      );
      assert.equal(reconciliation.rowCount, 2);
      assert.ok(reconciliation.rows.every((row) => row.conciliado === true));
    });
  } finally {
    await environment.cleanup();
  }
});
