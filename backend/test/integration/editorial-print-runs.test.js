const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "EditorialTirajes!2026";
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
    [label, `${label}@tirajes.tests`, hash, role]
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

async function prepareWork(baseUrl, admin, supervisor) {
  const product = expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token: supervisor.token,
    body: {
      sku: `TIR-${++sequence}`,
      titulo: nextLabel("Libro para tiraje"),
      autor: "Autora editorial",
      editorial: "Librería REM",
      edicion: "Primera",
      precio: 180,
      costo: 20,
      stock: 5,
      iva: 0,
    },
  }), 201, "crear edición de producto");
  const contributor = expectStatus(await post(
    baseUrl,
    "/editorial/colaboradores",
    supervisor.token,
    {
      nombre_legal: nextLabel("Autora de tiraje"),
      email: `autora-tiraje-${sequence}@tests.local`,
    }
  ), 201, "crear colaborador");
  let work = expectStatus(await post(
    baseUrl,
    "/editorial/obras",
    supervisor.token,
    {
      titulo: nextLabel("Obra para tiraje"),
      fecha_recepcion: "2026-09-01",
      fecha_objetivo_publicacion: "2027-01-15",
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
  ), 201, "vincular colaborador");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/ediciones`,
    supervisor.token,
    { producto_id: number(product.id), motivo: "Edición destinada al tiraje" }
  ), 201, "vincular edición");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/transiciones`,
    supervisor.token,
    { estado: "EVALUACION", motivo: "Evaluación editorial completa" }
  ), 201, "evaluar obra");
  let contract = expectStatus(await post(
    baseUrl,
    "/editorial/contratos",
    admin.token,
    {
      obra_editorial_id: number(work.id),
      colaborador_editorial_id: number(contributor.id),
      tipo: "EDICION",
      derechos: "Derechos para edición impresa",
      territorio: "México",
      idioma_derechos: "Español",
      exclusividad: true,
      vigente_desde: "2026-09-01",
      vigente_hasta: "2030-12-31",
      base_regalia: "VENTA_NETA",
      porcentaje_regalia: 10,
      anticipo: 0,
      moneda: "MXN",
      periodicidad_liquidacion: "SEMESTRAL",
    }
  ), 201, "crear contrato");
  contract = expectStatus(await post(
    baseUrl,
    `/editorial/contratos/${contract.id}/transiciones`,
    admin.token,
    { estado: "VIGENTE", motivo: "Contrato editorial firmado" }
  ), 201, "activar contrato");
  for (const state of ["CONTRATADA", "EDICION", "DISENO", "IMPRESION"]) {
    work = expectStatus(await post(
      baseUrl,
      `/editorial/obras/${work.id}/transiciones`,
      supervisor.token,
      { estado: state, motivo: `Avance editorial a ${state}` }
    ), 201, `avanzar a ${state}`);
  }
  return { product, contributor, work, contract };
}

function createRun(baseUrl, token, work, product, provider, {
  key = randomUUID(),
  quantity = 100,
  note = "Primer tiraje comercial",
  costs = null,
} = {}) {
  return post(baseUrl, "/editorial/tirajes", token, {
    obra_editorial_id: number(work.id),
    producto_id: number(product.id),
    cantidad: quantity,
    fecha_programada: "2026-10-15",
    moneda: "mxn",
    notas: note,
    costos: costs || [
      {
        tipo: "PAPEL",
        concepto: "Papel para interiores y portada",
        proveedor_id: number(provider.id),
        referencia: "PAP-001",
        monto: 6000,
      },
      {
        tipo: "IMPRESION",
        concepto: "Impresión y encuadernado",
        proveedor_id: number(provider.id),
        referencia: "IMP-001",
        monto: 3000,
      },
    ],
  }, key);
}

test("tirajes y costos editoriales integrados al kardex", { timeout: 240000 }, async (t) => {
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
    const { work, product } = await prepareWork(baseUrl, admin, supervisor);
    const provider = expectStatus(await apiRequest(baseUrl, "/proveedores", {
      method: "POST",
      token: supervisor.token,
      body: {
        nombre: nextLabel("Imprenta REM"),
        razon_social: "Impresiones de prueba SA",
        rfc: `IMP${String(sequence).padStart(9, "0")}`,
      },
    }), 201, "crear imprenta proveedora");

    let run;

    await t.test("aplica permisos y crea un borrador idempotente sin mover stock", async () => {
      expectStatus(await apiRequest(baseUrl, "/editorial/tirajes"), 401, "tirajes anónimo");
      expectStatus(await createRun(baseUrl, cashier.token, work, product, provider), 403,
        "tiraje por cajero");
      const before = (await pool.query(
        `SELECT stock, costo FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      const key = randomUUID();
      const responses = await Promise.all([
        createRun(baseUrl, supervisor.token, work, product, provider, { key }),
        createRun(baseUrl, supervisor.token, work, product, provider, { key }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      run = responses[0].body;
      assert.equal(number(run.id), number(responses[1].body.id));
      assert.equal(run.estado, "BORRADOR");
      assert.equal(run.moneda, "MXN");
      assert.equal(number(run.costo_capturado), 9000);
      assert.equal(run.costos.length, 2);
      assert.deepEqual(run.transiciones.map((row) => row.estado_nuevo), ["BORRADOR"]);
      assert.equal(run.movimientos_inventario.length, 0);
      const after = (await pool.query(
        `SELECT stock, costo FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      assert.deepEqual(after, before);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM tirajes_editoriales WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n), 1);
    });

    await t.test("administra conceptos mientras el tiraje está en borrador", async () => {
      const key = randomUUID();
      const addCost = () => post(
        baseUrl,
        `/editorial/tirajes/${run.id}/costos`,
        supervisor.token,
        {
          tipo: "ACABADOS",
          concepto: "Laminado de portada",
          proveedor_id: number(provider.id),
          referencia: "ACA-001",
          monto: 1000,
        },
        key
      );
      const responses = await Promise.all([addCost(), addCost()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      run = responses[0].body;
      assert.equal(run.costos.length, 3);
      assert.equal(number(run.costo_capturado), 10000);
      const finishCost = run.costos.find((row) => row.tipo === "ACABADOS");
      run = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/tirajes/${run.id}/costos/${finishCost.id}`,
        {
          method: "PATCH",
          token: supervisor.token,
          body: { monto: 1200, concepto: "Laminado mate de portada" },
        }
      ), 200, "actualizar costo");
      assert.equal(number(run.costo_capturado), 10200);

      run = expectStatus(await post(
        baseUrl,
        `/editorial/tirajes/${run.id}/costos`,
        supervisor.token,
        { tipo: "OTRO", concepto: "Concepto temporal", monto: 300 }
      ), 201, "agregar costo temporal");
      const temporary = run.costos.find((row) => row.concepto === "Concepto temporal");
      run = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/tirajes/${run.id}/costos/${temporary.id}`,
        { method: "DELETE", token: supervisor.token }
      ), 200, "eliminar costo temporal");
      assert.equal(number(run.costo_capturado), 10200);
      assert.equal(run.costos.length, 3);
    });

    await t.test("confirma una sola vez y registra costo, stock y kardex exactos", async () => {
      expectStatus(await post(
        baseUrl,
        `/editorial/tirajes/${run.id}/confirmacion`,
        cashier.token,
        { motivo: "Recepción no autorizada" }
      ), 403, "confirmación por cajero");
      const key = randomUUID();
      const confirm = () => post(
        baseUrl,
        `/editorial/tirajes/${run.id}/confirmacion`,
        supervisor.token,
        { motivo: "Ejemplares terminados e inspeccionados" },
        key
      );
      const responses = await Promise.all([confirm(), confirm()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      run = responses[0].body;
      assert.equal(run.estado, "CONFIRMADO");
      assert.equal(number(run.costo_total_confirmado), 10200);
      assert.equal(number(run.costo_unitario_confirmado), 102);
      assert.equal(number(run.costo_producto_anterior), 20);
      assert.equal(number(run.costo_producto_nuevo), 102);
      assert.equal(number(run.stock_anterior), 5);
      assert.equal(number(run.stock_resultante), 105);
      assert.equal(run.movimientos_inventario.length, 1);
      const movement = run.movimientos_inventario[0];
      assert.equal(movement.tipo, "TIRAJE_EDITORIAL");
      assert.equal(number(movement.delta_fisico), 100);
      assert.equal(number(movement.delta_reservado), 0);
      assert.equal(number(movement.usuario_id), number(supervisor.id));
      const balance = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible, costo
         FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      assert.deepEqual(balance, {
        stock: 105,
        stock_reservado: 0,
        stock_disponible: 105,
        costo: "102.00",
      });

      expectStatus(await apiRequest(baseUrl, `/editorial/tirajes/${run.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { cantidad: 200 },
      }), 409, "editar tiraje confirmado");
      expectStatus(await apiRequest(
        baseUrl,
        `/editorial/tirajes/${run.id}/costos/${run.costos[0].id}`,
        { method: "PATCH", token: supervisor.token, body: { monto: 1 } }
      ), 409, "editar costo confirmado");
      await assert.rejects(
        pool.query(
          `UPDATE tiraje_editorial_costos SET monto=1 WHERE tiraje_editorial_id=$1`,
          [run.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `DELETE FROM inventario_movimientos WHERE tiraje_editorial_id=$1`,
          [run.id]
        ),
        (error) => error.code === "55000"
      );
      await pool.query(`SELECT validar_tiraje_editorial_conciliado($1)`, [run.id]);
      const reconciliation = (await pool.query(
        `SELECT conciliado FROM inventario_conciliacion WHERE producto_id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(reconciliation.conciliado, true);
    });

    await t.test("conserva snapshots del proveedor y cancela sin inventario", async () => {
      const originalProviderName = provider.nombre;
      expectStatus(await apiRequest(baseUrl, `/proveedores/${provider.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { nombre: `${provider.nombre} RENOMBRADA` },
      }), 200, "renombrar proveedor");
      const reloaded = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/tirajes/${run.id}`,
        { token: supervisor.token }
      ), 200, "recargar tiraje confirmado");
      assert.ok(reloaded.costos.every((row) => row.proveedor_nombre === originalProviderName));

      const cancelledDraft = expectStatus(await createRun(
        baseUrl,
        supervisor.token,
        work,
        product,
        provider,
        {
          quantity: 5,
          note: "Tiraje que no se realizará",
          costs: [{ tipo: "IMPRESION", concepto: "Prueba cancelada", monto: 50 }],
        }
      ), 201, "crear tiraje cancelable");
      const stockBefore = number((await pool.query(
        `SELECT stock FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0].stock);
      const cancelKey = randomUUID();
      const cancel = () => post(
        baseUrl,
        `/editorial/tirajes/${cancelledDraft.id}/cancelacion`,
        supervisor.token,
        { motivo: "La imprenta canceló la fecha" },
        cancelKey
      );
      const responses = await Promise.all([cancel(), cancel()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      assert.equal(responses[0].body.estado, "CANCELADO");
      assert.equal(responses[0].body.movimientos_inventario.length, 0);
      assert.equal(number((await pool.query(
        `SELECT stock FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0].stock), stockBefore);
      expectStatus(await post(
        baseUrl,
        `/editorial/tirajes/${cancelledDraft.id}/confirmacion`,
        supervisor.token,
        { motivo: "No debe confirmarse" }
      ), 409, "confirmar tiraje cancelado");
    });

    await t.test("serializa confirmaciones con claves distintas y filtra documentos", async () => {
      const racing = expectStatus(await createRun(
        baseUrl,
        supervisor.token,
        work,
        product,
        provider,
        {
          quantity: 10,
          note: "Tiraje de reimpresión concurrente",
          costs: [{ tipo: "IMPRESION", concepto: "Reimpresión", monto: 500 }],
        }
      ), 201, "crear tiraje concurrente");
      const confirm = () => post(
        baseUrl,
        `/editorial/tirajes/${racing.id}/confirmacion`,
        supervisor.token,
        { motivo: "Confirmación concurrente" },
        randomUUID()
      );
      const responses = await Promise.all([confirm(), confirm()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM inventario_movimientos
         WHERE tiraje_editorial_id=$1`,
        [racing.id]
      )).rows[0].n), 1);
      assert.equal(number((await pool.query(
        `SELECT stock FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0].stock), 115);

      const list = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/tirajes?estado=CONFIRMADO&obra_editorial_id=${work.id}&q=${encodeURIComponent(product.sku)}`,
        { token: supervisor.token }
      ), 200, "listar tirajes confirmados");
      assert.equal(list.tirajes.length, 2);

      const direct = expectStatus(await createRun(
        baseUrl,
        supervisor.token,
        work,
        product,
        provider,
        {
          quantity: 1,
          note: "Tiraje protegido",
          costs: [{ tipo: "OTRO", concepto: "Protección", monto: 1 }],
        }
      ), 201, "crear borrador protegido");
      await assert.rejects(
        pool.query(
          `UPDATE tirajes_editoriales
           SET estado='CANCELADO', cancelado_por_usuario_id=$2,
               cancelado_en=NOW(), cancelacion_motivo='Sin historial'
           WHERE id=$1`,
          [direct.id, supervisor.id]
        ),
        (error) => error.code === "23514"
      );
    });
  } finally {
    await environment.cleanup();
  }
});
