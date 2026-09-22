const { ApiError } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento } = require("./inventario.service");
const { compactarItems, cotizar } = require("./precios.service");
const { cargarClienteActivo } = require("./clientes.service");

const ESTADOS_CON_RESERVA = new Set(["RESERVADO", "LISTO"]);
const TTL_PREDETERMINADO_MINUTOS = 30;

function idPositivo(value, field = "pedido_id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${field} inválido.`);
  }
  return id;
}

function duracionReservaMinutos() {
  const raw = process.env.RESERVATION_TTL_MINUTES;
  if (raw == null || String(raw).trim() === "") return TTL_PREDETERMINADO_MINUTOS;
  const minutos = Number(raw);
  if (!Number.isInteger(minutos) || minutos < 5 || minutos > 1440) {
    throw new Error("RESERVATION_TTL_MINUTES debe ser un entero entre 5 y 1440.");
  }
  return minutos;
}

async function cargarPedido(db, pedidoId) {
  const id = idPositivo(pedidoId);
  const cabecera = await db.query(
    `SELECT p.*, c.nombre AS cliente_registrado, u.nombre AS creado_por
     FROM pedidos p
     LEFT JOIN clientes c ON c.id=p.cliente_id
     LEFT JOIN usuarios u ON u.id=p.creado_por_usuario_id
     WHERE p.id=$1`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Pedido no encontrado.");

  const detalle = await db.query(
    `SELECT dp.*, r.id AS reserva_id, r.estado AS reserva_estado,
            r.expira_en AS reserva_expira_en, r.finalizada_en AS reserva_finalizada_en
     FROM detalle_pedidos dp
     JOIN reservas_stock r ON r.detalle_pedido_id=dp.id
     WHERE dp.pedido_id=$1
     ORDER BY dp.id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT pt.*, u.nombre AS usuario
     FROM pedido_transiciones pt
     LEFT JOIN usuarios u ON u.id=pt.usuario_id
     WHERE pt.pedido_id=$1
     ORDER BY pt.id`,
    [id]
  );
  return {
    ...cabecera.rows[0],
    detalle: detalle.rows,
    transiciones: transiciones.rows,
  };
}

async function listarPedidos(db, {
  estado = null,
  clienteId = null,
  q = "",
  page = 1,
  limit = 30,
} = {}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT p.id, p.folio, p.canal, p.canal_precio, p.estado,
            p.cliente_id, p.cliente_nombre, p.cliente_telefono,
            p.tipo_entrega, p.total, p.expira_en, p.creado_en,
            p.creado_por_usuario_id, u.nombre AS creado_por,
            (p.estado IN ('RESERVADO','LISTO') AND p.expira_en <= NOW()) AS vencido
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id=p.creado_por_usuario_id
     WHERE ($1::text IS NULL OR p.estado=$1)
       AND ($2::bigint IS NULL OR p.cliente_id=$2)
       AND (
         $3::text=''
         OR p.folio ILIKE '%' || $3 || '%'
         OR p.cliente_nombre ILIKE '%' || $3 || '%'
         OR p.cliente_telefono ILIKE '%' || $3 || '%'
       )
     ORDER BY p.id DESC
     LIMIT $4 OFFSET $5`,
    [estado, clienteId, q, limit, offset]
  );
  return { page, limit, resultados: result.rows };
}

async function resolverContacto(client, { clienteId = null, cliente = null, tipoEntrega }) {
  let contacto;
  let id = null;
  if (clienteId != null) {
    contacto = await cargarClienteActivo(client, clienteId);
    id = Number(contacto.id);
  } else {
    contacto = cliente;
  }

  if (!contacto || !String(contacto.nombre || "").trim()) {
    throw new ApiError(400, "El pedido requiere un cliente o datos de contacto.");
  }
  if (!String(contacto.telefono || "").trim()) {
    throw new ApiError(400, "El pedido requiere un teléfono de contacto.");
  }
  if (tipoEntrega === "ENVIO" && !String(contacto.direccion || "").trim()) {
    throw new ApiError(400, "La entrega a domicilio requiere una dirección.");
  }

  return {
    clienteId: id,
    nombre: String(contacto.nombre).trim(),
    telefono: String(contacto.telefono).trim(),
    email: contacto.email ? String(contacto.email).trim().toLowerCase() : null,
    direccion: contacto.direccion ? String(contacto.direccion).trim() : null,
    segmentoPrecio: id == null ? "PUBLICO" : contacto.segmento_precio,
  };
}

async function crearPedidoReservado(client, {
  canal = "INTERNO",
  usuarioId = null,
  actorClave = null,
  clienteId = null,
  cliente = null,
  tipoEntrega,
  notas = null,
  items,
  duracionMinutos = null,
}) {
  const esWeb = canal === "WEB";
  if (!esWeb && canal !== "INTERNO") {
    throw new ApiError(400, "Canal de pedido inválido.");
  }
  if (esWeb) {
    if (usuarioId != null || clienteId != null
        || !/^PUBLICO:[0-9a-f]{64}$/.test(String(actorClave || ""))) {
      throw new ApiError(400, "Identidad pública inválida para el pedido web.");
    }
  } else if (!Number.isInteger(Number(usuarioId)) || Number(usuarioId) <= 0 || actorClave != null) {
    throw new ApiError(400, "El pedido interno requiere un usuario válido.");
  }
  const canalPrecio = esWeb ? "WEB" : "POS";

  const contacto = await resolverContacto(client, { clienteId, cliente, tipoEntrega });
  const compactados = compactarItems(items, "producto_id");
  const productos = await bloquearProductos(
    client,
    compactados.map((item) => item.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));

  if (esWeb) {
    const categoriaIds = [...new Set(
      productos
        .map((producto) => Number(producto.categoria_id))
        .filter((categoriaId) => Number.isInteger(categoriaId) && categoriaId > 0)
    )];
    if (categoriaIds.length) {
      const categoriasActivas = await client.query(
        `SELECT id FROM categorias
         WHERE id=ANY($1::int[]) AND activo
         ORDER BY id
         FOR SHARE`,
        [categoriaIds]
      );
      if (categoriasActivas.rowCount !== categoriaIds.length) {
        throw new ApiError(404, "Uno o más productos no están disponibles en la tienda.");
      }
    }
  }

  for (const item of compactados) {
    const producto = productoPorId.get(Number(item.producto_id));
    if (esWeb && (!producto.activo || !producto.publicado_web)) {
      throw new ApiError(404, "Uno o más productos no están disponibles en la tienda.");
    }
    if (!esWeb && !producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
    if (Number(producto.stock_disponible) < item.cantidad) {
      throw new ApiError(
        409,
        `Stock insuficiente de "${producto.titulo}" (disponible: ${producto.stock_disponible}).`
      );
    }
  }

  const cotizacion = await cotizar(client, {
    items: compactados,
    canal: canalPrecio,
    productosBloqueados: productos,
    segmentoCliente: contacto.segmentoPrecio,
  });
  const minutos = duracionMinutos == null ? duracionReservaMinutos() : Number(duracionMinutos);
  if (!Number.isFinite(minutos) || minutos <= 0 || minutos > 1440) {
    throw new ApiError(400, "Duración de reserva inválida.");
  }
  const pedidoResult = await client.query(
    `INSERT INTO pedidos
       (canal, canal_precio, estado, publico_actor_clave, cliente_id, creado_por_usuario_id,
         cliente_nombre, cliente_telefono, cliente_email, cliente_direccion,
         segmento_precio, tipo_entrega, notas, subtotal, descuento, iva, total, expira_en)
     VALUES
       ($1,$2,'RESERVADO',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        NOW() + ($17::double precision * INTERVAL '1 minute'))
     RETURNING *`,
    [
      canal,
      canalPrecio,
      esWeb ? actorClave : null,
      contacto.clienteId,
      usuarioId,
      contacto.nombre,
      contacto.telefono,
      contacto.email,
      contacto.direccion,
      contacto.segmentoPrecio,
      tipoEntrega,
      notas,
      cotizacion.subtotal,
      cotizacion.descuento,
      cotizacion.iva,
      cotizacion.total,
      minutos,
    ]
  );
  const pedido = pedidoResult.rows[0];
  const lineaPorProducto = new Map(
    cotizacion.lineas.map((linea) => [Number(linea.producto_id), linea])
  );

  for (const item of compactados) {
    const producto = productoPorId.get(Number(item.producto_id));
    const linea = lineaPorProducto.get(Number(item.producto_id));
    const detalleResult = await client.query(
      `INSERT INTO detalle_pedidos
         (pedido_id, producto_id, producto_sku, producto_titulo, cantidad,
          precio_lista, descuento_unitario, precio_unitario, iva_porcentaje,
          regla_precio_id, importe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        pedido.id,
        producto.id,
        producto.sku,
        producto.titulo,
        item.cantidad,
        linea.precio_lista,
        linea.descuento_unitario,
        linea.precio_unitario,
        linea.iva,
        linea.regla_precio_id,
        linea.importe,
      ]
    );
    const reservaResult = await client.query(
      `INSERT INTO reservas_stock
         (pedido_id, detalle_pedido_id, producto_id, cantidad, estado, expira_en)
       VALUES ($1,$2,$3,$4,'ACTIVA',(SELECT expira_en FROM pedidos WHERE id=$1))
       RETURNING *`,
      [pedido.id, detalleResult.rows[0].id, producto.id, item.cantidad]
    );
    const reserva = reservaResult.rows[0];
    await aplicarMovimiento(client, {
      producto,
      deltaReservado: item.cantidad,
      tipo: "RESERVA",
      usuarioId,
      motivo: `Reserva del pedido ${pedido.folio}`,
      pedidoId: pedido.id,
      reservaId: reserva.id,
      origenClave: `PEDIDO:${pedido.id}:RESERVA:${reserva.id}`,
    });
  }

  return cargarPedido(client, pedido.id);
}

async function bloquearPedido(client, pedidoId) {
  const id = idPositivo(pedidoId);
  const result = await client.query(`SELECT * FROM pedidos WHERE id=$1 FOR UPDATE`, [id]);
  if (!result.rows[0]) throw new ApiError(404, "Pedido no encontrado.");
  return result.rows[0];
}

async function cargarReservasActivas(client, pedidoIds) {
  const result = await client.query(
    `SELECT * FROM reservas_stock
     WHERE pedido_id=ANY($1::bigint[]) AND estado='ACTIVA'
     ORDER BY producto_id, pedido_id
     FOR UPDATE`,
    [pedidoIds]
  );
  return result.rows;
}

async function marcarPedidoListo(client, { pedidoId, usuarioId }) {
  const pedido = await bloquearPedido(client, pedidoId);
  if (pedido.estado !== "RESERVADO") {
    throw new ApiError(409, "Solo un pedido reservado puede marcarse como listo.");
  }
  if (new Date(pedido.expira_en).getTime() <= Date.now()) {
    throw new ApiError(409, "La reserva del pedido ya venció; procesa las expiraciones.");
  }
  await client.query(
    `INSERT INTO pedido_transiciones
       (pedido_id, estado_anterior, estado_nuevo, actor, usuario_id, motivo, origen_clave)
     VALUES ($1,'RESERVADO','LISTO','USUARIO',$2,$3,$4)`,
    [pedido.id, usuarioId, "Pedido preparado y listo para entrega.", `PEDIDO:${pedido.id}:LISTO`]
  );
  return cargarPedido(client, pedido.id);
}

async function finalizarReservas(client, {
  pedido,
  reservas,
  productos,
  estadoReserva,
  estadoPedido,
  tipoMovimiento,
  actorTransicion,
  actorInventario = null,
  usuarioId,
  motivo,
  origen,
}) {
  const actorKardex = actorInventario
    || (actorTransicion === "PUBLICO" ? "SISTEMA" : actorTransicion);
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  for (const reserva of reservas) {
    const producto = productoPorId.get(Number(reserva.producto_id));
    if (!producto) throw new ApiError(409, "La reserva no tiene un producto válido.");
    await aplicarMovimiento(client, {
      producto,
      deltaReservado: -Number(reserva.cantidad),
      tipo: tipoMovimiento,
      actor: actorKardex,
      usuarioId,
      motivo,
      pedidoId: pedido.id,
      reservaId: reserva.id,
      origenClave: `PEDIDO:${pedido.id}:${origen}:RESERVA:${reserva.id}`,
    });
    const actualizada = await client.query(
      `UPDATE reservas_stock
       SET estado=$2, finalizada_en=NOW()
       WHERE id=$1 AND estado='ACTIVA'
       RETURNING id`,
      [reserva.id, estadoReserva]
    );
    if (!actualizada.rows[0]) {
      throw new ApiError(409, "La reserva ya había sido finalizada.");
    }
  }

  const anterior = pedido.estado;
  await client.query(
    `INSERT INTO pedido_transiciones
       (pedido_id, estado_anterior, estado_nuevo, actor, usuario_id, motivo, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      pedido.id,
      anterior,
      estadoPedido,
      actorTransicion,
      usuarioId,
      motivo,
      `PEDIDO:${pedido.id}:${estadoPedido}`,
    ]
  );
}

async function cancelarPedido(client, { pedidoId, usuarioId = null, actor = "USUARIO", motivo }) {
  const usuarioValido = Number.isInteger(Number(usuarioId)) && Number(usuarioId) > 0;
  if ((actor === "USUARIO" && !usuarioValido)
      || (actor === "PUBLICO" && usuarioId != null)
      || !new Set(["USUARIO", "PUBLICO"]).has(actor)) {
    throw new ApiError(400, "Actor inválido para cancelar el pedido.");
  }
  const pedido = await bloquearPedido(client, pedidoId);
  if (!ESTADOS_CON_RESERVA.has(pedido.estado)) {
    throw new ApiError(409, "El pedido ya no tiene una reserva cancelable.");
  }
  const reservas = await cargarReservasActivas(client, [pedido.id]);
  if (!reservas.length) throw new ApiError(409, "El pedido no tiene reservas activas.");
  const productos = await bloquearProductos(
    client,
    reservas.map((reserva) => reserva.producto_id)
  );
  const descripcion = `Cancelación del pedido ${pedido.folio}: ${motivo}`;
  await finalizarReservas(client, {
    pedido,
    reservas,
    productos,
    estadoReserva: "LIBERADA",
    estadoPedido: "CANCELADO",
    tipoMovimiento: "LIBERACION_RESERVA",
    actorTransicion: actor,
    actorInventario: actor === "PUBLICO" ? "SISTEMA" : "USUARIO",
    usuarioId,
    motivo: descripcion,
    origen: "LIBERACION",
  });
  return cargarPedido(client, pedido.id);
}

async function expirarPedidosVencidos(client, { limit = 100, hasta = null } = {}) {
  const pedidosResult = await client.query(
    `SELECT * FROM pedidos
     WHERE estado IN ('RESERVADO','LISTO') AND expira_en <= COALESCE($2::timestamptz, NOW())
     ORDER BY id
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit, hasta]
  );
  const pedidos = pedidosResult.rows;
  if (!pedidos.length) return [];

  const reservas = await cargarReservasActivas(
    client,
    pedidos.map((pedido) => pedido.id)
  );
  const reservasPorPedido = new Map();
  for (const reserva of reservas) {
    const key = Number(reserva.pedido_id);
    if (!reservasPorPedido.has(key)) reservasPorPedido.set(key, []);
    reservasPorPedido.get(key).push(reserva);
  }
  for (const pedido of pedidos) {
    if (!reservasPorPedido.get(Number(pedido.id))?.length) {
      throw new ApiError(409, `El pedido ${pedido.folio} no tiene reservas activas.`);
    }
  }

  const productos = await bloquearProductos(
    client,
    reservas.map((reserva) => reserva.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  for (const pedido of pedidos) {
    const reservasPedido = reservasPorPedido.get(Number(pedido.id));
    await finalizarReservas(client, {
      pedido,
      reservas: reservasPedido,
      productos: reservasPedido.map((reserva) => productoPorId.get(Number(reserva.producto_id))),
      estadoReserva: "EXPIRADA",
      estadoPedido: "EXPIRADO",
      tipoMovimiento: "EXPIRACION_RESERVA",
      actorTransicion: "SISTEMA",
      actorInventario: "SISTEMA",
      usuarioId: null,
      motivo: `Reserva vencida del pedido ${pedido.folio}.`,
      origen: "EXPIRACION",
    });
  }
  return pedidos.map((pedido) => Number(pedido.id));
}

module.exports = {
  ESTADOS_CON_RESERVA,
  idPositivo,
  duracionReservaMinutos,
  cargarPedido,
  listarPedidos,
  crearPedidoReservado,
  marcarPedidoListo,
  cancelarPedido,
  expirarPedidosVencidos,
};
