const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");
const { neutralizarFormula } = require("../../src/utils/csv");

const TEST_PASSWORD = "ReportesSeguros!2026";
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

async function seedRoles(pool) {
  for (const role of ["ADMIN", "SUPERVISOR", "CAJERO"]) {
    await pool.query(`INSERT INTO roles (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING`, [role]);
  }
}

async function createUser(pool, role) {
  const label = next(role.toLowerCase());
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre,email,password_hash,rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4
     RETURNING id,nombre,email`,
    [label, `${label}@reports.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  return expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`).token;
}

async function createRegister(pool, name) {
  return (await pool.query(
    `INSERT INTO caja (nombre,activo) VALUES ($1,TRUE) RETURNING *`,
    [name || next("Caja reportes")]
  )).rows[0];
}

async function openRegister(baseUrl, token, registerId, initial) {
  return expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token,
    body: { caja_id: number(registerId), fondo_inicial: initial },
  }), 201, "abrir caja");
}

async function createCategory(baseUrl, token) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/categorias", {
    method: "POST",
    token,
    body: {
      nombre: `Categoría reporte ${suffix}`,
      slug: `categoria-reporte-${suffix}`,
      descripcion: "Categoría para verificar reportes.",
      orden: suffix,
    },
  }), 201, "crear categoría");
}

async function createProduct(baseUrl, token, {
  title = null,
  stock = 10,
  price = 100,
  cost = 40,
  categoryId = null,
  publishable = false,
} = {}) {
  const suffix = ++sequence;
  const body = {
    sku: `REP-${suffix}`,
    titulo: title || `Libro reporte ${suffix}`,
    autor: `Autor reporte ${suffix}`,
    editorial: `Editorial reporte ${suffix}`,
    categoria_id: categoryId == null ? null : number(categoryId),
    precio: price,
    costo: cost,
    stock,
    iva: 0,
  };
  if (publishable) {
    body.slug = `libro-reporte-${suffix}`;
    body.descripcion_comercial = `Descripción comercial del libro ${suffix}.`;
  }
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST", token, body,
  }), 201, "crear producto");
}

async function createSale(baseUrl, token, sessionId, productId, quantity, method = "EFECTIVO") {
  const body = {
    sesion_id: number(sessionId),
    metodo_pago: method,
    cliente: "Cliente de reporte",
    items: [{ producto_id: number(productId), cantidad: quantity }],
  };
  if (method === "EFECTIVO") body.recibido = 10000;
  return expectStatus(await apiRequest(baseUrl, "/ventas", {
    method: "POST",
    token,
    idempotencyKey: crypto.randomUUID(),
    body,
  }), 201, "crear venta");
}

async function storeRequest(baseUrl, pathName, { method = "GET", cartToken, body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cartToken) headers["X-Cart-Token"] = cartToken;
  if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();
  const response = await fetch(baseUrl + "/tienda" + pathName, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const raw = await response.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
  return { status: response.status, body: parsed, headers: response.headers };
}

function reportPath(type, period, extra = {}) {
  const query = new URLSearchParams({
    desde: period.desde,
    hasta: period.hasta,
    zona_horaria: "America/Mexico_City",
    limit: "100",
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, String(value)])),
  });
  return `/reportes/${type}?${query}`;
}

async function currentPeriod(pool) {
  const result = await pool.query(
    `SELECT ((date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City'))
              AT TIME ZONE 'America/Mexico_City') AS desde,
            ((date_trunc('day', NOW() AT TIME ZONE 'America/Mexico_City') + INTERVAL '1 day')
              AT TIME ZONE 'America/Mexico_City') AS hasta`
  );
  return {
    desde: result.rows[0].desde.toISOString(),
    hasta: result.rows[0].hasta.toISOString(),
  };
}

test("reportes operativos conciliados", { timeout: 240000 }, async (t) => {
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
    const period = await currentPeriod(pool);

    await t.test("aplica migración, autenticación, RBAC y periodos estrictos", async () => {
      const migration = await pool.query(
        `SELECT version FROM schema_migrations WHERE version='012_reportes_operativos'`
      );
      assert.equal(migration.rowCount, 1);
      const path = reportPath("ventas", period);
      expectStatus(await apiRequest(baseUrl, path), 401, "reporte sin sesión");
      expectStatus(await apiRequest(baseUrl, path, { token: cashier.token }), 403, "reporte por cajero");
      expectStatus(await apiRequest(baseUrl, "/reportes/ventas?desde=mal&hasta=peor", {
        token: supervisor.token,
      }), 400, "instantes inválidos");
      expectStatus(await apiRequest(baseUrl, reportPath("ventas", {
        desde: period.hasta,
        hasta: period.desde,
      }), { token: supervisor.token }), 400, "periodo inverso");
      expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        zona_horaria: "Zona/Inexistente",
      }), { token: supervisor.token }), 400, "zona inexistente");
      expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        page: "999999999999999999999",
      }), { token: supervisor.token }), 400, "página fuera del rango seguro");
      expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        caja_id: 2147483648,
      }), { token: supervisor.token }), 400, "identificador fuera de int32");
      const tooLong = {
        desde: "2024-01-01T00:00:00.000Z",
        hasta: "2025-01-02T00:00:00.001Z",
      };
      expectStatus(await apiRequest(baseUrl, reportPath("ventas", tooLong), {
        token: supervisor.token,
      }), 400, "periodo mayor a 366 días");
      const filters = expectStatus(await apiRequest(baseUrl, "/reportes/filtros", {
        token: supervisor.token,
      }), 200, "filtros para supervisor");
      assert.ok(filters.usuarios.some((item) => number(item.id) === number(cashier.id)));
    });

    const registerSales = await createRegister(pool, "Caja ventas reporte");
    const registerReturns = await createRegister(pool, "Caja reversas reporte");
    const salesSession = await openRegister(baseUrl, cashier.token, registerSales.id, 100);
    const returnsSession = await openRegister(baseUrl, supervisor.token, registerReturns.id, 50);
    const category = await createCategory(baseUrl, supervisor.token);
    const productA = await createProduct(baseUrl, supervisor.token, {
      title: "=Libro fórmula segura",
      stock: 20,
      price: 100,
      cost: 40,
      categoryId: category.id,
    });
    const productB = await createProduct(baseUrl, supervisor.token, {
      stock: 20,
      price: 50,
      cost: 20,
      categoryId: category.id,
    });
    const saleA = await createSale(baseUrl, cashier.token, salesSession.id, productA.id, 3, "EFECTIVO");
    const saleB = await createSale(baseUrl, cashier.token, salesSession.id, productB.id, 2, "TARJETA");
    const detailA = saleA.detalle[0];
    expectStatus(await apiRequest(baseUrl, `/ventas/${saleA.id}/devoluciones`, {
      method: "POST",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        sesion_id: number(returnsSession.id),
        motivo: "Devolución para reporte",
        items: [{ detalle_venta_id: number(detailA.id), cantidad: 1 }],
      },
    }), 201, "devolución para reporte");
    expectStatus(await apiRequest(baseUrl, `/ventas/${saleB.id}/cancelacion`, {
      method: "POST",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        sesion_id: number(returnsSession.id),
        motivo: "Cancelación para reporte",
      },
    }), 201, "cancelación para reporte");

    const webProduct = await createProduct(baseUrl, supervisor.token, {
      stock: 5,
      price: 40,
      cost: 15,
      categoryId: category.id,
      publishable: true,
    });
    expectStatus(await apiRequest(baseUrl, `/productos/${webProduct.id}/imagenes`, {
      method: "POST",
      token: supervisor.token,
      body: {
        url: `https://images.example.test/${webProduct.id}.jpg`,
        texto_alternativo: "Portada de reporte",
        orden: 0,
        principal: true,
      },
    }), 201, "imagen para publicación");
    expectStatus(await apiRequest(baseUrl, `/productos/${webProduct.id}/publicacion`, {
      method: "PATCH", token: supervisor.token, body: { publicado_web: true },
    }), 200, "publicar producto");
    const webOrder = expectStatus(await storeRequest(baseUrl, "/pedidos", {
      method: "POST",
      cartToken: crypto.randomBytes(24).toString("base64url"),
      body: {
        cliente: { nombre: "Cliente web reporte", telefono: "5551002000" },
        tipo_entrega: "RECOLECCION",
        items: [{ producto_id: number(webProduct.id), cantidad: 1 }],
      },
    }), 201, "pedido web para reporte");
    const webOrderStored = (await pool.query(`SELECT id FROM pedidos WHERE folio=$1`, [webOrder.folio])).rows[0];
    expectStatus(await apiRequest(baseUrl, `/ventas/desde-pedido/${webOrderStored.id}`, {
      method: "POST",
      token: cashier.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        sesion_id: number(salesSession.id),
        metodo_pago: "EFECTIVO",
        recibido: 100,
      },
    }), 201, "cobrar pedido web");

    await t.test("concilia ventas, reversas, unidades, canales y multicaja", async () => {
      const report = expectStatus(await apiRequest(baseUrl, reportPath("ventas", period), {
        token: supervisor.token,
      }), 200, "reporte de ventas");
      assert.equal(number(report.resumen.ventas), 3);
      assert.equal(number(report.resumen.cancelaciones), 1);
      assert.equal(number(report.resumen.devoluciones), 1);
      assert.equal(number(report.resumen.venta_bruta), 440);
      assert.equal(number(report.resumen.importe_cancelado), 100);
      assert.equal(number(report.resumen.importe_devuelto), 100);
      assert.equal(number(report.resumen.venta_neta), 240);
      assert.equal(number(report.resumen.unidades_brutas), 6);
      assert.equal(number(report.resumen.unidades_revertidas), 3);
      assert.equal(number(report.resumen.unidades_netas), 3);
      assert.equal(number(report.movimientos.total), 5);
      assert.equal(report.movimientos.resultados.length, 5);
      const web = report.por_canal.find((item) => item.canal === "WEB");
      assert.equal(number(web.venta_neta), 40);
      const formulaProduct = report.rankings.productos.find(
        (item) => number(item.clave) === number(productA.id)
      );
      assert.equal(number(formulaProduct.unidades_netas), 2);
      assert.equal(number(formulaProduct.importe_neto), 200);
      const reversal = report.movimientos.resultados.find((item) => item.tipo === "DEVOLUCION");
      assert.equal(number(reversal.importe_neto), -100);

      const salesBox = expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        caja_id: registerSales.id,
      }), { token: admin.token }), 200, "ventas de caja origen");
      assert.equal(number(salesBox.resumen.venta_bruta), 440);
      assert.equal(number(salesBox.resumen.venta_neta), 440);
      const returnsBox = expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        caja_id: registerReturns.id,
      }), { token: admin.token }), 200, "reversas en otra caja");
      assert.equal(number(returnsBox.resumen.venta_bruta), 0);
      assert.equal(number(returnsBox.resumen.venta_neta), -200);
      const supervisorEvents = expectStatus(await apiRequest(baseUrl, reportPath("ventas", period, {
        usuario_id: supervisor.id,
      }), { token: admin.token }), 200, "reversas por actor real");
      assert.equal(number(supervisorEvents.resumen.venta_neta), -200);
    });

    const lowProduct = await createProduct(baseUrl, supervisor.token, {
      stock: 3, price: 25, cost: 10, categoryId: category.id,
    });
    expectStatus(await apiRequest(baseUrl, `/inventario/reposicion/productos/${lowProduct.id}`, {
      method: "PUT",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        stock_minimo: 3,
        stock_objetivo: 5,
        proveedor_preferido_id: null,
        motivo: "Política para reporte",
      },
    }), 201, "política para reporte");
    const internalOrder = expectStatus(await apiRequest(baseUrl, "/pedidos", {
      method: "POST",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        cliente: { nombre: "Cliente interno reporte", telefono: "5552003000" },
        tipo_entrega: "RECOLECCION",
        items: [{ producto_id: number(lowProduct.id), cantidad: 1 }],
      },
    }), 201, "pedido interno para reporte");
    assert.equal(internalOrder.estado, "RESERVADO");

    await t.test("reporta inventario actual y pedidos sin convertir reservas en ingreso", async () => {
      const inventoryPath = `/reportes/inventario?${new URLSearchParams({
        q: lowProduct.sku,
        estado: "BAJO_MINIMO",
        limit: "100",
      })}`;
      const inventory = expectStatus(await apiRequest(baseUrl, inventoryPath, {
        token: supervisor.token,
      }), 200, "reporte de inventario");
      assert.equal(number(inventory.resumen.productos), 1);
      assert.equal(number(inventory.resumen.unidades_fisicas), 3);
      assert.equal(number(inventory.resumen.unidades_reservadas), 1);
      assert.equal(number(inventory.resumen.unidades_disponibles), 2);
      assert.equal(number(inventory.resumen.valor_costo_fisico), 30);
      assert.equal(number(inventory.productos.resultados[0].cantidad_sugerida), 3);

      const zeroPolicyProduct = await createProduct(baseUrl, supervisor.token, {
        stock: 0, price: 10, cost: 5, categoryId: category.id,
      });
      expectStatus(await apiRequest(
        baseUrl,
        `/inventario/reposicion/productos/${zeroPolicyProduct.id}`,
        {
          method: "PUT",
          token: supervisor.token,
          idempotencyKey: crypto.randomUUID(),
          body: {
            stock_minimo: 0,
            stock_objetivo: 0,
            proveedor_preferido_id: null,
            motivo: "Política sin reposición",
          },
        }
      ), 201, "política cero");
      const zeroPolicy = expectStatus(await apiRequest(
        baseUrl,
        `/reportes/inventario?${new URLSearchParams({
          q: zeroPolicyProduct.sku,
          estado: "BAJO_MINIMO",
        })}`,
        { token: supervisor.token }
      ), 200, "política cero no es sugerencia");
      assert.equal(number(zeroPolicy.resumen.productos), 0);

      const orders = expectStatus(await apiRequest(baseUrl, reportPath("pedidos", period), {
        token: supervisor.token,
      }), 200, "reporte de pedidos");
      assert.equal(number(orders.resumen.pedidos), 2);
      assert.equal(number(orders.resumen.completados), 1);
      assert.equal(number(orders.resumen.activos), 1);
      assert.equal(number(orders.resumen.importe_solicitado), 65);
      assert.equal(number(orders.resumen.unidades_reservadas), 1);
      assert.equal(orders.por_canal.length, 2);

      const salesAfterOrder = expectStatus(await apiRequest(baseUrl, reportPath("ventas", period), {
        token: supervisor.token,
      }), 200, "ventas sin duplicar pedido reservado");
      assert.equal(number(salesAfterOrder.resumen.venta_neta), 240);
    });

    const provider = expectStatus(await apiRequest(baseUrl, "/proveedores", {
      method: "POST",
      token: supervisor.token,
      body: { nombre: next("Proveedor reporte") },
    }), 201, "crear proveedor");
    const purchaseProduct = await createProduct(baseUrl, supervisor.token, {
      stock: 0, price: 60, cost: 20, categoryId: category.id,
    });
    const purchaseOrder = expectStatus(await apiRequest(baseUrl, "/compras/ordenes", {
      method: "POST",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        proveedor_id: number(provider.id),
        items: [{
          producto_id: number(purchaseProduct.id),
          cantidad: 4,
          costo_unitario: 30,
          iva_porcentaje: 0,
        }],
      },
    }), 201, "crear orden de compra");
    const receiptResult = expectStatus(await apiRequest(
      baseUrl,
      `/compras/ordenes/${purchaseOrder.id}/recepciones`,
      {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: crypto.randomUUID(),
        body: {
          referencia: "REM-REPORTE",
          items: [{
            detalle_orden_compra_id: number(purchaseOrder.detalle[0].id),
            cantidad: 3,
            costo_unitario: 30,
          }],
        },
      }
    ), 201, "recibir compra");
    const receiptLine = receiptResult.recepcion.detalle[0];
    expectStatus(await apiRequest(baseUrl, `/compras/ordenes/${purchaseOrder.id}/devoluciones`, {
      method: "POST",
      token: supervisor.token,
      idempotencyKey: crypto.randomUUID(),
      body: {
        motivo: "Devolución de prueba de reporte",
        items: [{ detalle_recepcion_compra_id: number(receiptLine.id), cantidad: 1 }],
      },
    }), 201, "devolver a proveedor");

    const providerCurrentName = next("Proveedor renombrado");
    expectStatus(await apiRequest(baseUrl, `/proveedores/${provider.id}`, {
      method: "PATCH", token: supervisor.token, body: { nombre: providerCurrentName },
    }), 200, "renombrar proveedor");
    const purchaseSnapshotTitle = purchaseProduct.titulo;
    expectStatus(await apiRequest(baseUrl, `/productos/${purchaseProduct.id}`, {
      method: "PATCH", token: supervisor.token, body: { titulo: next("Título actual") },
    }), 200, "renombrar producto comprado");

    await t.test("separa compromisos de compras realmente recibidas", async () => {
      const report = expectStatus(await apiRequest(baseUrl, reportPath("compras", period, {
        proveedor_id: provider.id,
      }), { token: supervisor.token }), 200, "reporte de compras");
      assert.equal(number(report.resumen.recepciones), 1);
      assert.equal(number(report.resumen.devoluciones), 1);
      assert.equal(number(report.resumen.total_recibido), 90);
      assert.equal(number(report.resumen.total_devuelto), 30);
      assert.equal(number(report.resumen.compra_neta), 60);
      assert.equal(number(report.resumen.unidades_recibidas), 3);
      assert.equal(number(report.resumen.unidades_devueltas), 1);
      assert.equal(number(report.resumen.unidades_netas), 2);
      assert.equal(number(report.compromisos_actuales.ordenes_abiertas), 1);
      assert.equal(number(report.compromisos_actuales.unidades_pendientes), 1);
      assert.equal(number(report.compromisos_actuales.importe_pendiente), 30);
      assert.equal(report.proveedores[0].proveedor_nombre, providerCurrentName);
      assert.equal(report.productos[0].titulo, purchaseSnapshotTitle);
      assert.notEqual(report.movimientos.resultados[0].proveedor_nombre, providerCurrentName);
    });

    expectStatus(await apiRequest(baseUrl, "/caja/corte", {
      method: "POST",
      token: cashier.token,
      idempotencyKey: crypto.randomUUID(),
      body: { sesion_id: number(salesSession.id), efectivo_contado: 440 },
    }), 201, "corte de caja de ventas");

    await t.test("resume caja sin tratar apertura como ingreso", async () => {
      const report = expectStatus(await apiRequest(baseUrl, reportPath("caja", period), {
        token: supervisor.token,
      }), 200, "reporte de caja");
      assert.equal(number(report.resumen.fondos_apertura), 150);
      assert.equal(number(report.resumen.ventas_efectivo), 340);
      assert.equal(number(report.resumen.ventas_tarjeta), 100);
      assert.equal(number(report.resumen.reversos_efectivo), 100);
      assert.equal(number(report.resumen.reversos_tarjeta), 100);
      assert.equal(number(report.resumen.flujo_efectivo), 240);
      assert.equal(number(report.resumen.cortes), 1);
      assert.equal(number(report.resumen.diferencia_cortes), 0);
      assert.equal(number(report.resumen.sesiones_abiertas), 1);
      assert.ok(report.por_caja_usuario.length >= 2);
    });

    await t.test("exporta CSV autenticado, completo y neutraliza fórmulas", async () => {
      const inventoryQuery = new URLSearchParams({ q: productA.sku, limit: "100" });
      const response = await fetch(
        baseUrl + `/reportes/exportaciones/inventario?${inventoryQuery}`,
        {
          headers: { Authorization: `Bearer ${supervisor.token}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^text\/csv/);
      assert.match(response.headers.get("content-disposition"), /libreria-rem-inventario-/);
      assert.equal(response.headers.get("x-exported-rows"), "1");
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
      const csv = new TextDecoder("utf-8").decode(bytes.slice(3));
      assert.ok(csv.includes("\r\n"));
      assert.ok(csv.includes("'=Libro fórmula segura"));
      assert.equal(neutralizarFormula("  =2+3"), "'  =2+3");
      assert.equal(neutralizarFormula("\n=2+3"), "'\n=2+3");
      assert.equal(neutralizarFormula(-50), "-50");

      const salesResponse = await fetch(
        baseUrl + reportPath("exportaciones/ventas", period),
        {
          headers: { Authorization: `Bearer ${supervisor.token}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      assert.equal(salesResponse.status, 200);
      const salesCsv = await salesResponse.text();
      assert.ok(salesCsv.includes('"-100"'));
      assert.equal(salesCsv.includes("\"'-100\""), false);

      const denied = await fetch(
        baseUrl + `/reportes/exportaciones/inventario?${inventoryQuery}`,
        {
          headers: { Authorization: `Bearer ${cashier.token}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      assert.equal(denied.status, 403);
    });
  } finally {
    await environment.cleanup();
  }
});
