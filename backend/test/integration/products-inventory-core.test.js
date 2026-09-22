const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "ProductosSeguros!2026";
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
     SELECT $1, $2, $3, id FROM roles WHERE nombre=$4
     RETURNING id, nombre, email`,
    [label, `${label}@products.tests`, passwordHash, role]
  );
  return result.rows[0];
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`);
  assert.ok(body.token);
  return body.token;
}

async function createProduct(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `B3-${suffix}`,
      titulo: `Libro Bloque 3 ${suffix}`,
      precio: 100,
      costo: 40,
      stock: 0,
      iva: 0,
      ...overrides,
    },
  }), 201, `crear producto ${suffix}`);
}

test("productos e inventario básico verificados de extremo a extremo", { timeout: 120000 }, async (t) => {
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

    await t.test("rechaza acceso, datos y parámetros inválidos sin producir errores internos", async () => {
      expectStatus(await apiRequest(baseUrl, "/productos"), 401, "listado sin sesión");
      expectStatus(await apiRequest(baseUrl, "/productos", {
        method: "POST",
        token: cashier.token,
        body: { sku: "DENEGADO", titulo: "Sin permiso", precio: 10 },
      }), 403, "alta por cajero");

      const invalidBodies = [
        { sku: "   ", titulo: "Título válido", precio: 10 },
        { sku: "SKU-VALIDO", titulo: "   ", precio: 10 },
        { sku: "PRECIO-3D", titulo: "Tres decimales", precio: 10.001 },
        { sku: "COSTO-3D", titulo: "Costo inválido", precio: 10, costo: 1.999 },
        { sku: "IVA-3D", titulo: "IVA inválido", precio: 10, iva: 16.999 },
        { sku: "STOCK-NEG", titulo: "Stock inválido", precio: 10, stock: -1 },
      ];
      for (const body of invalidBodies) {
        expectStatus(await apiRequest(baseUrl, "/productos", {
          method: "POST", token: supervisor.token, body,
        }), 400, `alta inválida ${body.sku}`);
      }

      for (const path of [
        "/productos?limit=-1",
        "/productos?page=abc",
        "/productos?categoria_id=xyz",
        `/productos?q=${encodeURIComponent("x".repeat(161))}`,
        "/productos/buscar?codigo=",
      ]) {
        expectStatus(await apiRequest(baseUrl, path, { token: cashier.token }), 400, `consulta inválida ${path}`);
      }
    });

    let product;
    let emptyProduct;
    await t.test("crea, persiste, consulta y busca por SKU, código, ISBN y texto", async () => {
      product = await createProduct(baseUrl, supervisor.token, {
        sku: "  REM-B3-PRINCIPAL  ",
        codigo_barras: "  7501234567890  ",
        isbn: "  978-0-306-40615-7  ",
        titulo: "  Atlas editorial REM  ",
        editorial: "  Ediciones del Centro  ",
        precio: 125.5,
        costo: 65.25,
        stock: 3,
      });
      assert.equal(product.sku, "REM-B3-PRINCIPAL");
      assert.equal(product.codigo_barras, "7501234567890");
      assert.equal(product.isbn, "978-0-306-40615-7");
      assert.equal(product.isbn_normalizado, "9780306406157");
      assert.equal(product.titulo, "Atlas editorial REM");
      assert.equal(product.editorial, "Ediciones del Centro");
      assert.equal(number(product.precio), 125.5);
      assert.equal(number(product.costo), 65.25);
      assert.equal(number(product.stock), 3);
      assert.equal(number(product.stock_reservado), 0);
      assert.equal(number(product.stock_disponible), 3);

      const movements = (await pool.query(
        `SELECT * FROM inventario_movimientos WHERE producto_id=$1 ORDER BY id`,
        [product.id]
      )).rows;
      assert.equal(movements.length, 1);
      assert.equal(movements[0].tipo, "AJUSTE");
      assert.equal(number(movements[0].delta_fisico), 3);
      assert.equal(number(movements[0].usuario_id), number(supervisor.id));
      assert.equal(number(movements[0].stock_fisico_resultante), 3);

      for (const code of [product.sku, product.codigo_barras, product.isbn_normalizado]) {
        const scanned = expectStatus(await apiRequest(
          baseUrl,
          `/productos/buscar?codigo=${encodeURIComponent(code)}`,
          { token: cashier.token }
        ), 200, `búsqueda exacta ${code}`);
        assert.equal(number(scanned.id), number(product.id));
        assert.equal(Object.hasOwn(scanned, "costo"), false);
      }

      for (const term of ["b3-prin", "123456", "ediciones del", "atlas editorial"]) {
        const result = expectStatus(await apiRequest(
          baseUrl,
          `/productos?q=${encodeURIComponent(term)}`,
          { token: cashier.token }
        ), 200, `búsqueda general ${term}`);
        assert.ok(result.resultados.some((item) => number(item.id) === number(product.id)));
        assert.ok(result.resultados.every((item) => !Object.hasOwn(item, "costo")));
      }

      const literalWildcard = expectStatus(await apiRequest(
        baseUrl, "/productos?q=%25", { token: cashier.token }
      ), 200, "porcentaje como texto literal");
      assert.equal(literalWildcard.resultados.length, 0);

      emptyProduct = await createProduct(baseUrl, supervisor.token, {
        sku: "REM-B3-SIN-STOCK",
        codigo_barras: "7500000000001",
        titulo: "Libro agotado consultable",
        stock: 0,
      });
      const availability = expectStatus(await apiRequest(
        baseUrl,
        `/inventario/existencias?producto_id=${emptyProduct.id}`,
        { token: cashier.token }
      ), 200, "consulta de producto sin stock");
      assert.equal(availability.length, 1);
      assert.equal(number(availability[0].fisico), 0);
      assert.equal(number(availability[0].disponible), 0);
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventario_movimientos WHERE producto_id=$1`,
        [emptyProduct.id]
      )).rows[0].n, 0);
    });

    await t.test("edita la ficha sin alterar existencias ni kardex y protege identidades", async () => {
      const before = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible, actualizado_en
         FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      const movementCount = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventario_movimientos WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n;

      const updated = expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
        method: "PATCH",
        token: admin.token,
        body: { titulo: "  Atlas editorial REM, edición revisada  ", precio: 130.75 },
      }), 200, "edición de producto");
      assert.equal(updated.titulo, "Atlas editorial REM, edición revisada");
      assert.equal(number(updated.precio), 130.75);
      assert.equal(number(updated.stock), 3);

      const after = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible, actualizado_en
         FROM productos WHERE id=$1`,
        [product.id]
      )).rows[0];
      assert.equal(number(after.stock), number(before.stock));
      assert.equal(number(after.stock_reservado), number(before.stock_reservado));
      assert.equal(number(after.stock_disponible), number(before.stock_disponible));
      assert.ok(new Date(after.actualizado_en) >= new Date(before.actualizado_en));
      assert.equal((await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventario_movimientos WHERE producto_id=$1`,
        [product.id]
      )).rows[0].n, movementCount);

      expectStatus(await apiRequest(baseUrl, `/productos/${product.id}`, {
        method: "PATCH", token: supervisor.token, body: { stock: 99 },
      }), 400, "edición directa de stock");
      assert.equal(number((await pool.query(
        `SELECT stock FROM productos WHERE id=$1`, [product.id]
      )).rows[0].stock), 3);

      expectStatus(await apiRequest(baseUrl, "/productos", {
        method: "POST",
        token: supervisor.token,
        body: {
          sku: "REM-B3-CODIGO-DUP",
          codigo_barras: product.codigo_barras,
          titulo: "Código repetido",
          precio: 10,
        },
      }), 409, "código de barras duplicado");
      expectStatus(await apiRequest(baseUrl, "/productos", {
        method: "POST",
        token: supervisor.token,
        body: {
          sku: "REM-B3-ISBN-DUP",
          isbn: "9780306406157",
          titulo: "ISBN repetido",
          precio: 10,
        },
      }), 409, "ISBN normalizado duplicado");
    });

    await t.test("impide datos inválidos también en PostgreSQL", async () => {
      await assert.rejects(
        pool.query(
          `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
           VALUES ('   ', 'Título directo', 10, 0, 0, 0, TRUE)`
        ),
        (error) => error.code === "23514"
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO productos (sku, titulo, precio, costo, stock, iva, activo)
           VALUES ($1, '   ', 10, 0, 0, 0, TRUE)`,
          [nextLabel("DB-TITULO")]
        ),
        (error) => error.code === "23514"
      );
      await assert.rejects(
        pool.query(`UPDATE productos SET precio=1000000 WHERE id=$1`, [product.id]),
        (error) => error.code === "23514"
      );
      assert.equal(number((await pool.query(
        `SELECT precio FROM productos WHERE id=$1`, [product.id]
      )).rows[0].precio), 130.75);
    });

    await t.test("serializa ajustes concurrentes y nunca deja stock negativo", async () => {
      const lastUnit = await createProduct(baseUrl, supervisor.token, {
        sku: "REM-B3-ULTIMA-UNIDAD",
        titulo: "Última unidad concurrente",
        stock: 1,
      });
      const adjust = () => apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: supervisor.token,
        idempotencyKey: randomUUID(),
        body: {
          producto_id: number(lastUnit.id),
          delta: -1,
          motivo: "Conteo concurrente verificado",
        },
      });
      const responses = await Promise.all([adjust(), adjust()]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);

      const balance = (await pool.query(
        `SELECT stock, stock_reservado, stock_disponible
         FROM productos WHERE id=$1`,
        [lastUnit.id]
      )).rows[0];
      assert.deepEqual(
        Object.fromEntries(Object.entries(balance).map(([key, value]) => [key, number(value)])),
        { stock: 0, stock_reservado: 0, stock_disponible: 0 }
      );
      const negativeMovements = (await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM inventario_movimientos
         WHERE producto_id=$1 AND tipo='AJUSTE' AND delta_fisico=-1`,
        [lastUnit.id]
      )).rows[0].n;
      assert.equal(negativeMovements, 1);

      expectStatus(await apiRequest(baseUrl, "/inventario/ajustes", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: randomUUID(),
        body: { producto_id: number(emptyProduct.id), delta: 1, motivo: "Sin permiso" },
      }), 403, "ajuste por cajero");
    });

    const reconciliation = await pool.query(
      `SELECT COUNT(*)::int AS inconsistentes
       FROM inventario_conciliacion WHERE NOT conciliado`
    );
    assert.equal(reconciliation.rows[0].inconsistentes, 0);
  } finally {
    await environment.cleanup();
  }
});
