const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "CatalogoImportSeguro!2026";
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

async function rawRequest(baseUrl, pathName, {
  token,
  content,
  contentType = "text/csv; charset=utf-8",
} = {}) {
  const response = await fetch(baseUrl + pathName, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: content,
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body };
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
    [label, `${label}@catalog-import.tests`, passwordHash, role]
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

async function createCategory(baseUrl, token) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/categorias", {
    method: "POST",
    token,
    body: {
      nombre: `Ciencia editorial ${suffix}`,
      slug: `ciencia-editorial-${suffix}`,
      descripcion: "Categoría bibliográfica para pruebas.",
      orden: suffix,
    },
  }), 201, "crear categoría bibliográfica");
}

async function createProduct(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `BIB-${suffix}`,
      titulo: `Libro bibliográfico ${suffix}`,
      precio: 100,
      costo: 40,
      stock: 0,
      iva: 0,
      ...overrides,
    },
  }), 201, "crear producto bibliográfico");
}

function csvLine(values) {
  return values.map((value) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",");
}

function csvDocument(headers, rows) {
  return [csvLine(headers), ...rows.map(csvLine)].join("\r\n") + "\r\n";
}

function previewPath(name) {
  const query = new URLSearchParams({ nombre_archivo: name, modo: "CREAR_Y_ACTUALIZAR" });
  return `/productos/importaciones/previsualizar?${query}`;
}

function confirmRequest(baseUrl, token, preview, {
  key = randomUUID(),
  acknowledgeRejected = false,
  hash = preview.importacion.hash_sha256,
} = {}) {
  return apiRequest(
    baseUrl,
    `/productos/importaciones/${preview.importacion.id}/confirmar`,
    {
      method: "POST",
      token,
      idempotencyKey: key,
      body: {
        hash_sha256: hash,
        confirmar_omision_rechazadas: acknowledgeRejected,
      },
    }
  );
}

test("catálogo bibliográfico e importación CSV transaccional", { timeout: 240000 }, async (t) => {
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
    const category = await createCategory(baseUrl, admin.token);

    let publishedProduct;
    let unchangedProduct;

    await t.test("valida ISBN y conserva relaciones bibliográficas compartidas", async () => {
      expectStatus(await apiRequest(baseUrl, "/productos", {
        method: "POST",
        token: admin.token,
        body: {
          sku: `ISBN-MALO-${++sequence}`,
          isbn: "9780306406158",
          titulo: "ISBN con dígito incorrecto",
          precio: 10,
        },
      }), 400, "rechazar ISBN inválido");

      publishedProduct = await createProduct(baseUrl, admin.token, {
        sku: `ATLAS-${++sequence}`,
        codigo_barras: `750100${sequence}`,
        isbn: "978-0-306-40615-7",
        titulo: "Atlas del universo",
        subtitulo: "Guía ilustrada",
        editorial: "Editorial REM",
        categoria_id: number(category.id),
        edicion: "2.ª edición",
        anio_publicacion: 2026,
        idioma: "Español",
        numero_paginas: 320,
        encuadernacion: "Pasta dura",
        formato: "Impreso",
        coleccion: "Ciencia para todos",
        serie: "Astronomía",
        volumen: "1",
        contribuyentes: [
          { nombre: "Ana Torres", rol: "AUTOR", orden: 0 },
          { nombre: "Luis Vega", rol: "AUTOR", orden: 1 },
          { nombre: "Elena Sol", rol: "TRADUCTOR", orden: 2 },
          { nombre: "Mara Luz", rol: "ILUSTRADOR", orden: 3 },
        ],
        materias: [{ nombre: "Astronomía" }, { nombre: "Divulgación científica" }],
        precio: 480,
        costo: 210,
        stock: 7,
        iva: 0,
        slug: `atlas-universo-${sequence}`,
        descripcion_comercial: "Atlas ilustrado para lectores de todas las edades.",
      });
      assert.equal(publishedProduct.isbn_normalizado, "9780306406157");
      assert.equal(publishedProduct.autor, "Ana Torres; Luis Vega");
      assert.equal(publishedProduct.contribuyentes.length, 4);
      assert.equal(publishedProduct.materias.length, 2);

      const scanned = expectStatus(await apiRequest(
        baseUrl,
        "/productos/buscar?codigo=9780306406157",
        { token: cashier.token }
      ), 200, "buscar por ISBN normalizado");
      assert.equal(number(scanned.id), number(publishedProduct.id));
      assert.equal(Object.hasOwn(scanned, "costo"), false);
      assert.equal(scanned.contribuyentes.length, 4);

      const searched = expectStatus(await apiRequest(
        baseUrl,
        `/productos?q=${encodeURIComponent("Elena Sol")}`,
        { token: cashier.token }
      ), 200, "buscar por traductora");
      assert.ok(searched.resultados.some((item) => number(item.id) === number(publishedProduct.id)));

      const image = expectStatus(await apiRequest(
        baseUrl,
        `/productos/${publishedProduct.id}/imagenes`,
        {
          method: "POST",
          token: admin.token,
          body: {
            url: `https://images.example.test/atlas-${publishedProduct.id}.jpg`,
            texto_alternativo: "Portada del Atlas del universo",
            orden: 0,
            principal: true,
          },
        }
      ), 201, "agregar portada");
      assert.ok(image.id);
      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}/publicacion`, {
        method: "PATCH",
        token: admin.token,
        body: { publicado_web: true },
      }), 200, "publicar ficha bibliográfica");

      const publicList = expectStatus(await apiRequest(
        baseUrl,
        `/tienda/productos?q=${encodeURIComponent("Divulgación científica")}`
      ), 200, "buscar materia en tienda");
      const publicItem = publicList.resultados.find(
        (item) => number(item.id) === number(publishedProduct.id)
      );
      assert.ok(publicItem);
      assert.equal(publicItem.subtitulo, "Guía ilustrada");
      assert.equal(publicItem.isbn_normalizado, "9780306406157");
      assert.equal(publicItem.contribuyentes.length, 4);
      assert.equal(publicItem.materias.length, 2);

      const publicDetail = expectStatus(await apiRequest(
        baseUrl,
        `/tienda/productos/${publishedProduct.slug}`
      ), 200, "detalle bibliográfico público");
      assert.equal(number(publicDetail.numero_paginas), 320);
      assert.equal(publicDetail.encuadernacion, "Pasta dura");
      assert.equal(publicDetail.imagenes.length, 1);

      unchangedProduct = await createProduct(baseUrl, supervisor.token, {
        sku: `SIN-CAMBIOS-${++sequence}`,
        titulo: "Producto sin cambios",
        precio: 75,
        costo: 25,
        stock: 2,
        iva: 0,
      });
    });

    let mainPreview;
    let mainCsv;
    let inventoryBefore;
    let movementCountBefore;
    const importSku = `IMPORTADO-${++sequence}`;
    const rejectedSku = `RECHAZADO-${++sequence}`;

    await t.test("previsualiza y persiste crear, actualizar, omitir y rechazar sin mutar catálogo", async () => {
      const headers = [
        "sku", "codigo_barras", "isbn", "titulo", "subtitulo", "autores",
        "traductores", "ilustradores", "editores", "editorial", "categoria_slug",
        "edicion", "anio_publicacion", "idioma", "numero_paginas", "encuadernacion",
        "formato", "coleccion", "serie", "volumen", "materias", "precio", "costo",
        "iva", "descripcion_comercial",
      ];
      mainCsv = csvDocument(headers, [
        [
          publishedProduct.sku, "", "", "Atlas del universo actualizado", "Edición ampliada",
          "Irene Mar | Pablo Cielo", "Elena Sol", "Mara Luz", "Editor REM",
          "Editorial REM", category.slug, "3.ª edición", "2027", "Español", "360",
          "Pasta dura", "Impreso", "Ciencia para todos", "Astronomía", "2",
          "Astronomía | Cosmología", "520", "230", "0", "Descripción comercial importada.",
        ],
        [
          importSku, `750200${sequence}`, "9783161484100", "Manual, de edición independiente",
          "De manuscrito a libro", "Clara Texto", "", "Nora Tinta", "",
          "Librería REM Editorial", category.slug, "1.ª edición", "2026", "Español", "240",
          "Pasta blanda", "Impreso", "Oficio editorial", "Producción", "1",
          "Edición | Publicación", "280", "90", "0", "Guía práctica de producción editorial.",
        ],
        [unchangedProduct.sku, "", "", unchangedProduct.titulo, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "75", "", "", ""],
        [rejectedSku, "", "9780306406158", "ISBN rechazado", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "50", "", "", ""],
      ]);

      expectStatus(await rawRequest(baseUrl, previewPath("sin-token.csv"), {
        content: mainCsv,
      }), 401, "previsualización sin autenticación");
      expectStatus(await rawRequest(baseUrl, previewPath("cajero.csv"), {
        token: cashier.token,
        content: mainCsv,
      }), 403, "previsualización por cajero");
      expectStatus(await rawRequest(baseUrl, previewPath("tipo-incorrecto.csv"), {
        token: admin.token,
        content: mainCsv,
        contentType: "text/plain; charset=utf-8",
      }), 415, "tipo de contenido incorrecto");
      expectStatus(await rawRequest(baseUrl, previewPath("stock-prohibido.csv"), {
        token: admin.token,
        content: "sku,titulo,precio,stock\r\nPROHIBIDO,Producto,10,5\r\n",
      }), 400, "rechazar columna de inventario");

      inventoryBefore = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible, publicado_web, slug
         FROM productos WHERE id=$1`,
        [publishedProduct.id]
      )).rows[0];
      movementCountBefore = number((await pool.query(
        `SELECT COUNT(*) FROM inventario_movimientos WHERE producto_id=$1`,
        [publishedProduct.id]
      )).rows[0].count);

      mainPreview = expectStatus(await rawRequest(
        baseUrl,
        previewPath("catalogo-principal.csv"),
        { token: admin.token, content: mainCsv }
      ), 201, "previsualizar catálogo");
      assert.deepEqual(mainPreview.resumen, {
        filas_total: 4,
        crear: 1,
        actualizar: 1,
        sin_cambios: 1,
        rechazadas: 1,
      });
      assert.equal(mainPreview.filas.total, 4);
      assert.equal(mainPreview.filas.resultados.length, 4);
      assert.ok(mainPreview.importacion.hash_sha256.match(/^[0-9a-f]{64}$/u));

      const storedCreate = (await pool.query(
        `SELECT producto_objetivo_id, objetivo_hash
         FROM catalogo_importacion_filas
         WHERE importacion_id=$1 AND accion_prevista='CREAR'`,
        [mainPreview.importacion.id]
      )).rows[0];
      assert.equal(storedCreate.producto_objetivo_id, null);
      assert.equal(storedCreate.objetivo_hash, null);

      const unchangedCurrent = (await pool.query(
        `SELECT titulo, precio, stock, publicado_web FROM productos WHERE id=$1`,
        [publishedProduct.id]
      )).rows[0];
      assert.equal(unchangedCurrent.titulo, "Atlas del universo");
      assert.equal(number(unchangedCurrent.precio), 480);
      assert.equal(number(unchangedCurrent.stock), number(inventoryBefore.stock));
      assert.equal(unchangedCurrent.publicado_web, true);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM productos WHERE sku=$1`, [importSku]
      )).rows[0].count), 0);

      const rejectedPage = expectStatus(await apiRequest(
        baseUrl,
        `/productos/importaciones/${mainPreview.importacion.id}/filas?resultado=RECHAZAR&page=1&limit=50`,
        { token: admin.token }
      ), 200, "filtrar filas rechazadas");
      assert.equal(rejectedPage.total, 1);
      assert.equal(rejectedPage.resultados[0].sku, rejectedSku);
      assert.ok(rejectedPage.resultados[0].errores.some((item) => item.codigo === "ISBN_INVALIDO"));

      expectStatus(await apiRequest(
        baseUrl,
        `/productos/importaciones/${mainPreview.importacion.id}/filas`,
        { token: supervisor.token }
      ), 404, "aislar previsualización por usuario");

      await assert.rejects(
        pool.query(
          `UPDATE catalogo_importacion_filas SET numero_fila=99
           WHERE importacion_id=$1 AND numero_fila=2`,
          [mainPreview.importacion.id]
        ),
        (error) => error.code === "55000"
      );
    });

    await t.test("confirma atómicamente, conserva inventario/publicación y hace replay idempotente", async () => {
      expectStatus(await confirmRequest(baseUrl, admin.token, mainPreview), 400, "exigir omisión explícita");
      expectStatus(await apiRequest(
        baseUrl,
        `/productos/importaciones/${mainPreview.importacion.id}/confirmar`,
        {
          method: "POST",
          token: admin.token,
          body: {
            hash_sha256: mainPreview.importacion.hash_sha256,
            confirmar_omision_rechazadas: true,
          },
        }
      ), 400, "exigir Idempotency-Key");

      const key = randomUUID();
      const applied = expectStatus(await confirmRequest(baseUrl, admin.token, mainPreview, {
        key,
        acknowledgeRejected: true,
      }), 201, "confirmar importación");
      assert.equal(applied.importacion.estado, "APLICADA");
      assert.deepEqual(applied.resumen, mainPreview.resumen);

      const updated = expectStatus(await apiRequest(
        baseUrl,
        `/productos/${publishedProduct.id}`,
        { token: admin.token }
      ), 200, "leer producto importado");
      assert.equal(updated.titulo, "Atlas del universo actualizado");
      assert.equal(updated.isbn_normalizado, "9780306406157");
      assert.equal(updated.autor, "Irene Mar; Pablo Cielo");
      assert.deepEqual(
        updated.contribuyentes.filter((item) => item.rol === "AUTOR").map((item) => item.nombre),
        ["Irene Mar", "Pablo Cielo"]
      );
      assert.ok(updated.materias.some((item) => item.nombre === "Cosmología"));
      assert.equal(number(updated.stock), number(inventoryBefore.stock));
      assert.equal(number(updated.stock_reservado), number(inventoryBefore.stock_reservado));
      assert.equal(number(updated.stock_disponible), number(inventoryBefore.stock_disponible));
      assert.equal(updated.publicado_web, inventoryBefore.publicado_web);
      assert.equal(updated.slug, inventoryBefore.slug);
      assert.equal(updated.imagenes.length, 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM inventario_movimientos WHERE producto_id=$1`,
        [publishedProduct.id]
      )).rows[0].count), movementCountBefore);

      const created = (await pool.query(
        `SELECT * FROM productos WHERE sku=$1`, [importSku]
      )).rows[0];
      assert.ok(created);
      assert.equal(created.isbn_normalizado, "9783161484100");
      assert.equal(number(created.stock), 0);
      assert.equal(number(created.stock_reservado), 0);
      assert.equal(created.publicado_web, false);
      assert.equal(created.slug, null);
      assert.equal(created.activo, true);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM inventario_movimientos WHERE producto_id=$1`,
        [created.id]
      )).rows[0].count), 0);

      const results = await pool.query(
        `SELECT resultado, producto_id, errores
         FROM catalogo_importacion_resultados
         WHERE importacion_id=$1 ORDER BY id`,
        [mainPreview.importacion.id]
      );
      assert.deepEqual(results.rows.map((row) => row.resultado), [
        "ACTUALIZADO", "CREADO", "SIN_CAMBIOS", "RECHAZADO",
      ]);
      assert.equal(results.rows[3].producto_id, null);
      assert.ok(results.rows[3].errores.length > 0);

      const replay = expectStatus(await confirmRequest(baseUrl, admin.token, mainPreview, {
        key,
        acknowledgeRejected: true,
      }), 200, "replay idempotente");
      assert.equal(number(replay.importacion.id), number(mainPreview.importacion.id));
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM productos WHERE sku=$1`, [importSku]
      )).rows[0].count), 1);

      expectStatus(await confirmRequest(baseUrl, admin.token, mainPreview, {
        key,
        acknowledgeRejected: false,
      }), 409, "rechazar reutilización con payload distinto");

      const secondKey = expectStatus(await confirmRequest(baseUrl, admin.token, mainPreview, {
        key: randomUUID(),
        acknowledgeRejected: true,
      }), 200, "confirmación ya aplicada con nueva clave");
      assert.equal(secondKey.importacion.estado, "APLICADA");
    });

    await t.test("detecta deriva y revierte toda la confirmación", async () => {
      const rollbackSku = `ROLLBACK-${++sequence}`;
      const driftCsv = csvDocument(["sku", "titulo", "precio"], [
        [rollbackSku, "Producto que debe revertirse", "60"],
        [unchangedProduct.sku, "Cambio sujeto a deriva", "80"],
      ]);
      const preview = expectStatus(await rawRequest(
        baseUrl,
        previewPath("deriva.csv"),
        { token: supervisor.token, content: driftCsv }
      ), 201, "previsualizar operación con deriva");
      assert.equal(preview.resumen.crear, 1);
      assert.equal(preview.resumen.actualizar, 1);

      expectStatus(await apiRequest(baseUrl, `/productos/${unchangedProduct.id}`, {
        method: "PATCH",
        token: admin.token,
        body: { titulo: "Cambio concurrente posterior" },
      }), 200, "cambiar objetivo después de previsualizar");

      expectStatus(await confirmRequest(baseUrl, supervisor.token, preview, {
        key: randomUUID(),
      }), 409, "rechazar snapshot obsoleto");
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM productos WHERE sku=$1`, [rollbackSku]
      )).rows[0].count), 0);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM catalogo_importacion_resultados WHERE importacion_id=$1`,
        [preview.importacion.id]
      )).rows[0].count), 0);
      assert.equal((await pool.query(
        `SELECT estado FROM catalogo_importaciones WHERE id=$1`,
        [preview.importacion.id]
      )).rows[0].estado, "PREVISUALIZADA");
    });

    await t.test("serializa dos confirmaciones concurrentes con la misma clave", async () => {
      const concurrentSku = `CONCURRENTE-${++sequence}`;
      const concurrentCsv = csvDocument(["sku", "isbn", "titulo", "precio"], [
        [concurrentSku, "0306406152", "Producto concurrente", "95"],
      ]);
      const preview = expectStatus(await rawRequest(
        baseUrl,
        previewPath("concurrencia.csv"),
        { token: admin.token, content: concurrentCsv }
      ), 201, "previsualizar creación concurrente");
      const key = randomUUID();
      const responses = await Promise.all([
        confirmRequest(baseUrl, admin.token, preview, { key }),
        confirmRequest(baseUrl, admin.token, preview, { key }),
      ]);
      assert.deepEqual(responses.map((item) => item.status).sort(), [200, 201]);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM productos WHERE sku=$1`, [concurrentSku]
      )).rows[0].count), 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM catalogo_importacion_resultados WHERE importacion_id=$1`,
        [preview.importacion.id]
      )).rows[0].count), 1);
      assert.equal(number((await pool.query(
        `SELECT COUNT(*) FROM operaciones_idempotentes
         WHERE usuario_id=$1 AND operacion='IMPORTACION_CATALOGO' AND clave=$2`,
        [admin.id, key]
      )).rows[0].count), 1);
    });
  } finally {
    await environment.cleanup();
  }
});
