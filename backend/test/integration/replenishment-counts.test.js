const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "ConteosSeguros!2026";
let sequence = 0;

const number = (value) => Number(value);

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
    await pool.query(`INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`, [role]);
  }
}

async function createUser(pool, role) {
  const suffix = ++sequence;
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [`${role} conteos ${suffix}`, `${role.toLowerCase()}-${suffix}@counts.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.role}`);
  return body.token;
}

async function createProduct(baseUrl, token, { stock = 0, cost = 20 } = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `CNT-${suffix}`,
      titulo: `Libro para conteo ${suffix}`,
      precio: 100,
      costo: cost,
      stock,
      iva: 0,
    },
  }), 201, "crear producto");
}

async function createProvider(baseUrl, token) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/proveedores", {
    method: "POST",
    token,
    body: { nombre: `Proveedor reposición ${suffix}` },
  }), 201, "crear proveedor");
}

function savePolicy(baseUrl, token, productId, providerId, key = randomUUID()) {
  return apiRequest(baseUrl, `/inventario/reposicion/productos/${productId}`, {
    method: "PUT",
    token,
    idempotencyKey: key,
    body: {
      stock_minimo: 5,
      stock_objetivo: 10,
      proveedor_preferido_id: providerId == null ? null : number(providerId),
      motivo: "Parámetros iniciales de reposición",
    },
  });
}

function createCount(baseUrl, token, productIds, key = randomUUID()) {
  return apiRequest(baseUrl, "/inventario/conteos", {
    method: "POST",
    token,
    idempotencyKey: key,
    body: { producto_ids: productIds.map(number), notas: "Conteo de control" },
  });
}

function captureCount(baseUrl, token, count, quantities, key = randomUUID()) {
  const items = count.detalles.map((detail) => ({
    detalle_conteo_id: number(detail.id),
    cantidad_contada: quantities.get(number(detail.producto_id)),
  }));
  return apiRequest(baseUrl, `/inventario/conteos/${count.id}/capturas`, {
    method: "PUT",
    token,
    idempotencyKey: key,
    body: { items },
  });
}

function applyCount(baseUrl, token, countId, key = randomUUID()) {
  return apiRequest(baseUrl, `/inventario/conteos/${countId}/aplicacion`, {
    method: "POST",
    token,
    idempotencyKey: key,
    body: { motivo: "Conteo físico revisado y autorizado" },
  });
}

test("reposición y conteos de inventario", { timeout: 240000 }, async (t) => {
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

    await t.test("configura políticas auditadas y aplica permisos", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 2 });
      const provider = await createProvider(baseUrl, admin.token);

      expectStatus(await apiRequest(baseUrl, "/inventario/reposicion/sugerencias", {
        token: cashier.token,
      }), 403, "sugerencias para cajero");
      expectStatus(await createCount(baseUrl, cashier.token, [product.id]), 403, "conteo para cajero");

      const key = randomUUID();
      const created = expectStatus(
        await savePolicy(baseUrl, supervisor.token, product.id, provider.id, key),
        201,
        "guardar política"
      );
      const replay = expectStatus(
        await savePolicy(baseUrl, supervisor.token, product.id, provider.id, key),
        200,
        "replay política"
      );
      assert.equal(number(created.producto_id), number(product.id));
      assert.equal(number(replay.stock_minimo), 5);
      assert.equal(number(replay.stock_objetivo), 10);
      assert.equal(number(replay.proveedor_preferido_id), number(provider.id));

      const history = await pool.query(
        `SELECT * FROM politicas_reposicion_historial WHERE producto_id=$1`,
        [product.id]
      );
      assert.equal(history.rowCount, 1);
      assert.equal(number(history.rows[0].usuario_id), number(supervisor.id));
      await assert.rejects(
        pool.query(`UPDATE politicas_reposicion_historial SET motivo='alterado' WHERE id=$1`, [history.rows[0].id]),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(`UPDATE politicas_reposicion SET stock_objetivo=11 WHERE producto_id=$1`, [product.id]),
        (error) => error.code === "23514"
      );

      const suggestions = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/reposicion/sugerencias?q=${encodeURIComponent(product.sku)}`,
        { token: supervisor.token }
      ), 200, "consultar sugerencia");
      assert.equal(suggestions.sugerencias.length, 1);
      assert.equal(number(suggestions.sugerencias[0].disponible), 2);
      assert.equal(number(suggestions.sugerencias[0].en_transito), 0);
      assert.equal(number(suggestions.sugerencias[0].cantidad_sugerida), 8);
    });

    await t.test("descuenta las órdenes pendientes de la reposición sugerida", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 2, cost: 30 });
      const provider = await createProvider(baseUrl, admin.token);
      expectStatus(await savePolicy(baseUrl, admin.token, product.id, provider.id), 201, "política para tránsito");
      const order = expectStatus(await apiRequest(baseUrl, "/compras/ordenes", {
        method: "POST",
        token: admin.token,
        idempotencyKey: randomUUID(),
        body: {
          proveedor_id: number(provider.id),
          items: [{ producto_id: number(product.id), cantidad: 3, costo_unitario: 30, iva_porcentaje: 0 }],
        },
      }), 201, "orden pendiente");

      const all = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/reposicion/sugerencias?q=${encodeURIComponent(product.sku)}&solo_sugeridos=false`,
        { token: admin.token }
      ), 200, "sugerencia con tránsito");
      assert.equal(all.sugerencias.length, 1);
      assert.equal(number(all.sugerencias[0].en_transito), 3);
      assert.equal(number(all.sugerencias[0].disponible_proyectado), 5);
      assert.equal(number(all.sugerencias[0].cantidad_sugerida), 5);

      expectStatus(await apiRequest(baseUrl, `/compras/ordenes/${order.id}/cancelacion`, {
        method: "POST",
        token: admin.token,
        idempotencyKey: randomUUID(),
        body: { motivo: "La orden se sustituirá por otra" },
      }), 201, "cancelar orden pendiente");
      const afterCancel = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/reposicion/sugerencias?q=${encodeURIComponent(product.sku)}`,
        { token: admin.token }
      ), 200, "sugerencia tras cancelar");
      assert.equal(number(afterCancel.sugerencias[0].en_transito), 0);
      assert.equal(number(afterCancel.sugerencias[0].cantidad_sugerida), 8);
    });

    await t.test("crea, captura y aplica diferencias una sola vez", async () => {
      const productA = await createProduct(baseUrl, admin.token, { stock: 5 });
      const productB = await createProduct(baseUrl, admin.token, { stock: 2 });
      const createKey = randomUUID();
      const created = expectStatus(
        await createCount(baseUrl, supervisor.token, [productB.id, productA.id], createKey),
        201,
        "crear conteo"
      );
      const replayCreate = expectStatus(
        await createCount(baseUrl, supervisor.token, [productB.id, productA.id], createKey),
        200,
        "replay crear conteo"
      );
      assert.equal(number(replayCreate.id), number(created.id));
      assert.equal(created.detalles.length, 2);

      const quantities = new Map([[number(productA.id), 3], [number(productB.id), 4]]);
      const captureKey = randomUUID();
      const captured = expectStatus(
        await captureCount(baseUrl, supervisor.token, created, quantities, captureKey),
        201,
        "capturar conteo"
      );
      expectStatus(
        await captureCount(baseUrl, supervisor.token, created, quantities, captureKey),
        200,
        "replay captura"
      );
      assert.equal(captured.detalles.filter((row) => row.captura_actual_id != null).length, 2);

      const applied = expectStatus(
        await applyCount(baseUrl, supervisor.token, created.id),
        201,
        "aplicar conteo"
      );
      assert.equal(applied.estado, "APLICADO");
      const balances = await pool.query(
        `SELECT id, stock FROM productos WHERE id=ANY($1::int[]) ORDER BY id`,
        [[productA.id, productB.id]]
      );
      const balanceMap = new Map(balances.rows.map((row) => [number(row.id), number(row.stock)]));
      assert.equal(balanceMap.get(number(productA.id)), 3);
      assert.equal(balanceMap.get(number(productB.id)), 4);
      const movements = await pool.query(
        `SELECT producto_id, delta_fisico FROM inventario_movimientos
         WHERE conteo_inventario_id=$1 ORDER BY producto_id`,
        [created.id]
      );
      assert.deepEqual(
        movements.rows.map((row) => [number(row.producto_id), number(row.delta_fisico)]),
        [[number(productA.id), -2], [number(productB.id), 2]]
      );
      await assert.rejects(
        pool.query(`UPDATE capturas_conteo_inventario SET cantidad_contada=99 WHERE conteo_inventario_id=$1`, [created.id]),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(`DELETE FROM conteos_inventario WHERE id=$1`, [created.id]),
        (error) => error.code === "55000"
      );
    });

    await t.test("detecta movimientos posteriores y permite recapturar sin afectar reservas", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 5 });
      const count = expectStatus(
        await createCount(baseUrl, supervisor.token, [product.id]),
        201,
        "crear conteo para deriva"
      );
      expectStatus(
        await captureCount(baseUrl, supervisor.token, count, new Map([[number(product.id), 4]])),
        201,
        "captura inicial"
      );
      const suffix = ++sequence;
      expectStatus(await apiRequest(baseUrl, "/pedidos", {
        method: "POST",
        token: admin.token,
        idempotencyKey: randomUUID(),
        body: {
          cliente: {
            nombre: `Cliente conteo ${suffix}`,
            telefono: `555800${String(suffix).padStart(4, "0")}`,
          },
          tipo_entrega: "RECOLECCION",
          items: [{ producto_id: number(product.id), cantidad: 1 }],
        },
      }), 201, "crear reserva concurrente");
      const stale = await applyCount(baseUrl, supervisor.token, count.id);
      expectStatus(stale, 409, "rechazar captura obsoleta");
      assert.match(stale.body.error, /cambió después de capturarlo/i);

      const refreshed = expectStatus(await apiRequest(baseUrl, `/inventario/conteos/${count.id}`, {
        token: supervisor.token,
      }), 200, "recargar conteo");
      const recaptured = expectStatus(
        await captureCount(baseUrl, supervisor.token, refreshed, new Map([[number(product.id), 4]])),
        201,
        "recapturar con reserva"
      );
      assert.equal(number(recaptured.detalles[0].stock_reservado_base), 1);
      const applied = expectStatus(
        await applyCount(baseUrl, supervisor.token, count.id),
        201,
        "aplicar tras recaptura"
      );
      assert.equal(applied.estado, "APLICADO");
      const balance = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(number(balance.stock), 4);
      assert.equal(number(balance.stock_reservado), 1);
      assert.equal(number(balance.stock_disponible), 3);
    });

    await t.test("serializa dos aplicaciones iguales y registra un solo movimiento", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 6 });
      const count = expectStatus(
        await createCount(baseUrl, admin.token, [product.id]),
        201,
        "crear conteo concurrente"
      );
      expectStatus(
        await captureCount(baseUrl, admin.token, count, new Map([[number(product.id), 5]])),
        201,
        "capturar conteo concurrente"
      );
      const key = randomUUID();
      const responses = await Promise.all([
        applyCount(baseUrl, admin.token, count.id, key),
        applyCount(baseUrl, admin.token, count.id, key),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      assert.ok(responses.every((response) => response.body.estado === "APLICADO"));
      const movementCount = await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventario_movimientos
         WHERE conteo_inventario_id=$1 AND tipo='CONTEO'`,
        [count.id]
      );
      assert.equal(movementCount.rows[0].n, 1);
      const balance = await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id]);
      assert.equal(number(balance.rows[0].stock), 5);
    });

    await t.test("cancela borradores idempotentemente sin mover existencias", async () => {
      const product = await createProduct(baseUrl, admin.token, { stock: 3 });
      const count = expectStatus(
        await createCount(baseUrl, supervisor.token, [product.id]),
        201,
        "crear conteo cancelable"
      );
      const key = randomUUID();
      const request = () => apiRequest(baseUrl, `/inventario/conteos/${count.id}/cancelacion`, {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: key,
        body: { motivo: "Conteo duplicado, se realizará uno nuevo" },
      });
      const cancelled = expectStatus(await request(), 201, "cancelar conteo");
      const replay = expectStatus(await request(), 200, "replay cancelar conteo");
      assert.equal(cancelled.estado, "CANCELADO");
      assert.equal(replay.estado, "CANCELADO");
      const effects = await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventario_movimientos WHERE conteo_inventario_id=$1`,
        [count.id]
      );
      assert.equal(effects.rows[0].n, 0);
      const balance = await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id]);
      assert.equal(number(balance.rows[0].stock), 3);
    });
  } finally {
    await environment.cleanup();
  }
});
