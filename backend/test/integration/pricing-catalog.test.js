const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const TEST_PASSWORD = "CatalogoSeguro!2026";
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

function quoteLine(body, context) {
  assert.ok(Array.isArray(body.lineas), `${context}: la cotización no contiene líneas`);
  assert.equal(body.lineas.length, 1, `${context}: se esperaba una línea`);
  return body.lineas[0];
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
    [label, `${label}@pricing.tests`, passwordHash, role]
  );
  return { ...result.rows[0], role };
}

async function login(baseUrl, user) {
  const body = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: user.email, password: TEST_PASSWORD },
  }), 200, `login ${user.email}`);
  assert.ok(body.token);
  return body.token;
}

async function createCategory(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/categorias", {
    method: "POST",
    token,
    body: {
      nombre: `Categoría ${suffix}`,
      slug: `categoria-${suffix}`,
      descripcion: "Categoría para pruebas de integración.",
      orden: suffix,
      ...overrides,
    },
  }), 201, "crear categoría");
}

async function createProduct(baseUrl, token, overrides = {}) {
  const suffix = ++sequence;
  return expectStatus(await apiRequest(baseUrl, "/productos", {
    method: "POST",
    token,
    body: {
      sku: `PC-${suffix}`,
      titulo: `Libro catálogo ${suffix}`,
      precio: 100,
      costo: 40,
      stock: 20,
      iva: 16,
      slug: `libro-catalogo-${suffix}`,
      descripcion_comercial: "Descripción comercial inicial.",
      ...overrides,
    },
  }), 201, "crear producto comercial");
}

async function createRule(baseUrl, token, body, context = "crear regla") {
  return expectStatus(await apiRequest(baseUrl, "/precios/reglas", {
    method: "POST",
    token,
    body,
  }), 201, context);
}

async function quote(baseUrl, token, productId, quantity, channel = "POS") {
  return expectStatus(await apiRequest(baseUrl, "/precios/cotizar", {
    method: "POST",
    token,
    body: {
      canal: channel,
      items: [{ producto_id: number(productId), cantidad: quantity }],
    },
  }), 200, `cotización ${channel}`);
}

async function openRegister(pool, baseUrl, cashier) {
  const register = (await pool.query(
    `INSERT INTO caja (nombre, activo) VALUES ($1, TRUE) RETURNING *`,
    [nextLabel("Caja-precios")]
  )).rows[0];
  const session = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST",
    token: cashier.token,
    body: { caja_id: number(register.id), fondo_inicial: 100 },
  }), 201, "abrir caja para venta con regla");
  return { register, session: session.sesion || session };
}

test("catálogo comercial y motor de precios compartido", { timeout: 120000 }, async (t) => {
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

    let pricingCategory;
    let publishedProduct;
    let webRule;
    let quantityRule;
    let highPriorityRule;
    let firstProductRule;

    await t.test("aplica RBAC y CRUD con baja lógica a categorías", async () => {
      expectStatus(await apiRequest(baseUrl, "/categorias"), 401, "categorías sin autenticación");
      expectStatus(await apiRequest(baseUrl, "/categorias", {
        method: "POST",
        token: cashier.token,
        body: { nombre: "No autorizada", slug: "no-autorizada" },
      }), 403, "alta de categoría por cajero");

      const suffix = ++sequence;
      const category = await createCategory(baseUrl, supervisor.token, {
        nombre: `Temporal ${suffix}`,
        slug: `temporal-${suffix}`,
        orden: 9,
      });
      const fetched = expectStatus(await apiRequest(
        baseUrl, `/categorias/${category.id}`, { token: cashier.token }
      ), 200, "detalle de categoría");
      assert.equal(fetched.slug, `temporal-${suffix}`);

      expectStatus(await apiRequest(baseUrl, "/categorias", {
        method: "POST",
        token: admin.token,
        body: {
          nombre: `TEMPORAL ${suffix}`,
          slug: `temporal-duplicada-${suffix}`,
        },
      }), 409, "nombre de categoría duplicado sin distinguir mayúsculas");

      const updated = expectStatus(await apiRequest(baseUrl, `/categorias/${category.id}`, {
        method: "PATCH",
        token: admin.token,
        body: { descripcion: "Descripción actualizada.", orden: 2 },
      }), 200, "actualizar categoría");
      assert.equal(updated.descripcion, "Descripción actualizada.");
      assert.equal(number(updated.orden), 2);

      const removed = expectStatus(await apiRequest(baseUrl, `/categorias/${category.id}`, {
        method: "DELETE",
        token: supervisor.token,
      }), 200, "desactivar categoría");
      assert.equal(removed.activo, false);

      const active = expectStatus(await apiRequest(baseUrl, "/categorias", {
        token: cashier.token,
      }), 200, "listar categorías activas");
      assert.equal(active.some((item) => number(item.id) === number(category.id)), false);
      const all = expectStatus(await apiRequest(
        baseUrl, "/categorias?incluir_inactivas=true", { token: cashier.token }
      ), 200, "listar categorías incluidas las inactivas");
      assert.ok(all.some((item) => number(item.id) === number(category.id) && !item.activo));

      pricingCategory = await createCategory(baseUrl, supervisor.token, {
        nombre: `Narrativa ${++sequence}`,
        slug: `narrativa-${sequence}`,
        orden: 1,
      });
    });

    await t.test("administra producto comercial, imágenes y publicación protegida", async () => {
      expectStatus(await apiRequest(baseUrl, "/productos", {
        method: "POST",
        token: cashier.token,
        body: {
          sku: `DENEGADO-${++sequence}`,
          titulo: "Producto no autorizado",
          precio: 100,
          stock: 1,
        },
      }), 403, "alta de producto por cajero");

      publishedProduct = await createProduct(baseUrl, supervisor.token, {
        categoria_id: number(pricingCategory.id),
      });
      assert.equal(publishedProduct.publicado_web, false);
      const commercial = expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}`, { token: cashier.token }
      ), 200, "detalle comercial");
      assert.equal(commercial.slug, publishedProduct.slug);
      assert.deepEqual(commercial.imagenes, []);

      const patched = expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { descripcion_comercial: "Edición comercial definitiva." },
      }), 200, "editar descripción comercial");
      assert.equal(patched.descripcion_comercial, "Edición comercial definitiva.");

      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}/publicacion`, {
        method: "PATCH",
        token: supervisor.token,
        body: { publicado_web: true },
      }), 409, "publicación sin imagen principal");
      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}/imagenes`, {
        method: "POST",
        token: supervisor.token,
        body: {
          url: "javascript:alert(1)",
          texto_alternativo: "URL insegura",
          orden: 0,
          principal: true,
        },
      }), 400, "rechazo de URL de imagen insegura");

      const principal = expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes`, {
          method: "POST",
          token: supervisor.token,
          body: {
            url: `https://images.example.test/${publishedProduct.id}-principal.jpg`,
            texto_alternativo: "Portada principal",
            orden: 0,
            principal: true,
          },
        }
      ), 201, "crear imagen principal");
      const secondary = expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes`, {
          method: "POST",
          token: supervisor.token,
          body: {
            url: `https://images.example.test/${publishedProduct.id}-segunda.jpg`,
            texto_alternativo: "Contraportada",
            orden: 1,
            principal: false,
          },
        }
      ), 201, "crear imagen secundaria");

      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${secondary.id}`, {
          method: "PATCH",
          token: supervisor.token,
          body: { principal: true },
        }
      ), 409, "impedir dos imágenes principales");

      const published = expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/publicacion`, {
          method: "PATCH",
          token: supervisor.token,
          body: { publicado_web: true },
        }
      ), 200, "publicar producto completo");
      assert.equal(published.publicado_web, true);
      assert.ok(published.publicado_en);

      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${principal.id}`, {
          method: "PATCH",
          token: supervisor.token,
          body: { principal: false },
        }
      ), 409, "proteger designación principal publicada");
      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${principal.id}`, {
          method: "DELETE",
          token: supervisor.token,
        }
      ), 409, "proteger eliminación principal publicada");

      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}/publicacion`, {
        method: "PATCH",
        token: supervisor.token,
        body: { publicado_web: false },
      }), 200, "despublicar para cambiar portada");
      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${principal.id}`, {
          method: "PATCH",
          token: supervisor.token,
          body: { principal: false },
        }
      ), 200, "retirar principal estando despublicado");
      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${secondary.id}`, {
          method: "PATCH",
          token: supervisor.token,
          body: { principal: true, texto_alternativo: "Nueva portada principal" },
        }
      ), 200, "promover imagen secundaria");
      expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}/imagenes/${principal.id}`, {
          method: "DELETE",
          token: supervisor.token,
        }
      ), 204, "eliminar imagen ya no principal");
      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}/publicacion`, {
        method: "PATCH",
        token: supervisor.token,
        body: { publicado_web: true },
      }), 200, "republicar con nueva portada");

      const finalProduct = expectStatus(await apiRequest(
        baseUrl, `/productos/${publishedProduct.id}`, { token: cashier.token }
      ), 200, "producto comercial final");
      assert.equal(finalProduct.publicado_web, true);
      assert.equal(finalProduct.imagenes.length, 1);
      assert.equal(finalProduct.imagenes[0].principal, true);
      assert.equal(finalProduct.imagen_principal, finalProduct.imagenes[0].url);
    });

    await t.test("cotiza precio de lista cuando no hay regla", async () => {
      const body = await quote(baseUrl, cashier.token, publishedProduct.id, 2);
      const line = quoteLine(body, "precio sin regla");
      assert.equal(number(line.precio_lista), 100);
      assert.equal(number(line.descuento_unitario), 0);
      assert.equal(number(line.precio_unitario), 100);
      assert.equal(line.regla_precio_id, null);
      assert.equal(number(line.importe), 200);
      assert.equal(number(body.total), 200);
    });

    await t.test("aplica CRUD/RBAC y selección determinista de reglas", async () => {
      const temporaryBody = {
        nombre: "Regla temporal",
        canal: "POS",
        tipo: "PORCENTAJE",
        valor: 5,
        producto_id: number(publishedProduct.id),
      };
      expectStatus(await apiRequest(baseUrl, "/precios/reglas", {
        method: "POST",
        token: cashier.token,
        body: temporaryBody,
      }), 403, "alta de regla por cajero");
      const temporary = await createRule(baseUrl, admin.token, temporaryBody, "crear regla temporal");
      const fetched = expectStatus(await apiRequest(
        baseUrl, `/precios/reglas/${temporary.id}`, { token: cashier.token }
      ), 200, "leer regla");
      assert.equal(fetched.nombre, "Regla temporal");
      const edited = expectStatus(await apiRequest(baseUrl, `/precios/reglas/${temporary.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { nombre: "Regla temporal editada" },
      }), 200, "editar regla");
      assert.equal(edited.nombre, "Regla temporal editada");
      const disabled = expectStatus(await apiRequest(baseUrl, `/precios/reglas/${temporary.id}`, {
        method: "DELETE",
        token: admin.token,
      }), 200, "desactivar regla");
      assert.equal(disabled.activo, false);
      const visibleRules = expectStatus(await apiRequest(
        baseUrl, "/precios/reglas?incluir_inactivas=true", { token: cashier.token }
      ), 200, "listar reglas incluidas las inactivas");
      assert.ok(visibleRules.some((rule) => number(rule.id) === number(temporary.id) && !rule.activo));

      const now = Date.now();
      await createRule(baseUrl, supervisor.token, {
        nombre: "Vencida de alta prioridad",
        canal: "AMBOS",
        tipo: "PRECIO_FIJO",
        valor: 1,
        producto_id: number(publishedProduct.id),
        prioridad: 100,
        vigente_hasta: new Date(now - 60_000).toISOString(),
      }, "crear regla vencida");
      await createRule(baseUrl, supervisor.token, {
        nombre: "Futura de alta prioridad",
        canal: "AMBOS",
        tipo: "PRECIO_FIJO",
        valor: 2,
        producto_id: number(publishedProduct.id),
        prioridad: 100,
        vigente_desde: new Date(now + 3_600_000).toISOString(),
      }, "crear regla futura");
      quantityRule = await createRule(baseUrl, supervisor.token, {
        nombre: "Volumen cinco unidades",
        canal: "POS",
        tipo: "PRECIO_FIJO",
        valor: 50,
        producto_id: number(publishedProduct.id),
        cantidad_minima: 5,
        prioridad: 30,
      }, "crear regla por cantidad");
      webRule = await createRule(baseUrl, supervisor.token, {
        nombre: "Promoción web",
        canal: "WEB",
        tipo: "PORCENTAJE",
        valor: 80,
        producto_id: number(publishedProduct.id),
        prioridad: 40,
      }, "crear regla web");
      const globalPercentage = await createRule(baseUrl, supervisor.token, {
        nombre: "Descuento global diez",
        canal: "AMBOS",
        tipo: "PORCENTAJE",
        valor: 10,
        prioridad: 10,
      }, "crear porcentaje global");

      let line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1),
        "reglas no aplicables ignoradas"
      );
      assert.equal(number(line.precio_unitario), 90);
      assert.equal(number(line.regla_precio_id), number(globalPercentage.id));

      const categoryAmount = await createRule(baseUrl, supervisor.token, {
        nombre: "Descuento por categoría",
        canal: "AMBOS",
        tipo: "MONTO_FIJO",
        valor: 15,
        categoria_id: number(pricingCategory.id),
        prioridad: 10,
      }, "crear monto fijo por categoría");
      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1),
        "alcance de categoría"
      );
      assert.equal(number(line.precio_unitario), 85);
      assert.equal(number(line.regla_precio_id), number(categoryAmount.id));

      firstProductRule = await createRule(baseUrl, supervisor.token, {
        nombre: "Precio fijo por producto primero",
        canal: "AMBOS",
        tipo: "PRECIO_FIJO",
        valor: 70,
        producto_id: number(publishedProduct.id),
        prioridad: 10,
      }, "crear precio fijo por producto");
      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1),
        "alcance de producto"
      );
      assert.equal(number(line.precio_unitario), 70);
      assert.equal(number(line.regla_precio_id), number(firstProductRule.id));

      await createRule(baseUrl, supervisor.token, {
        nombre: "Precio fijo por producto segundo",
        canal: "AMBOS",
        tipo: "PRECIO_FIJO",
        valor: 65,
        producto_id: number(publishedProduct.id),
        prioridad: 10,
      }, "crear empate determinista");
      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1),
        "desempate por id"
      );
      assert.equal(number(line.precio_unitario), 70);
      assert.equal(number(line.regla_precio_id), number(firstProductRule.id));

      highPriorityRule = await createRule(baseUrl, supervisor.token, {
        nombre: "Prioridad global mayor",
        canal: "POS",
        tipo: "MONTO_FIJO",
        valor: 40,
        prioridad: 20,
      }, "crear prioridad global mayor");
      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1),
        "prioridad sobre especificidad"
      );
      assert.equal(number(line.precio_unitario), 60);
      assert.equal(number(line.regla_precio_id), number(highPriorityRule.id));

      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 5),
        "cantidad mínima alcanzada"
      );
      assert.equal(number(line.precio_unitario), 50);
      assert.equal(number(line.regla_precio_id), number(quantityRule.id));

      line = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 1, "WEB"),
        "canal web"
      );
      assert.equal(number(line.precio_unitario), 20);
      assert.equal(number(line.regla_precio_id), number(webRule.id));
    });

    await t.test("POS guarda snapshots, hace replay y reembolsa el precio histórico", async () => {
      const { session } = await openRegister(pool, baseUrl, cashier);
      const saleKey = randomUUID();
      const saleBody = {
        sesion_id: number(session.id),
        metodo_pago: "EFECTIVO",
        cliente: "CLIENTE SNAPSHOT",
        recibido: 1000,
        items: [{ producto_id: number(publishedProduct.id), cantidad: 2 }],
      };
      const saleRequest = () => apiRequest(baseUrl, "/ventas", {
        method: "POST",
        token: cashier.token,
        idempotencyKey: saleKey,
        body: saleBody,
      });

      const sale = expectStatus(await saleRequest(), 201, "venta cotizada por POS");
      assert.equal(number(sale.total), 120);
      assert.equal(sale.detalle.length, 1);
      const originalDetail = sale.detalle[0];
      assert.equal(number(originalDetail.precio_lista), 100);
      assert.equal(number(originalDetail.descuento_unitario), 40);
      assert.equal(number(originalDetail.precio_unitario), 60);
      assert.equal(number(originalDetail.regla_precio_id), number(highPriorityRule.id));
      assert.equal(number(originalDetail.importe), 120);

      expectStatus(await apiRequest(baseUrl, `/productos/${publishedProduct.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { precio: 150 },
      }), 200, "cambiar precio después de vender");
      expectStatus(await apiRequest(baseUrl, `/precios/reglas/${highPriorityRule.id}`, {
        method: "PATCH",
        token: supervisor.token,
        body: { valor: 10 },
      }), 200, "cambiar regla después de vender");

      const currentQuote = quoteLine(
        await quote(baseUrl, cashier.token, publishedProduct.id, 2),
        "precio vigente posterior"
      );
      assert.equal(number(currentQuote.precio_lista), 150);
      assert.equal(number(currentQuote.precio_unitario), 140);

      const replay = expectStatus(await saleRequest(), 200, "replay después de cambiar precios");
      assert.equal(number(replay.id), number(sale.id));
      assert.equal(number(replay.total), 120);
      assert.equal(number(replay.detalle[0].precio_lista), 100);
      assert.equal(number(replay.detalle[0].descuento_unitario), 40);
      assert.equal(number(replay.detalle[0].precio_unitario), 60);
      assert.equal(number(replay.detalle[0].regla_precio_id), number(highPriorityRule.id));

      const stored = (await pool.query(
        `SELECT precio_lista, descuento_unitario, precio_unitario, regla_precio_id, importe
         FROM detalle_ventas WHERE id=$1`,
        [originalDetail.id]
      )).rows[0];
      assert.equal(number(stored.precio_lista), 100);
      assert.equal(number(stored.descuento_unitario), 40);
      assert.equal(number(stored.precio_unitario), 60);
      assert.equal(number(stored.regla_precio_id), number(highPriorityRule.id));
      assert.equal(number(stored.importe), 120);

      const refund = expectStatus(await apiRequest(
        baseUrl, `/ventas/${sale.id}/devoluciones`, {
          method: "POST",
          token: supervisor.token,
          idempotencyKey: randomUUID(),
          body: {
            sesion_id: number(session.id),
            motivo: "DEVOLUCIÓN CON PRECIO HISTÓRICO",
            items: [{ detalle_venta_id: number(originalDetail.id), cantidad: 1 }],
          },
        }
      ), 201, "devolución con snapshot");
      assert.equal(number(refund.devolucion.total), 60);
      assert.equal(number(refund.devolucion.detalle[0].importe), 60);
      assert.equal(number(refund.venta.detalle[0].precio_lista), 100);
      assert.equal(number(refund.venta.detalle[0].precio_unitario), 60);
      assert.equal(number(refund.venta.detalle[0].devuelto), 1);
    });

    await t.test("WEB exige publicación y usa la misma función común", async () => {
      const unpublished = await createProduct(baseUrl, supervisor.token, {
        titulo: `Libro privado ${++sequence}`,
        sku: `PRIV-${sequence}`,
        slug: `libro-privado-${sequence}`,
        precio: 80,
        stock: 5,
      });
      expectStatus(await apiRequest(baseUrl, "/precios/cotizar", {
        method: "POST",
        token: cashier.token,
        body: {
          canal: "WEB",
          items: [{ producto_id: number(unpublished.id), cantidad: 1 }],
        },
      }), 409, "cotización web de producto no publicado");

      const webQuote = await quote(baseUrl, cashier.token, publishedProduct.id, 1, "WEB");
      const webLine = quoteLine(webQuote, "cotización web publicada");
      const direct = (await pool.query(
        `SELECT * FROM calcular_precio_comun($1,$2,'WEB',NOW())`,
        [publishedProduct.id, 1]
      )).rows[0];
      assert.equal(number(webLine.precio_lista), number(direct.precio_lista));
      assert.equal(number(webLine.descuento_unitario), number(direct.descuento_unitario));
      assert.equal(number(webLine.precio_unitario), number(direct.precio_unitario));
      assert.equal(number(webLine.regla_precio_id), number(direct.regla_precio_id));
      assert.equal(number(webLine.regla_precio_id), number(webRule.id));
      assert.equal(number(webLine.precio_lista), 150);
      assert.equal(number(webLine.precio_unitario), 30);
    });
  } finally {
    await environment.cleanup();
  }
});
