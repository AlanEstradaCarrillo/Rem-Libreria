const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "EditorialConsignacion!2026";
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
  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@consignacion.tests`, hash, role]
  );
  return result.rows[0];
}

async function login(baseUrl, user) {
  return expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`).token;
}

function post(baseUrl, path, token, body, key = randomUUID()) {
  return apiRequest(baseUrl, path, {
    method: "POST",
    token,
    body,
    idempotencyKey: key,
  });
}

async function createProduct(baseUrl, token, { stock = 10, price = 100 } = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `CON-${suffix}`,
      titulo: `Libro consignado ${suffix}`,
      autor: "Autora de consignación",
      editorial: "Librería REM",
      precio: price,
      costo: 30,
      stock,
      iva: 0,
    },
  }), 201, "crear producto");
}

async function createConsignee(baseUrl, token) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/clientes", {
    method: "POST",
    token,
    body: {
      nombre: `Distribuidora editorial ${suffix}`,
      telefono: `555400${String(suffix).padStart(4, "0")}`,
      email: `distribuidora-${suffix}@tests.local`,
      direccion: `Avenida Librerías ${suffix}`,
      segmento_precio: "MAYOREO",
      tipo_comercial: "DISTRIBUIDOR",
    },
  }), 201, "crear consignatario");
}

async function createWholesaleRule(baseUrl, token, productId) {
  return expectStatus(await apiRequest(baseUrl, "/precios/reglas", {
    method: "POST",
    token,
    body: {
      nombre: nextLabel("Consignación 20"),
      canal: "POS",
      segmento_cliente: "MAYOREO",
      tipo: "PORCENTAJE",
      valor: 20,
      producto_id: number(productId),
      categoria_id: null,
      cantidad_minima: 1,
      prioridad: 20,
      vigente_desde: null,
      vigente_hasta: null,
      activo: true,
    },
  }), 201, "crear regla mayoreo");
}

function consignmentRequest(baseUrl, token, {
  customerId,
  productId,
  quantity,
  key = randomUUID(),
  reference = "DIST-REM-001",
} = {}) {
  return post(baseUrl, "/editorial/consignaciones", token, {
    cliente_id: number(customerId),
    fecha_envio_programada: "2026-09-15",
    fecha_limite: "2026-12-15",
    moneda: "mxn",
    referencia: reference,
    notas: "Distribución inicial de prueba",
    items: [{ producto_id: number(productId), cantidad: quantity }],
  }, key);
}

async function prepareContract(baseUrl, admin, supervisor, product) {
  const contributor = expectStatus(await post(
    baseUrl,
    "/editorial/colaboradores",
    supervisor.token,
    {
      nombre_legal: nextLabel("Autora consignación"),
      email: `autora-consignacion-${sequence}@tests.local`,
    }
  ), 201, "crear colaboradora");
  let work = expectStatus(await post(
    baseUrl,
    "/editorial/obras",
    supervisor.token,
    {
      titulo: nextLabel("Obra distribuida"),
      fecha_recepcion: "2026-01-01",
      idioma: "Español",
    }
  ), 201, "crear obra");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/colaboradores`,
    supervisor.token,
    {
      colaborador_editorial_id: number(contributor.id),
      rol: "AUTOR",
      orden_credito: 0,
      credito_publico: true,
    }
  ), 201, "vincular autora");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/ediciones`,
    supervisor.token,
    { producto_id: number(product.id), motivo: "Edición para distribución" }
  ), 201, "vincular edición");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/transiciones`,
    supervisor.token,
    { estado: "EVALUACION", motivo: "Obra evaluada" }
  ), 201, "evaluar obra");
  let contract = expectStatus(await post(
    baseUrl,
    "/editorial/contratos",
    admin.token,
    {
      obra_editorial_id: number(work.id),
      colaborador_editorial_id: number(contributor.id),
      tipo: "EDICION",
      derechos: "Regalías sobre distribución impresa",
      territorio: "México",
      idioma_derechos: "Español",
      exclusividad: true,
      vigente_desde: "2026-01-01",
      vigente_hasta: "2030-12-31",
      base_regalia: "VENTA_NETA",
      porcentaje_regalia: 10,
      anticipo: 0,
      moneda: "MXN",
      periodicidad_liquidacion: "MENSUAL",
    }
  ), 201, "crear contrato");
  contract = expectStatus(await post(
    baseUrl,
    `/editorial/contratos/${contract.id}/transiciones`,
    admin.token,
    { estado: "VIGENTE", motivo: "Contrato firmado" }
  ), 201, "activar contrato");
  await post(
    baseUrl,
    `/editorial/obras/${work.id}/transiciones`,
    supervisor.token,
    { estado: "CONTRATADA", motivo: "Contrato vigente" }
  ).then((response) => expectStatus(response, 201, "marcar obra contratada"));
  return { contributor, work, contract };
}

async function inventoryBalance(pool, productId) {
  const row = (await pool.query(
    `SELECT stock, stock_reservado, stock_consignado, stock_disponible
     FROM productos WHERE id=$1`,
    [productId]
  )).rows[0];
  return {
    tienda: number(row.stock),
    reservado: number(row.stock_reservado),
    consignado: number(row.stock_consignado),
    disponible: number(row.stock_disponible),
  };
}

function reportRange() {
  const now = Date.now();
  return {
    desde: new Date(now - 60 * 60 * 1000).toISOString(),
    hasta: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}

function royaltyRange() {
  const now = new Date();
  const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  return {
    periodo_desde: before.toISOString().slice(0, 10),
    periodo_hasta: after.toISOString().slice(0, 10),
  };
}

test("distribución y consignación editorial sobre inventario común", { timeout: 240000 }, async (t) => {
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
    const product = await createProduct(baseUrl, supervisor.token, { stock: 10, price: 100 });
    const consignee = await createConsignee(baseUrl, admin.token);
    const rule = await createWholesaleRule(baseUrl, supervisor.token, product.id);
    const editorial = await prepareContract(baseUrl, admin, supervisor, product);
    let consignment;

    await t.test("aplica RBAC, precio común y alta idempotente sin inventario", async () => {
      expectStatus(await apiRequest(baseUrl, "/editorial/consignaciones"), 401,
        "listar sin sesión");
      expectStatus(await consignmentRequest(baseUrl, cashier.token, {
        customerId: consignee.id,
        productId: product.id,
        quantity: 6,
      }), 403, "cajero crea consignación");
      expectStatus(await apiRequest(baseUrl, "/clientes", {
        method: "POST",
        token: cashier.token,
        body: {
          nombre: "Distribuidor no autorizado",
          segmento_precio: "MAYOREO",
          tipo_comercial: "DISTRIBUIDOR",
        },
      }), 403, "cajero crea distribuidor");

      const before = await inventoryBalance(pool, product.id);
      const key = randomUUID();
      const create = () => consignmentRequest(baseUrl, supervisor.token, {
        customerId: consignee.id,
        productId: product.id,
        quantity: 6,
        key,
      });
      const responses = await Promise.all([create(), create()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      consignment = responses[0].body;
      assert.equal(number(consignment.id), number(responses[1].body.id));
      assert.equal(consignment.estado, "BORRADOR");
      assert.equal(consignment.segmento_precio, "MAYOREO");
      assert.equal(consignment.tipo_comercial, "DISTRIBUIDOR");
      assert.equal(consignment.detalles.length, 1);
      assert.equal(number(consignment.detalles[0].cantidad_enviada), 6);
      assert.equal(number(consignment.detalles[0].precio_unitario), 80);
      assert.equal(number(consignment.detalles[0].regla_precio_id), number(rule.id));
      assert.deepEqual(consignment.operaciones, []);
      assert.deepEqual(await inventoryBalance(pool, product.id), before);
    });

    await t.test("conserva snapshots del cliente y despacha exactamente una vez", async () => {
      expectStatus(await apiRequest(baseUrl, `/clientes/${consignee.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { nombre: "Distribuidora renombrada" },
      }), 200, "renombrar cliente");
      let loaded = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}`,
        { token: supervisor.token }
      ), 200, "leer consignación");
      assert.equal(loaded.cliente_nombre, consignee.nombre);
      assert.equal(loaded.cliente_nombre_actual, "Distribuidora renombrada");

      const key = randomUUID();
      const dispatch = () => post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/envio`,
        supervisor.token,
        { motivo: "Entrega física confirmada", referencia: "REMISION-001" },
        key
      );
      const responses = await Promise.all([dispatch(), dispatch()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      loaded = responses[0].body;
      assert.equal(loaded.estado, "ENVIADA");
      assert.deepEqual(await inventoryBalance(pool, product.id), {
        tienda: 4, reservado: 0, consignado: 6, disponible: 4,
      });
      const movement = loaded.movimientos_inventario[0];
      assert.equal(movement.tipo, "SALIDA_CONSIGNACION");
      assert.equal(number(movement.delta_fisico), -6);
      assert.equal(number(movement.delta_consignado), 6);
      assert.equal(loaded.operaciones.length, 1);
      assert.equal(loaded.operaciones[0].tipo, "ENVIO");
      assert.equal(number(loaded.operaciones[0].total), 480);
      expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/envio`,
        supervisor.token,
        { motivo: "Intento de segundo envío" }
      ), 409, "segundo envío");
      assert.equal((await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
        [product.id]
      )).rows[0].conciliado, true);
    });

    await t.test("serializa dos consignaciones que compiten por la última unidad", async () => {
      const scarce = await createProduct(baseUrl, supervisor.token, { stock: 1, price: 90 });
      const first = expectStatus(await consignmentRequest(baseUrl, supervisor.token, {
        customerId: consignee.id, productId: scarce.id, quantity: 1,
        reference: "ESCASA-A",
      }), 201, "consignación escasa A");
      const second = expectStatus(await consignmentRequest(baseUrl, supervisor.token, {
        customerId: consignee.id, productId: scarce.id, quantity: 1,
        reference: "ESCASA-B",
      }), 201, "consignación escasa B");
      const dispatch = (id) => post(
        baseUrl,
        `/editorial/consignaciones/${id}/envio`,
        supervisor.token,
        { motivo: "Competencia por unidad única" }
      );
      const responses = await Promise.all([dispatch(first.id), dispatch(second.id)]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.deepEqual(await inventoryBalance(pool, scarce.id), {
        tienda: 0, reservado: 0, consignado: 1, disponible: 0,
      });
    });

    await t.test("registra venta idempotente y no crea ingreso de caja", async () => {
      const key = randomUUID();
      const sell = () => post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/ventas`,
        supervisor.token,
        {
          referencia: "REPORTE-DIST-001",
          motivo: "Venta reportada por distribuidor",
          items: [{ producto_id: number(product.id), cantidad: 2 }],
        },
        key
      );
      const responses = await Promise.all([sell(), sell()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      consignment = responses[0].body;
      assert.equal(consignment.estado, "PARCIAL");
      assert.equal(number(consignment.resumen.unidades_vendidas), 2);
      assert.equal(number(consignment.resumen.venta_reportada), 160);
      assert.deepEqual(await inventoryBalance(pool, product.id), {
        tienda: 4, reservado: 0, consignado: 4, disponible: 4,
      });
      assert.equal(number((await pool.query(`SELECT COUNT(*) AS n FROM movimientos`)).rows[0].n), 0);
      const movement = consignment.movimientos_inventario.find(
        (row) => row.tipo === "VENTA_CONSIGNACION"
      );
      assert.equal(number(movement.delta_fisico), 0);
      assert.equal(number(movement.delta_consignado), -2);
    });

    await t.test("impide sobreprocesar el saldo bajo concurrencia y lo liquida", async () => {
      const sale = post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/ventas`,
        supervisor.token,
        {
          referencia: "REPORTE-DIST-CARRERA",
          motivo: "Venta concurrente",
          items: [{ producto_id: number(product.id), cantidad: 3 }],
        }
      );
      const returned = post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/devoluciones`,
        supervisor.token,
        {
          referencia: "DEV-DIST-CARRERA",
          motivo: "Devolución concurrente de no vendidos",
          items: [{ producto_id: number(product.id), cantidad: 3 }],
        }
      );
      const responses = await Promise.all([sale, returned]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      consignment = responses.find((response) => response.status === 201).body;
      assert.equal(number(consignment.resumen.unidades_pendientes), 1);
      assert.equal(consignment.estado, "PARCIAL");

      consignment = expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/devoluciones`,
        supervisor.token,
        {
          referencia: "DEV-DIST-FINAL",
          motivo: "Retorno de la última unidad no vendida",
          items: [{ producto_id: number(product.id), cantidad: 1 }],
        }
      ), 201, "devolver saldo final");
      assert.equal(consignment.estado, "LIQUIDADA");
      assert.equal(number(consignment.resumen.unidades_pendientes), 0);
      const sold = number(consignment.resumen.unidades_vendidas);
      const returnedUnits = number(consignment.resumen.unidades_devueltas);
      assert.equal(sold + returnedUnits, 6);
      assert.deepEqual(await inventoryBalance(pool, product.id), {
        tienda: 10 - sold, reservado: 0, consignado: 0, disponible: 10 - sold,
      });
      assert.equal((await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
        [product.id]
      )).rows[0].conciliado, true);
    });

    await t.test("incluye ventas consignadas en reportes y regalías, pero no en caja", async () => {
      const period = reportRange();
      const query = new URLSearchParams({
        ...period,
        zona_horaria: "America/Mexico_City",
        canal: "CONSIGNACION",
      });
      const salesReport = expectStatus(await apiRequest(
        baseUrl,
        `/reportes/ventas?${query}`,
        { token: supervisor.token }
      ), 200, "reporte de ventas consignadas");
      assert.equal(number(salesReport.resumen.unidades_brutas),
        number(consignment.resumen.unidades_vendidas));
      assert.equal(number(salesReport.resumen.venta_neta),
        number(consignment.resumen.venta_reportada));
      assert.deepEqual(salesReport.por_canal.map((row) => row.canal), ["CONSIGNACION"]);
      assert.equal(salesReport.movimientos.resultados.every(
        (row) => row.caja_id == null && row.metodo_pago == null
      ), true);

      const cashQuery = new URLSearchParams({
        ...period,
        zona_horaria: "America/Mexico_City",
      });
      const cashReport = expectStatus(await apiRequest(
        baseUrl,
        `/reportes/caja?${cashQuery}`,
        { token: supervisor.token }
      ), 200, "reporte de caja");
      assert.equal(number(cashReport.resumen.movimientos), 0);

      const range = royaltyRange();
      const statement = expectStatus(await post(
        baseUrl,
        "/editorial/regalias/liquidaciones",
        admin.token,
        {
          contrato_editorial_id: number(editorial.contract.id),
          ...range,
          zona_horaria: "America/Mexico_City",
          notas: "Liquidación de ventas consignadas",
        }
      ), 201, "liquidar regalía consignada");
      const sold = number(consignment.resumen.unidades_vendidas);
      assert.equal(number(statement.unidades_netas), sold);
      assert.equal(number(statement.base_regalia_total), sold * 80);
      assert.equal(number(statement.regalia_bruta), sold * 8);
      assert.equal(statement.detalle.length > 0, true);
      assert.equal(statement.detalle.every((row) => (
        row.canal === "CONSIGNACION"
        && row.movimiento_id == null
        && row.venta_id == null
        && row.consignacion_operacion_id != null
        && row.detalle_consignacion_operacion_id != null
      )), true);
    });

    await t.test("cierra con autorización y conserva documentos inmutables", async () => {
      expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/cierre`,
        supervisor.token,
        { motivo: "Cierre sin autorización administrativa" }
      ), 403, "supervisor cierra");
      consignment = expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/cierre`,
        admin.token,
        { motivo: "Estado de unidades conciliado" }
      ), 201, "admin cierra");
      assert.equal(consignment.estado, "CERRADA");
      expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${consignment.id}/ventas`,
        supervisor.token,
        {
          referencia: "VENTA-TARDIA",
          motivo: "Intento posterior al cierre",
          items: [{ producto_id: number(product.id), cantidad: 1 }],
        }
      ), 409, "venta después del cierre");
      await assert.rejects(
        pool.query(
          `UPDATE consignacion_operaciones SET total=total+1
           WHERE consignacion_editorial_id=$1`,
          [consignment.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `UPDATE consignacion_detalles SET cantidad_vendida=0
           WHERE consignacion_editorial_id=$1`,
          [consignment.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `DELETE FROM consignacion_transiciones
           WHERE consignacion_editorial_id=$1`,
          [consignment.id]
        ),
        (error) => error.code === "55000"
      );
    });

    await t.test("cancela sólo borradores sin tocar inventario", async () => {
      const before = await inventoryBalance(pool, product.id);
      let draft = expectStatus(await consignmentRequest(baseUrl, supervisor.token, {
        customerId: consignee.id,
        productId: product.id,
        quantity: 1,
        reference: "BORRADOR-CANCELABLE",
      }), 201, "crear borrador cancelable");
      draft = expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${draft.id}/cancelacion`,
        supervisor.token,
        { motivo: "Documento capturado por duplicado" }
      ), 201, "cancelar borrador");
      assert.equal(draft.estado, "CANCELADA");
      assert.deepEqual(draft.operaciones, []);
      assert.deepEqual(await inventoryBalance(pool, product.id), before);
      expectStatus(await post(
        baseUrl,
        `/editorial/consignaciones/${draft.id}/envio`,
        supervisor.token,
        { motivo: "Intento sobre documento cancelado" }
      ), 409, "enviar cancelada");
    });
  } finally {
    await environment.cleanup();
  }
});
