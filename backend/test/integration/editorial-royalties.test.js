const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "EditorialRegalias!2026";
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
    [label, `${label}@regalias.tests`, hash, role]
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

async function prepareContract(baseUrl, admin, supervisor) {
  const originalProductTitle = nextLabel("Libro con regalías");
  const product = expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token: supervisor.token,
    body: {
      sku: `REG-${++sequence}`,
      titulo: originalProductTitle,
      autor: "Autora con contrato",
      editorial: "Librería REM",
      precio: 116,
      costo: 30,
      stock: 100,
      iva: 16,
    },
  }), 201, "crear producto para regalías");
  const originalContributorName = nextLabel("Autora contractual");
  const contributor = expectStatus(await post(
    baseUrl,
    "/editorial/colaboradores",
    supervisor.token,
    {
      nombre_legal: originalContributorName,
      nombre_publico: "Nombre público de autora",
      email: `autora-regalias-${sequence}@tests.local`,
    }
  ), 201, "crear autora contractual");
  let work = expectStatus(await post(
    baseUrl,
    "/editorial/obras",
    supervisor.token,
    {
      titulo: nextLabel("Obra con regalías"),
      fecha_recepcion: "2026-09-01",
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
    { producto_id: number(product.id), motivo: "Edición sujeta a regalías" }
  ), 201, "vincular producto-edición");
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
      derechos: "Regalía de edición impresa sobre venta neta",
      territorio: "México",
      idioma_derechos: "Español",
      exclusividad: true,
      vigente_desde: "2026-09-01",
      vigente_hasta: "2030-12-31",
      base_regalia: "VENTA_NETA",
      porcentaje_regalia: 10,
      anticipo: 50,
      moneda: "MXN",
      periodicidad_liquidacion: "MENSUAL",
    }
  ), 201, "crear contrato de regalías");
  contract = expectStatus(await post(
    baseUrl,
    `/editorial/contratos/${contract.id}/transiciones`,
    admin.token,
    { estado: "VIGENTE", motivo: "Contrato firmado" }
  ), 201, "activar contrato");
  work = expectStatus(await post(
    baseUrl,
    `/editorial/obras/${work.id}/transiciones`,
    supervisor.token,
    { estado: "CONTRATADA", motivo: "Contrato vigente" }
  ), 201, "marcar obra contratada");
  return {
    product,
    contributor,
    work,
    contract,
    originalProductTitle,
    originalContributorName,
  };
}

async function openRegister(baseUrl, pool, cashier) {
  const register = (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1,TRUE) RETURNING *`,
    [nextLabel("Caja regalías")]
  )).rows[0];
  const opened = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token: cashier.token,
    body: { caja_id: number(register.id), fondo_inicial: 100 },
  }), 201, "abrir caja");
  return opened.sesion || opened;
}

function sell(baseUrl, cashier, session, product, quantity) {
  return post(baseUrl, "/ventas", cashier.token, {
    sesion_id: number(session.id),
    metodo_pago: "EFECTIVO",
    recibido: 5000,
    items: [{ producto_id: number(product.id), cantidad: quantity }],
  });
}

function generateStatement(baseUrl, token, contractId, from, to, key = randomUUID()) {
  return post(baseUrl, "/editorial/regalias/liquidaciones", token, {
    contrato_editorial_id: number(contractId),
    periodo_desde: from,
    periodo_hasta: to,
    zona_horaria: "America/Mexico_City",
    notas: `Liquidación ${from} a ${to}`,
  }, key);
}

function transitionStatement(baseUrl, token, statementId, state, {
  key = randomUUID(),
  reference = null,
} = {}) {
  const body = {
    estado: state,
    motivo: `Transición de liquidación a ${state}`,
  };
  if (reference) body.referencia = reference;
  return post(
    baseUrl,
    `/editorial/regalias/liquidaciones/${statementId}/transiciones`,
    token,
    body,
    key
  );
}

test("regalías y estados de cuenta desde ventas netas reales", { timeout: 240000 }, async (t) => {
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
    const setup = await prepareContract(baseUrl, admin, supervisor);
    const { product, contributor, contract } = setup;
    const session = await openRegister(baseUrl, pool, cashier);

    const saleA = expectStatus(await sell(baseUrl, cashier, session, product, 10), 201,
      "vender diez ejemplares");
    const saleB = expectStatus(await sell(baseUrl, cashier, session, product, 4), 201,
      "vender cuatro ejemplares");
    expectStatus(await post(
      baseUrl,
      `/ventas/${saleA.id}/devoluciones`,
      supervisor.token,
      {
        sesion_id: number(session.id),
        motivo: "Devolución parcial del cliente",
        items: [{ detalle_venta_id: number(saleA.detalle[0].id), cantidad: 2 }],
      }
    ), 201, "devolver dos ejemplares");
    expectStatus(await post(
      baseUrl,
      `/ventas/${saleB.id}/cancelacion`,
      supervisor.token,
      { sesion_id: number(session.id), motivo: "Venta capturada por error" }
    ), 201, "cancelar segunda venta");

    const saleSnapshot = (await pool.query(
      `SELECT producto_sku, producto_titulo, iva_porcentaje
       FROM detalle_ventas WHERE id=$1`,
      [saleA.detalle[0].id]
    )).rows[0];
    assert.equal(saleSnapshot.producto_titulo, setup.originalProductTitle);
    assert.equal(number(saleSnapshot.iva_porcentaje), 16);
    expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
      method: "PATCH",
      token: supervisor.token,
      body: { titulo: `${setup.originalProductTitle} RENOMBRADO` },
    }), 200, "renombrar producto después de vender");
    expectStatus(await apiRequest(baseUrl, `/editorial/colaboradores/${contributor.id}`, {
      method: "PATCH",
      token: supervisor.token,
      body: { nombre_legal: `${setup.originalContributorName} RENOMBRADA` },
    }), 200, "renombrar autora después de contratar");

    let firstStatement;
    await t.test("calcula venta, cancelación y devolución con snapshots e idempotencia", async () => {
      expectStatus(await apiRequest(baseUrl, "/editorial/regalias/liquidaciones"), 401,
        "liquidaciones anónimo");
      expectStatus(await apiRequest(baseUrl, "/editorial/regalias/liquidaciones", {
        token: cashier.token,
      }), 403, "liquidaciones por cajero");
      expectStatus(await generateStatement(
        baseUrl,
        supervisor.token,
        contract.id,
        "2026-09-01",
        "2026-10-01"
      ), 403, "generación por supervisor");

      const key = randomUUID();
      const generate = () => generateStatement(
        baseUrl,
        admin.token,
        contract.id,
        "2026-09-01",
        "2026-10-01",
        key
      );
      const responses = await Promise.all([generate(), generate()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      firstStatement = responses[0].body;
      assert.equal(number(firstStatement.id), number(responses[1].body.id));
      assert.equal(firstStatement.estado, "BORRADOR");
      assert.equal(firstStatement.version, 1);
      assert.equal(firstStatement.colaborador_nombre, setup.originalContributorName);
      assert.equal(firstStatement.detalle.length, 4);
      assert.deepEqual(
        firstStatement.detalle.map((row) => row.tipo_evento).sort(),
        ["CANCELACION", "DEVOLUCION", "VENTA", "VENTA"]
      );
      assert.ok(firstStatement.detalle.every(
        (row) => row.producto_titulo === setup.originalProductTitle
      ));
      assert.equal(number(firstStatement.unidades_netas), 8);
      assert.equal(number(firstStatement.base_regalia_total), 800);
      assert.equal(number(firstStatement.regalia_bruta), 80);
      assert.equal(number(firstStatement.saldo_editorial_anterior), 0);
      assert.equal(number(firstStatement.anticipo_pendiente_antes), 50);
      assert.equal(number(firstStatement.anticipo_aplicado), 50);
      assert.equal(number(firstStatement.anticipo_pendiente_despues), 0);
      assert.equal(number(firstStatement.importe_pagable), 30);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM liquidaciones_regalias
         WHERE contrato_editorial_id=$1 AND periodo_desde='2026-09-01'`,
        [contract.id]
      )).rows[0].n), 1);

      expectStatus(await generateStatement(
        baseUrl,
        admin.token,
        contract.id,
        "2026-09-15",
        "2026-10-15"
      ), 409, "rechazar periodo superpuesto");
      await pool.query(`SELECT validar_liquidacion_regalia_conciliada($1)`, [firstStatement.id]);
    });

    await t.test("emite, paga y presenta el estado de cuenta", async () => {
      const emitKey = randomUUID();
      const emit = () => transitionStatement(
        baseUrl,
        admin.token,
        firstStatement.id,
        "EMITIDA",
        { key: emitKey }
      );
      const emitted = await Promise.all([emit(), emit()]);
      assert.deepEqual(emitted.map((response) => response.status).sort(), [200, 201]);
      firstStatement = emitted[0].body;
      assert.equal(firstStatement.estado, "EMITIDA");

      const payKey = randomUUID();
      const pay = () => transitionStatement(
        baseUrl,
        admin.token,
        firstStatement.id,
        "PAGADA",
        { key: payKey, reference: "TRANSFERENCIA-REG-001" }
      );
      const paid = await Promise.all([pay(), pay()]);
      assert.deepEqual(paid.map((response) => response.status).sort(), [200, 201]);
      firstStatement = paid[0].body;
      assert.equal(firstStatement.estado, "PAGADA");
      assert.equal(firstStatement.pago_referencia, "TRANSFERENCIA-REG-001");
      expectStatus(await transitionStatement(
        baseUrl,
        admin.token,
        firstStatement.id,
        "CANCELADA"
      ), 409, "no cancelar una liquidación pagada");

      const account = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/regalias/estado-cuenta?colaborador_editorial_id=${contributor.id}`,
        { token: supervisor.token }
      ), 200, "estado de cuenta");
      assert.equal(account.estados_cuenta.length, 1);
      assert.equal(number(account.estados_cuenta[0].importe_pagado), 30);
      assert.equal(number(account.estados_cuenta[0].importe_pendiente), 0);
      assert.equal(number(account.estados_cuenta[0].anticipo_pendiente), 0);
    });

    let secondStatement;
    let thirdStatement;
    await t.test("arrastra devoluciones posteriores como saldo editorial", async () => {
      const lateReturn = expectStatus(await post(
        baseUrl,
        `/ventas/${saleA.id}/devoluciones`,
        supervisor.token,
        {
          sesion_id: number(session.id),
          motivo: "Devolución recibida en el siguiente periodo",
          items: [{ detalle_venta_id: number(saleA.detalle[0].id), cantidad: 5 }],
        }
      ), 201, "devolución de periodo posterior");
      await pool.query(
        `UPDATE movimientos SET creado_en='2026-10-15T18:00:00Z'
         WHERE devolucion_id=$1`,
        [lateReturn.devolucion.id]
      );
      secondStatement = expectStatus(await generateStatement(
        baseUrl,
        admin.token,
        contract.id,
        "2026-10-01",
        "2026-11-01"
      ), 201, "liquidar periodo negativo");
      assert.equal(number(secondStatement.unidades_netas), -5);
      assert.equal(number(secondStatement.base_regalia_total), -500);
      assert.equal(number(secondStatement.regalia_bruta), -50);
      assert.equal(number(secondStatement.importe_pagable), 0);
      assert.equal(number(secondStatement.saldo_editorial_nuevo), 50);
      secondStatement = expectStatus(await transitionStatement(
        baseUrl,
        admin.token,
        secondStatement.id,
        "EMITIDA"
      ), 201, "emitir periodo negativo");

      const saleC = expectStatus(await sell(baseUrl, cashier, session, product, 8), 201,
        "venta del tercer periodo");
      await pool.query(
        `UPDATE movimientos SET creado_en='2026-11-15T18:00:00Z'
         WHERE venta_id=$1`,
        [saleC.id]
      );
      thirdStatement = expectStatus(await generateStatement(
        baseUrl,
        admin.token,
        contract.id,
        "2026-11-01",
        "2026-12-01"
      ), 201, "liquidar periodo que absorbe saldo");
      assert.equal(number(thirdStatement.unidades_netas), 8);
      assert.equal(number(thirdStatement.regalia_bruta), 80);
      assert.equal(number(thirdStatement.saldo_editorial_anterior), 50);
      assert.equal(number(thirdStatement.saldo_editorial_aplicado), 50);
      assert.equal(number(thirdStatement.saldo_editorial_nuevo), 0);
      assert.equal(number(thirdStatement.importe_pagable), 30);

      expectStatus(await transitionStatement(
        baseUrl,
        admin.token,
        secondStatement.id,
        "CANCELADA"
      ), 409, "no cancelar un periodo con otro posterior");
    });

    await t.test("cancela la última versión y genera un reemplazo auditable", async () => {
      const cancelKey = randomUUID();
      const cancel = () => transitionStatement(
        baseUrl,
        admin.token,
        thirdStatement.id,
        "CANCELADA",
        { key: cancelKey }
      );
      const cancelled = await Promise.all([cancel(), cancel()]);
      assert.deepEqual(cancelled.map((response) => response.status).sort(), [200, 201]);
      assert.equal(cancelled[0].body.estado, "CANCELADA");

      const replacement = expectStatus(await generateStatement(
        baseUrl,
        admin.token,
        contract.id,
        "2026-11-01",
        "2026-12-01"
      ), 201, "regenerar periodo cancelado");
      assert.equal(number(replacement.version), 2);
      assert.equal(number(replacement.reemplaza_liquidacion_id), number(thirdStatement.id));
      assert.equal(number(replacement.regalia_bruta), 80);
      assert.equal(number(replacement.saldo_editorial_aplicado), 50);
      assert.equal(number(replacement.importe_pagable), 30);
      thirdStatement = expectStatus(await transitionStatement(
        baseUrl,
        admin.token,
        replacement.id,
        "EMITIDA"
      ), 201, "emitir reemplazo");

      const account = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/regalias/estado-cuenta?colaborador_editorial_id=${contributor.id}`,
        { token: supervisor.token }
      ), 200, "estado de cuenta acumulado");
      const row = account.estados_cuenta[0];
      assert.equal(number(row.regalia_bruta_acumulada), 110);
      assert.equal(number(row.anticipo_aplicado), 50);
      assert.equal(number(row.importe_pagado), 30);
      assert.equal(number(row.importe_pendiente), 30);
      assert.equal(number(row.saldo_a_favor_editorial), 0);

      const list = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/regalias/liquidaciones?contrato_editorial_id=${contract.id}&q=${encodeURIComponent(contract.folio)}`,
        { token: supervisor.token }
      ), 200, "listar liquidaciones");
      assert.equal(list.liquidaciones.length, 4);
    });

    await t.test("mantiene cálculo, detalle e historial inmutables", async () => {
      await assert.rejects(
        pool.query(
          `UPDATE liquidaciones_regalias SET regalia_bruta=1 WHERE id=$1`,
          [thirdStatement.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `UPDATE detalle_liquidaciones_regalias SET importe_regalia=1
           WHERE liquidacion_regalia_id=$1`,
          [thirdStatement.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `DELETE FROM liquidacion_regalia_transiciones
           WHERE liquidacion_regalia_id=$1`,
          [thirdStatement.id]
        ),
        (error) => error.code === "55000"
      );
      await pool.query(
        `SELECT validar_liquidacion_regalia_conciliada($1)`,
        [thirdStatement.id]
      );
    });
  } finally {
    await environment.cleanup();
  }
});
