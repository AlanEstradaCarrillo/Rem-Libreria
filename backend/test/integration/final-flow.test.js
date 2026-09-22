const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const PASSWORD = "PruebaIntegral!2026";
const number = Number;

function expectStatus(response, expected, step) {
  assert.equal(response.status, expected,
    `${step}: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  return response.body;
}

test("flujo integral: login a cierre de caja sin divergencia de datos", { timeout: 120000 }, async () => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await pool.query(`INSERT INTO roles (nombre) VALUES ('CAJERO') ON CONFLICT (nombre) DO NOTHING`);
    const hash = await bcrypt.hash(PASSWORD, 4);
    const user = (await pool.query(
      `INSERT INTO usuarios (nombre,email,password_hash,rol_id)
       SELECT 'Cajera integral','integral@tests.local',$1,id FROM roles WHERE nombre='CAJERO'
       RETURNING id,nombre,email`, [hash]
    )).rows[0];
    const register = (await pool.query(
      `INSERT INTO caja (nombre,activo) VALUES ('Caja integral',TRUE) RETURNING id,nombre`
    )).rows[0];
    const product = (await pool.query(
      `INSERT INTO productos (sku,titulo,precio,costo,stock,iva,activo)
       VALUES ('INTEGRAL-01','Libro prueba integral',116,40,5,16,TRUE)
       RETURNING id,sku,titulo,stock`
    )).rows[0];

    const login = expectStatus(await apiRequest(baseUrl, "/auth/login", {
      method: "POST", body: { email: user.email, password: PASSWORD },
    }), 200, "login");
    const token = login.token;
    assert.equal(number(login.usuario.id), number(user.id));
    assert.equal(expectStatus(await apiRequest(baseUrl, "/auth/me", { token }), 200,
      "sesión").rol, "CAJERO");

    const opened = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
      method: "POST", token,
      body: { caja_id: number(register.id), fondo_inicial: 100 },
    }), 201, "apertura");
    const session = opened.sesion || opened;
    assert.equal(number(session.usuario_id), number(user.id));
    assert.equal(number(session.caja_id), number(register.id));

    const found = expectStatus(await apiRequest(baseUrl,
      `/productos/buscar?codigo=${product.sku}`, { token }), 200, "búsqueda");
    assert.equal(number(found.id), number(product.id));
    assert.equal(number(found.stock), 5);
    const cart = [{ producto_id: number(product.id), cantidad: 2 }];
    const quote = expectStatus(await apiRequest(baseUrl, "/precios/cotizar", {
      method: "POST", token, body: { canal: "POS", items: cart },
    }), 200, "carrito");
    assert.equal(number(quote.subtotal), 200);
    assert.equal(number(quote.iva), 32);
    assert.equal(number(quote.total), 232);
    assert.equal(number(quote.lineas[0].disponible), 5);

    const saleBody = {
      sesion_id: number(session.id), metodo_pago: "EFECTIVO", recibido: 300,
      items: cart,
    };
    const sale = expectStatus(await apiRequest(baseUrl, "/ventas", {
      method: "POST", token, idempotencyKey: randomUUID(), body: saleBody,
    }), 201, "cobro");
    assert.equal(number(sale.total), number(quote.total));
    assert.equal(number(sale.recibido), 300);
    assert.equal(number(sale.cambio), 68);
    assert.equal(number(sale.usuario_id), number(user.id));
    assert.equal(number(sale.caja_id), number(register.id));
    assert.equal(number(sale.sesion_id), number(session.id));

    const ticket = expectStatus(await apiRequest(baseUrl, `/ventas/${sale.id}`, { token }),
      200, "datos del ticket");
    for (const field of ["folio", "cajero", "caja_nombre", "metodo_pago", "total",
      "subtotal", "iva", "recibido", "cambio", "creado_en"]) {
      assert.deepEqual(ticket[field], sale[field], `ticket: ${field}`);
    }
    assert.equal(ticket.cajero, user.nombre);
    assert.equal(ticket.caja_nombre, register.nombre);
    assert.deepEqual(ticket.detalle, sale.detalle);
    assert.deepEqual(ticket.detalle.map((line) => [line.sku, line.titulo,
      number(line.cantidad), number(line.precio_unitario), number(line.importe)]), [
      [product.sku, product.titulo, 2, 116, 232],
    ]);
    const recent = expectStatus(await apiRequest(baseUrl, "/ventas", { token }), 200,
      "consulta de venta");
    assert.ok(recent.some((row) => number(row.id) === number(sale.id)
      && row.folio === sale.folio && number(row.total) === 232));

    const stored = (await pool.query(
      `SELECT v.id,v.folio,v.total,v.usuario_id,v.caja_id,v.sesion_id,
              d.producto_id,d.cantidad,d.precio_unitario,d.importe
       FROM ventas v JOIN detalle_ventas d ON d.venta_id=v.id WHERE v.id=$1`, [sale.id]
    )).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].folio, ticket.folio);
    assert.equal(number(stored[0].total), number(ticket.total));
    assert.equal(number(stored[0].cantidad), number(ticket.detalle[0].cantidad));
    assert.equal(number(stored[0].precio_unitario), number(ticket.detalle[0].precio_unitario));
    assert.equal(number(stored[0].importe), number(ticket.detalle[0].importe));
    assert.equal(number(stored[0].usuario_id), number(user.id));
    assert.equal(number(stored[0].caja_id), number(register.id));
    assert.equal(number(stored[0].sesion_id), number(session.id));
    assert.equal(number(stored[0].producto_id), number(product.id));

    const stock = (await pool.query(`SELECT stock FROM productos WHERE id=$1`, [product.id])).rows[0];
    assert.equal(number(stock.stock), 3);
    const kardex = (await pool.query(
      `SELECT usuario_id,delta_fisico,stock_fisico_resultante
       FROM inventario_movimientos WHERE venta_id=$1 AND producto_id=$2 AND tipo='VENTA'`,
      [sale.id, product.id]
    )).rows;
    assert.equal(kardex.length, 1);
    assert.equal(number(kardex[0].usuario_id), number(user.id));
    assert.equal(number(kardex[0].delta_fisico), -2);
    assert.equal(number(kardex[0].stock_fisico_resultante), 3);
    const saleMovement = (await pool.query(
      `SELECT * FROM movimientos WHERE venta_id=$1 AND tipo='VENTA'`, [sale.id]
    )).rows;
    assert.equal(saleMovement.length, 1);
    assert.equal(number(saleMovement[0].monto), 232);
    assert.equal(saleMovement[0].metodo_pago, "EFECTIVO");
    assert.equal(number(saleMovement[0].usuario_id), number(user.id));
    assert.equal(number(saleMovement[0].caja_id), number(register.id));
    assert.equal(number(saleMovement[0].sesion_id), number(session.id));

    const state = expectStatus(await apiRequest(baseUrl,
      `/caja/estado?caja_id=${register.id}`, { token }), 200, "estado antes del corte");
    assert.equal(state.abierta, true);
    assert.equal(number(state.n_ventas), 1);
    assert.equal(number(state.ventas_efectivo), 232);
    assert.equal(number(state.esperado), 332);

    const cut = expectStatus(await apiRequest(baseUrl, "/caja/corte", {
      method: "POST", token, idempotencyKey: randomUUID(),
      body: { sesion_id: number(session.id), efectivo_contado: 330 },
    }), 201, "cierre");
    assert.equal(number(cut.efectivo_esperado), 332);
    assert.equal(number(cut.efectivo_contado), 330);
    assert.equal(number(cut.diferencia), -2);
    const storedCut = (await pool.query(
      `SELECT cor.*,s.estado,s.fecha_cierre FROM cortes cor
       JOIN sesiones_caja s ON s.id=cor.sesion_id WHERE cor.id=$1`, [cut.id]
    )).rows;
    assert.equal(storedCut.length, 1);
    assert.equal(storedCut[0].estado, "CERRADA");
    assert.ok(storedCut[0].fecha_cierre);
    assert.equal(number(storedCut[0].efectivo_esperado), number(state.esperado));
    assert.equal(number(storedCut[0].diferencia), -2);
    const closureMovement = (await pool.query(
      `SELECT * FROM movimientos WHERE sesion_id=$1 AND tipo='CIERRE'`, [session.id]
    )).rows;
    assert.equal(closureMovement.length, 1);
    assert.equal(number(closureMovement[0].caja_id), number(register.id));
    assert.equal(number(closureMovement[0].usuario_id), number(user.id));
    const closed = expectStatus(await apiRequest(baseUrl,
      `/caja/estado?caja_id=${register.id}`, { token }), 200, "estado cerrado");
    assert.equal(closed.abierta, false);
    assert.equal(number(closed.ultimo_corte.id), number(cut.id));
    expectStatus(await apiRequest(baseUrl, "/ventas", {
      method: "POST", token, idempotencyKey: randomUUID(), body: saleBody,
    }), 409, "venta con caja cerrada");
    assert.equal(number((await pool.query(
      `SELECT stock FROM productos WHERE id=$1`, [product.id]
    )).rows[0].stock), 3);
  } finally {
    await environment.cleanup();
  }
});
