const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "EditorialObras!2026";
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
    [label, `${label}@editorial.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
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

async function createProduct(baseUrl, token, { isbn = null } = {}) {
  const suffix = ++sequence;
  const body = {
    sku: `ED-${suffix}`,
    titulo: `Edición editorial ${suffix}`,
    autor: "Autora de prueba",
    editorial: "Librería REM",
    edicion: "Primera",
    anio_publicacion: 2026,
    formato: "Rústica",
    precio: 220,
    costo: 80,
    stock: 7,
    iva: 0,
  };
  if (isbn) body.isbn = isbn;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body,
  }), 201, "crear producto-edición");
}

async function createContributor(baseUrl, token, {
  key = randomUUID(),
  name = nextLabel("Autora"),
} = {}) {
  return post(baseUrl, "/editorial/colaboradores", token, {
    nombre_legal: name,
    nombre_publico: `${name} pública`,
    email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@tests.local`,
    telefono: "5554001000",
    identificador_fiscal: `RFC-${sequence}`,
    notas: "Identidad contractual de prueba",
  }, key);
}

function createWork(baseUrl, token, {
  key = randomUUID(),
  title = nextLabel("Obra"),
  editorId = null,
} = {}) {
  return post(baseUrl, "/editorial/obras", token, {
    titulo: title,
    subtitulo: "Manuscrito en preparación",
    sinopsis: "Sinopsis contractual y editorial.",
    idioma: "Español",
    fecha_recepcion: "2026-09-01",
    fecha_objetivo_publicacion: "2027-03-01",
    editor_responsable_usuario_id: editorId,
    notas: "Ingreso editorial auditable",
  }, key);
}

function transitionWork(baseUrl, token, workId, state, {
  key = randomUUID(),
  reason = `Transición de prueba a ${state}`,
} = {}) {
  return post(
    baseUrl,
    `/editorial/obras/${workId}/transiciones`,
    token,
    { estado: state, motivo: reason },
    key
  );
}

function createContract(baseUrl, token, workId, contributorId, {
  key = randomUUID(),
  rights = "Derechos de edición impresa y digital en español",
} = {}) {
  return post(baseUrl, "/editorial/contratos", token, {
    obra_editorial_id: number(workId),
    colaborador_editorial_id: number(contributorId),
    tipo: "EDICION",
    derechos: rights,
    territorio: "México y América Latina",
    idioma_derechos: "Español",
    exclusividad: true,
    vigente_desde: "2026-09-01",
    vigente_hasta: "2030-12-31",
    base_regalia: "VENTA_NETA",
    porcentaje_regalia: 10,
    anticipo: 2500,
    moneda: "mxn",
    periodicidad_liquidacion: "SEMESTRAL",
    notas: "Contrato de integración",
  }, key);
}

test("obras, colaboradores, ediciones y contratos editoriales", { timeout: 240000 }, async (t) => {
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
    const product = await createProduct(baseUrl, supervisor.token, {
      isbn: "9780306406157",
    });

    let contributor;
    let otherContributor;
    let work;
    let contract;

    await t.test("aplica autenticación, roles e idempotencia al directorio editorial", async () => {
      expectStatus(await apiRequest(baseUrl, "/editorial/obras"), 401, "editorial anónimo");
      expectStatus(await apiRequest(baseUrl, "/editorial/obras", {
        token: cashier.token,
      }), 403, "editorial por cajero");

      const key = randomUUID();
      const name = nextLabel("Autora concurrente");
      const responses = await Promise.all([
        createContributor(baseUrl, supervisor.token, { key, name }),
        createContributor(baseUrl, supervisor.token, { key, name }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      contributor = responses[0].body;
      assert.equal(number(responses[0].body.id), number(responses[1].body.id));
      assert.equal(contributor.nombre_legal, name);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM colaboradores_editoriales WHERE nombre_legal=$1`,
        [name]
      )).rows[0].n), 1);

      expectStatus(await createContributor(baseUrl, supervisor.token, {
        key,
        name: "Solicitud diferente",
      }), 409, "reutilizar clave con otro colaborador");
      otherContributor = expectStatus(await createContributor(
        baseUrl,
        admin.token,
        { name: nextLabel("Colaborador sin vínculo") }
      ), 201, "crear colaborador no vinculado");
    });

    await t.test("crea una obra una sola vez y protege su historial", async () => {
      const key = randomUUID();
      const title = "Obra <script>alert('x')</script>";
      const responses = await Promise.all([
        createWork(baseUrl, supervisor.token, { key, title, editorId: supervisor.id }),
        createWork(baseUrl, supervisor.token, { key, title, editorId: supervisor.id }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      work = responses[0].body;
      assert.equal(number(work.id), number(responses[1].body.id));
      assert.equal(work.titulo, title);
      assert.equal(work.estado, "PROPUESTA");
      assert.deepEqual(work.transiciones.map((row) => row.estado_nuevo), ["PROPUESTA"]);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM obras_editoriales WHERE titulo=$1`,
        [title]
      )).rows[0].n), 1);

      expectStatus(await transitionWork(
        baseUrl,
        supervisor.token,
        work.id,
        "EVALUACION"
      ), 409, "evaluar sin equipo");

      const directWork = expectStatus(await createWork(
        baseUrl,
        supervisor.token,
        { title: nextLabel("Obra protegida") }
      ), 201, "crear obra para comprobar conciliación");
      await assert.rejects(
        pool.query(
          `UPDATE obras_editoriales SET estado='EVALUACION' WHERE id=$1`,
          [directWork.id]
        ),
        (error) => error.code === "23514"
      );
      await assert.rejects(
        pool.query(
          `UPDATE obra_editorial_transiciones SET motivo='Alterado' WHERE obra_editorial_id=$1`,
          [work.id]
        ),
        (error) => error.code === "55000"
      );
    });

    await t.test("vincula equipo y edición existente sin duplicar catálogo ni stock", async () => {
      const linkKey = randomUUID();
      const linkBody = {
        colaborador_editorial_id: number(contributor.id),
        rol: "AUTOR",
        nombre_credito: contributor.nombre_publico,
        orden_credito: 0,
        credito_publico: true,
        notas: "Autora principal",
      };
      const linked = await Promise.all([
        post(baseUrl, `/editorial/obras/${work.id}/colaboradores`, supervisor.token, linkBody, linkKey),
        post(baseUrl, `/editorial/obras/${work.id}/colaboradores`, supervisor.token, linkBody, linkKey),
      ]);
      assert.deepEqual(linked.map((response) => response.status).sort(), [200, 201]);
      work = linked[0].body;
      assert.equal(work.colaboradores.length, 1);
      assert.equal(work.colaboradores[0].rol, "AUTOR");

      const transitionKey = randomUUID();
      const transitions = await Promise.all([
        transitionWork(baseUrl, supervisor.token, work.id, "EVALUACION", { key: transitionKey }),
        transitionWork(baseUrl, supervisor.token, work.id, "EVALUACION", { key: transitionKey }),
      ]);
      assert.deepEqual(transitions.map((response) => response.status).sort(), [200, 201]);
      work = transitions[0].body;
      assert.equal(work.estado, "EVALUACION");
      assert.equal(work.transiciones.filter((row) => row.estado_nuevo === "EVALUACION").length, 1);
      expectStatus(await transitionWork(
        baseUrl,
        supervisor.token,
        work.id,
        "EDICION"
      ), 409, "saltar contrato");

      const stockBefore = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible
         FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      const editionKey = randomUUID();
      const editionBody = {
        producto_id: number(product.id),
        motivo: "Primera edición comercial de la obra",
      };
      const editions = await Promise.all([
        post(baseUrl, `/editorial/obras/${work.id}/ediciones`, supervisor.token, editionBody, editionKey),
        post(baseUrl, `/editorial/obras/${work.id}/ediciones`, supervisor.token, editionBody, editionKey),
      ]);
      assert.deepEqual(editions.map((response) => response.status).sort(), [200, 201]);
      work = editions[0].body;
      assert.equal(work.ediciones.length, 1);
      assert.equal(number(work.ediciones[0].id), number(product.id));
      const productAfter = (await pool.query(
        `SELECT obra_editorial_id, stock, stock_reservado, stock_disponible
         FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(number(productAfter.obra_editorial_id), number(work.id));
      assert.deepEqual(
        {
          stock: number(productAfter.stock),
          stock_reservado: number(productAfter.stock_reservado),
          stock_disponible: number(productAfter.stock_disponible),
        },
        {
          stock: number(stockBefore.stock),
          stock_reservado: number(stockBefore.stock_reservado),
          stock_disponible: number(stockBefore.stock_disponible),
        }
      );
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) AS n FROM producto_obra_editorial_historial WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n), 1);

      const anotherProduct = await createProduct(baseUrl, supervisor.token);
      await assert.rejects(
        pool.query(
          `UPDATE productos SET obra_editorial_id=$2 WHERE id=$1`,
          [anotherProduct.id, work.id]
        ),
        (error) => error.code === "23514"
      );
    });

    await t.test("limita contratos a ADMIN y conserva snapshots jurídicos", async () => {
      expectStatus(await createContract(
        baseUrl,
        supervisor.token,
        work.id,
        contributor.id
      ), 403, "contrato por supervisor");
      expectStatus(await createContract(
        baseUrl,
        admin.token,
        work.id,
        otherContributor.id
      ), 409, "contrato con colaborador ajeno a la obra");

      const key = randomUUID();
      const responses = await Promise.all([
        createContract(baseUrl, admin.token, work.id, contributor.id, { key }),
        createContract(baseUrl, admin.token, work.id, contributor.id, { key }),
      ]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      contract = responses[0].body;
      assert.equal(number(contract.id), number(responses[1].body.id));
      assert.equal(contract.estado, "BORRADOR");
      assert.equal(contract.moneda, "MXN");
      assert.equal(contract.obra_titulo, work.titulo);
      assert.equal(contract.colaborador_nombre, contributor.nombre_legal);
      assert.deepEqual(contract.transiciones.map((row) => row.estado_nuevo), ["BORRADOR"]);

      contract = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/contratos/${contract.id}`,
        {
          method: "PATCH",
          token: admin.token,
          body: { porcentaje_regalia: 12.5, notas: "Términos revisados" },
        }
      ), 200, "editar contrato en borrador");
      assert.equal(number(contract.porcentaje_regalia), 12.5);

      expectStatus(await transitionWork(
        baseUrl,
        supervisor.token,
        work.id,
        "CONTRATADA"
      ), 409, "declarar contratada sin contrato vigente");

      const originalName = contributor.nombre_legal;
      const renamed = `${originalName} RENOMBRADA`;
      expectStatus(await apiRequest(baseUrl, `/editorial/colaboradores/${contributor.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { nombre_legal: renamed },
      }), 200, "renombrar colaborador maestro");
      contract = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/contratos/${contract.id}`,
        { token: supervisor.token }
      ), 200, "leer snapshot de contrato");
      assert.equal(contract.colaborador_nombre, originalName);
      assert.equal(contract.colaborador_nombre_actual, renamed);
    });

    await t.test("activa contrato y avanza el flujo editorial con transiciones únicas", async () => {
      const activeKey = randomUUID();
      const activate = () => post(
        baseUrl,
        `/editorial/contratos/${contract.id}/transiciones`,
        admin.token,
        { estado: "VIGENTE", motivo: "Contrato firmado por ambas partes" },
        activeKey
      );
      const responses = await Promise.all([activate(), activate()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      contract = responses[0].body;
      assert.equal(contract.estado, "VIGENTE");
      assert.equal(contract.transiciones.filter((row) => row.estado_nuevo === "VIGENTE").length, 1);

      expectStatus(await apiRequest(
        baseUrl,
        `/editorial/contratos/${contract.id}`,
        {
          method: "PATCH",
          token: supervisor.token,
          body: { notas: "Cambio no autorizado" },
        }
      ), 403, "supervisor modifica contrato");
      expectStatus(await apiRequest(
        baseUrl,
        `/editorial/contratos/${contract.id}`,
        {
          method: "PATCH",
          token: admin.token,
          body: { porcentaje_regalia: 20 },
        }
      ), 409, "cambiar términos activados");
      await assert.rejects(
        pool.query(
          `UPDATE contratos_editoriales SET derechos='Alterados' WHERE id=$1`,
          [contract.id]
        ),
        (error) => error.code === "55000"
      );

      const currentWork = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/obras/${work.id}`,
        { token: supervisor.token }
      ), 200, "recargar obra");
      const linkId = currentWork.colaboradores[0].id;
      expectStatus(await apiRequest(
        baseUrl,
        `/editorial/obras/${work.id}/colaboradores/${linkId}`,
        { method: "DELETE", token: supervisor.token }
      ), 409, "retirar colaborador contratado");

      for (const state of ["CONTRATADA", "EDICION", "DISENO", "IMPRESION", "PUBLICADA"]) {
        work = expectStatus(await transitionWork(
          baseUrl,
          supervisor.token,
          work.id,
          state
        ), 201, `avanzar obra a ${state}`);
        assert.equal(work.estado, state);
      }
      assert.deepEqual(work.transiciones.map((row) => row.estado_nuevo), [
        "PROPUESTA", "EVALUACION", "CONTRATADA", "EDICION",
        "DISENO", "IMPRESION", "PUBLICADA",
      ]);

      expectStatus(await post(
        baseUrl,
        `/editorial/obras/${work.id}/ediciones/${product.id}/desvinculacion`,
        supervisor.token,
        { motivo: "Intento de retiro posterior" }
      ), 409, "desvincular edición publicada");
      await pool.query(`SELECT validar_obra_editorial_conciliada($1)`, [work.id]);
      await pool.query(`SELECT validar_contrato_editorial_conciliado($1)`, [contract.id]);
      await pool.query(`SELECT validar_producto_obra_conciliado($1)`, [product.id]);
    });

    await t.test("lista, filtra, archiva y conserva auditoría inmutable", async () => {
      const list = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/obras?estado=PUBLICADA&q=${encodeURIComponent(work.folio)}`,
        { token: supervisor.token }
      ), 200, "filtrar obras publicadas");
      assert.equal(list.obras.length, 1);
      assert.equal(number(list.obras[0].id), number(work.id));

      const contracts = expectStatus(await apiRequest(
        baseUrl,
        `/editorial/contratos?estado=VIGENTE&obra_editorial_id=${work.id}`,
        { token: supervisor.token }
      ), 200, "filtrar contratos vigentes");
      assert.equal(contracts.contratos.length, 1);
      assert.equal(number(contracts.contratos[0].id), number(contract.id));

      work = expectStatus(await transitionWork(
        baseUrl,
        supervisor.token,
        work.id,
        "ARCHIVADA",
        { reason: "Cierre del ciclo editorial" }
      ), 201, "archivar obra");
      assert.equal(work.estado, "ARCHIVADA");
      expectStatus(await apiRequest(baseUrl, `/editorial/obras/${work.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { notas: "No debe cambiar" },
      }), 409, "editar obra archivada");

      await assert.rejects(
        pool.query(
          `DELETE FROM contrato_editorial_transiciones WHERE contrato_editorial_id=$1`,
          [contract.id]
        ),
        (error) => error.code === "55000"
      );
      await assert.rejects(
        pool.query(
          `DELETE FROM producto_obra_editorial_historial WHERE producto_id=$1`,
          [product.id]
        ),
        (error) => error.code === "55000"
      );
    });
  } finally {
    await environment.cleanup();
  }
});
