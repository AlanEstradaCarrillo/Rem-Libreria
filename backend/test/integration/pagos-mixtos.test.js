const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const PASSWORD = "PagosMixtos!2026";
const num = Number;

function expectStatus(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body;
}

async function createUser(pool, baseUrl, role, name) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const created = (await pool.query(
    `INSERT INTO usuarios (nombre,email,password_hash,rol_id)
     SELECT $1,$2,$3,id FROM roles WHERE nombre=$4 RETURNING id,nombre,email`,
    [name, `${name.toLowerCase()}@tests.local`, hash, role]
  )).rows[0];
  const login = expectStatus(await apiRequest(baseUrl, "/auth/login", {
    method: "POST", body: { email: created.email, password: PASSWORD },
  }), 200);
  return { ...created, token: login.token };
}

async function openCash(pool, baseUrl, owner, name, initial) {
  const register = (await pool.query(
    `INSERT INTO caja (nombre,activo) VALUES ($1,TRUE) RETURNING id,nombre`, [name]
  )).rows[0];
  const session = expectStatus(await apiRequest(baseUrl, "/caja/apertura", {
    method: "POST", token: owner.token,
    body: { caja_id: num(register.id), fondo_inicial: initial },
  }), 201);
  return { register, session };
}

function sell(baseUrl, token, body, key = randomUUID()) {
  return apiRequest(baseUrl, "/ventas", {
    method: "POST", token, idempotencyKey: key, body,
  });
}

function cashState(baseUrl, token, registerId) {
  return apiRequest(baseUrl, `/caja/estado?caja_id=${registerId}`, { token });
}

test("pagos mixtos: cobro, reverso, devolución y caja por medio", { timeout: 240000 }, async (t) => {
  const environment = await createIntegrationEnvironment();
  const { baseUrl, pool } = environment;
  try {
    await pool.query(`INSERT INTO roles (nombre) VALUES ('SUPERVISOR') ON CONFLICT (nombre) DO NOTHING`);
    await pool.query(`INSERT INTO roles (nombre) VALUES ('CAJERO') ON CONFLICT (nombre) DO NOTHING`);
    const cashier = await createUser(pool, baseUrl, "CAJERO", "CajeroMixto");
    const supervisor = await createUser(pool, baseUrl, "SUPERVISOR", "SupervisorMixto");
    const product = (await pool.query(
      `INSERT INTO productos (sku,titulo,precio,costo,stock,iva,activo)
       VALUES ('MIXTO-116','Libro con pagos mixtos',116,0,50,16,TRUE) RETURNING id`
    )).rows[0];
    const { register, session } = await openCash(pool, baseUrl, cashier, "Caja pagos mixtos", 100);
    const items = (cantidad) => [{ producto_id: num(product.id), cantidad }];

    await t.test("cobra con varios medios, un solo movimiento de venta y caja por medio", async () => {
      const venta = expectStatus(await sell(baseUrl, cashier.token, {
        sesion_id: num(session.id),
        pagos: [
          { metodo_pago: "EFECTIVO", monto: 100, recibido: 120 },
          { metodo_pago: "TARJETA", monto: 132 },
        ],
        items: items(2),
      }), 201);
      assert.equal(venta.metodo_pago, "MIXTO");
      assert.equal(num(venta.total), 232);
      assert.equal(venta.recibido, null);
      assert.equal(venta.cambio, null);
      assert.equal(venta.pagos.length, 2);
      const efectivo = venta.pagos.find((pago) => pago.metodo_pago === "EFECTIVO");
      assert.equal(num(efectivo.monto), 100);
      assert.equal(num(efectivo.recibido), 120);
      assert.equal(num(efectivo.cambio), 20);
      const tarjeta = venta.pagos.find((pago) => pago.metodo_pago === "TARJETA");
      assert.equal(num(tarjeta.monto), 132);
      assert.equal(tarjeta.recibido, null);

      const movimientos = (await pool.query(
        `SELECT id, metodo_pago, monto FROM movimientos WHERE venta_id=$1 AND tipo='VENTA'`,
        [venta.id]
      )).rows;
      assert.equal(movimientos.length, 1);
      assert.equal(movimientos[0].metodo_pago, "MIXTO");
      assert.equal(num(movimientos[0].monto), 232);

      const estado = expectStatus(await cashState(baseUrl, cashier.token, register.id), 200);
      assert.equal(num(estado.ventas_efectivo), 100);
      assert.equal(num(estado.ventas_tarjeta), 132);
      assert.equal(num(estado.n_ventas), 1);
      assert.equal(num(estado.esperado), 200);

      const detalle = expectStatus(await apiRequest(baseUrl, `/ventas/${venta.id}`, { token: cashier.token }), 200);
      assert.equal(detalle.pagos.length, 2);
    });

    await t.test("rechaza sumas incorrectas, efectivo insuficiente y medios repetidos sin crear venta", async () => {
      const antes = num((await pool.query(`SELECT COUNT(*) AS n FROM ventas`)).rows[0].n);
      const casos = [
        { pagos: [{ metodo_pago: "EFECTIVO", monto: 100, recibido: 100 }, { metodo_pago: "TARJETA", monto: 100 }] },
        { pagos: [{ metodo_pago: "EFECTIVO", monto: 100, recibido: 50 }, { metodo_pago: "TARJETA", monto: 132 }] },
        { pagos: [{ metodo_pago: "TARJETA", monto: 100 }, { metodo_pago: "TARJETA", monto: 132 }] },
        { metodo_pago: "TARJETA", pagos: [{ metodo_pago: "TARJETA", monto: 232 }] },
        { pagos: [{ metodo_pago: "TARJETA", monto: 232, recibido: 232 }] },
      ];
      for (const caso of casos) {
        const respuesta = await sell(baseUrl, cashier.token, {
          sesion_id: num(session.id), items: items(2), ...caso,
        });
        assert.equal(respuesta.status, 400, JSON.stringify(respuesta.body));
      }
      const despues = num((await pool.query(`SELECT COUNT(*) AS n FROM ventas`)).rows[0].n);
      assert.equal(despues, antes);
    });

    await t.test("un único pago con la forma nueva conserva el comportamiento del cobro clásico", async () => {
      const venta = expectStatus(await sell(baseUrl, cashier.token, {
        sesion_id: num(session.id),
        pagos: [{ metodo_pago: "EFECTIVO", monto: 232, recibido: 250 }],
        items: items(2),
      }), 201);
      assert.equal(venta.metodo_pago, "EFECTIVO");
      assert.equal(num(venta.recibido), 250);
      assert.equal(num(venta.cambio), 18);
      assert.equal(venta.pagos.length, 1);
      assert.equal(num(venta.pagos[0].cambio), 18);
    });

    await t.test("la cancelación de una venta mixta revierte cada medio", async () => {
      const venta = expectStatus(await sell(baseUrl, cashier.token, {
        sesion_id: num(session.id),
        pagos: [
          { metodo_pago: "EFECTIVO", monto: 100, recibido: 100 },
          { metodo_pago: "TARJETA", monto: 132 },
        ],
        items: items(2),
      }), 201);
      const antes = expectStatus(await cashState(baseUrl, cashier.token, register.id), 200);
      const cancelada = expectStatus(await apiRequest(baseUrl, `/ventas/${venta.id}/cancelacion`, {
        method: "POST", token: supervisor.token, idempotencyKey: randomUUID(),
        body: { sesion_id: num(session.id), motivo: "Venta mixta capturada por error" },
      }), 201);
      assert.equal(cancelada.venta.estado, "CANCELADA");
      const reversos = (await pool.query(
        `SELECT mp.metodo_pago, mp.monto FROM movimiento_pagos mp
         JOIN movimientos m ON m.id=mp.movimiento_id
         WHERE m.tipo='CANCELACION' AND m.cancelacion_id=$1
         ORDER BY mp.metodo_pago`,
        [cancelada.cancelacion.id]
      )).rows;
      assert.deepEqual(reversos.map((fila) => [fila.metodo_pago, num(fila.monto)]), [
        ["EFECTIVO", 100], ["TARJETA", 132],
      ]);
      const despues = expectStatus(await cashState(baseUrl, cashier.token, register.id), 200);
      assert.equal(num(despues.esperado), num(antes.esperado) - 100);
    });

    await t.test("devoluciones parciales de una venta mixta reparten sin excederse y cuadran", async () => {
      const venta = expectStatus(await sell(baseUrl, cashier.token, {
        sesion_id: num(session.id),
        pagos: [
          { metodo_pago: "EFECTIVO", monto: 100, recibido: 100 },
          { metodo_pago: "TARJETA", monto: 248 },
        ],
        items: items(3),
      }), 201);
      assert.equal(num(venta.total), 348);

      const primera = expectStatus(await apiRequest(baseUrl, `/ventas/${venta.id}/devoluciones`, {
        method: "POST", token: supervisor.token, idempotencyKey: randomUUID(),
        body: {
          sesion_id: num(session.id),
          motivo: "Devuelve un ejemplar",
          items: [{ detalle_venta_id: num(venta.detalle[0].id), cantidad: 1 }],
        },
      }), 201);
      assert.equal(num(primera.devolucion.total), 116);

      const segunda = expectStatus(await apiRequest(baseUrl, `/ventas/${venta.id}/devoluciones`, {
        method: "POST", token: supervisor.token, idempotencyKey: randomUUID(),
        body: {
          sesion_id: num(session.id),
          motivo: "Devuelve dos ejemplares",
          items: [{ detalle_venta_id: num(venta.detalle[0].id), cantidad: 2 }],
        },
      }), 201);
      assert.equal(num(segunda.devolucion.total), 232);
      assert.equal(segunda.venta.estado, "DEVUELTA");

      const porMedio = (await pool.query(
        `SELECT mp.metodo_pago, SUM(mp.monto) AS monto FROM movimiento_pagos mp
         JOIN movimientos m ON m.id=mp.movimiento_id
         WHERE m.tipo='DEVOLUCION' AND m.devolucion_id IN (
           SELECT id FROM devoluciones WHERE venta_id=$1)
         GROUP BY mp.metodo_pago ORDER BY mp.metodo_pago`,
        [venta.id]
      )).rows;
      assert.deepEqual(porMedio.map((fila) => [fila.metodo_pago, num(fila.monto)]), [
        ["EFECTIVO", 100], ["TARJETA", 248],
      ]);

      const exceso = await apiRequest(baseUrl, `/ventas/${venta.id}/devoluciones`, {
        method: "POST", token: supervisor.token, idempotencyKey: randomUUID(),
        body: {
          sesion_id: num(session.id),
          motivo: "Intento fuera de disponibilidad",
          items: [{ detalle_venta_id: num(venta.detalle[0].id), cantidad: 1 }],
        },
      });
      assert.equal(exceso.status, 409, JSON.stringify(exceso.body));
    });

    await t.test("el cobro mixto es idempotente y el corte concilia por medio", async () => {
      const clave = randomUUID();
      const cuerpo = {
        sesion_id: num(session.id),
        pagos: [
          { metodo_pago: "EFECTIVO", monto: 60, recibido: 70 },
          { metodo_pago: "TRANSFERENCIA", monto: 56 },
        ],
        items: items(1),
      };
      const primera = expectStatus(await sell(baseUrl, cashier.token, cuerpo, clave), 201);
      const repetida = expectStatus(await sell(baseUrl, cashier.token, cuerpo, clave), 200);
      assert.equal(num(repetida.id), num(primera.id));
      assert.equal(repetida.pagos.length, 2);

      const conteo = (await pool.query(
        `SELECT COUNT(*) AS n FROM movimientos WHERE venta_id=$1 AND tipo='VENTA'`,
        [primera.id]
      )).rows[0];
      assert.equal(num(conteo.n), 1);

      // Ventas en efectivo: 100 + 232 + 100 + 100 + 60 = 592. Reversos en efectivo:
      // 100 (cancelación) + 100 (devoluciones) = 200. Fondo inicial: 100.
      const estado = expectStatus(await cashState(baseUrl, cashier.token, register.id), 200);
      assert.equal(num(estado.ventas_efectivo), 592);
      assert.equal(num(estado.devoluciones_efectivo), 200);
      assert.equal(num(estado.esperado), 492);
      assert.equal(num(estado.ventas_transf), 56);
    });

    await t.test("la base rechaza movimientos de venta sin medios o con medios que no suman su monto", async () => {
      const referencia = (await pool.query(
        `SELECT sesion_id, caja_id, usuario_id FROM ventas ORDER BY id LIMIT 1`
      )).rows[0];
      const client = await pool.connect();
      const nuevaVenta = async () => (await client.query(
        `INSERT INTO ventas (sesion_id, caja_id, usuario_id, cliente, metodo_pago, subtotal, iva, total)
         VALUES ($1,$2,$3,'Prueba de garantía','EFECTIVO',0,0,0) RETURNING id`,
        [referencia.sesion_id, referencia.caja_id, referencia.usuario_id]
      )).rows[0].id;
      const movimientoVenta = async (ventaId, monto) => (await client.query(
        `INSERT INTO movimientos
           (sesion_id, caja_id, usuario_id, tipo, referencia, concepto, monto,
            metodo_pago, venta_id, actor_inferido)
         VALUES ($1,$2,$3,'VENTA','GARANTIA','Prueba de garantía',$4,'EFECTIVO',$5,FALSE)
         RETURNING id`,
        [referencia.sesion_id, referencia.caja_id, referencia.usuario_id, monto, ventaId]
      )).rows[0].id;
      try {
        await client.query("BEGIN");
        const ventaSinMedios = await nuevaVenta();
        await movimientoVenta(ventaSinMedios, 0);
        await assert.rejects(client.query("COMMIT"), (error) => error.code === "23514"
          && /no tiene medios de pago/.test(error.message));
        await client.query("ROLLBACK");

        await client.query("BEGIN");
        const ventaSumaDistinta = await nuevaVenta();
        const movimientoSumaDistinta = await movimientoVenta(ventaSumaDistinta, 10);
        await client.query(
          `INSERT INTO movimiento_pagos (movimiento_id, metodo_pago, monto)
           VALUES ($1,'EFECTIVO',5)`,
          [movimientoSumaDistinta]
        );
        await assert.rejects(client.query("COMMIT"), (error) => error.code === "23514"
          && /suman 5/.test(error.message));
        await client.query("ROLLBACK");

        const persistidas = (await pool.query(
          `SELECT COUNT(*) AS n FROM ventas WHERE cliente='Prueba de garantía'`
        )).rows[0];
        assert.equal(num(persistidas.n), 0);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });
  } finally {
    await environment.cleanup();
  }
});
