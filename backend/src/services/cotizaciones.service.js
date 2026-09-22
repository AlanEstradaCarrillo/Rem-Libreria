const { ApiError } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento } = require("./inventario.service");
const { compactarItems, cotizar } = require("./precios.service");
const { cargarClienteActivo } = require("./clientes.service");
const { duracionReservaMinutos, cargarPedido } = require("./pedidos.service");

function idCotizacionPositivo(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "cotizacion_id inválido.");
  }
  return id;
}

async function cargarCotizacion(db, cotizacionId) {
  const id = idCotizacionPositivo(cotizacionId);
  const cabecera = await db.query(
    `SELECT c.*, u.nombre AS creado_por,
            p.id AS pedido_id, p.folio AS pedido_folio, p.estado AS pedido_estado,
            (c.estado='VIGENTE' AND c.vigente_hasta <= NOW()) AS vencida
     FROM cotizaciones c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     LEFT JOIN pedidos p ON p.cotizacion_id=c.id
     WHERE c.id=$1`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Cotización no encontrada.");

  const detalle = await db.query(
    `SELECT * FROM detalle_cotizaciones
     WHERE cotizacion_id=$1 ORDER BY id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT ct.*, u.nombre AS usuario
     FROM cotizacion_transiciones ct
     LEFT JOIN usuarios u ON u.id=ct.usuario_id
     WHERE ct.cotizacion_id=$1
     ORDER BY ct.id`,
    [id]
  );
  return {
    ...cabecera.rows[0],
    detalle: detalle.rows,
    transiciones: transiciones.rows,
  };
}

async function listarCotizaciones(db, {
  estado = null,
  clienteId = null,
  q = "",
  page = 1,
  limit = 30,
} = {}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT c.id, c.folio, c.estado, c.cliente_id, c.cliente_nombre,
            c.cliente_telefono, c.segmento_precio, c.total, c.vigente_hasta,
            c.creado_en, c.creado_por_usuario_id, u.nombre AS creado_por,
            p.id AS pedido_id, p.folio AS pedido_folio, p.estado AS pedido_estado,
            (c.estado='VIGENTE' AND c.vigente_hasta <= NOW()) AS vencida
     FROM cotizaciones c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     LEFT JOIN pedidos p ON p.cotizacion_id=c.id
     WHERE ($1::text IS NULL OR c.estado=$1)
       AND ($2::bigint IS NULL OR c.cliente_id=$2)
       AND (
         $3::text=''
         OR c.folio ILIKE '%' || $3 || '%'
         OR c.cliente_nombre ILIKE '%' || $3 || '%'
         OR c.cliente_telefono ILIKE '%' || $3 || '%'
         OR COALESCE(c.cliente_email, '') ILIKE '%' || $3 || '%'
       )
     ORDER BY c.id DESC
     LIMIT $4 OFFSET $5`,
    [estado, clienteId, q, limit, offset]
  );
  return { page, limit, resultados: result.rows };
}

async function crearCotizacion(client, {
  usuarioId,
  clienteId,
  items,
  notas = null,
  vigenciaDias = 7,
}) {
  const usuario = Number(usuarioId);
  if (!Number.isInteger(usuario) || usuario <= 0) {
    throw new ApiError(400, "La cotización requiere un usuario válido.");
  }
  const dias = Number(vigenciaDias);
  if (!Number.isInteger(dias) || dias < 1 || dias > 90) {
    throw new ApiError(400, "La vigencia debe estar entre 1 y 90 días.");
  }

  const cliente = await cargarClienteActivo(client, clienteId, { exigirTelefono: true });
  const compactados = compactarItems(items, "producto_id");
  const productos = await bloquearProductos(
    client,
    compactados.map((item) => item.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const precios = await cotizar(client, {
    items: compactados,
    canal: "POS",
    productosBloqueados: productos,
    segmentoCliente: cliente.segmento_precio,
  });

  const creada = await client.query(
    `INSERT INTO cotizaciones
       (cliente_id, creado_por_usuario_id, cliente_nombre, cliente_telefono,
        cliente_email, cliente_direccion, segmento_precio, notas,
        subtotal, descuento, iva, total, vigente_hasta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             NOW() + ($13::integer * INTERVAL '1 day'))
     RETURNING *`,
    [
      cliente.id,
      usuario,
      cliente.nombre,
      cliente.telefono,
      cliente.email || null,
      cliente.direccion || null,
      cliente.segmento_precio,
      notas,
      precios.subtotal,
      precios.descuento,
      precios.iva,
      precios.total,
      dias,
    ]
  );
  const cotizacion = creada.rows[0];
  const lineaPorProducto = new Map(
    precios.lineas.map((linea) => [Number(linea.producto_id), linea])
  );

  for (const item of compactados) {
    const producto = productoPorId.get(Number(item.producto_id));
    const linea = lineaPorProducto.get(Number(item.producto_id));
    await client.query(
      `INSERT INTO detalle_cotizaciones
         (cotizacion_id, producto_id, producto_sku, producto_titulo, cantidad,
          precio_lista, descuento_unitario, precio_unitario, iva_porcentaje,
          regla_precio_id, importe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        cotizacion.id,
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
  }

  return cargarCotizacion(client, cotizacion.id);
}

async function bloquearCotizacion(client, cotizacionId) {
  const id = idCotizacionPositivo(cotizacionId);
  const result = await client.query(
    `SELECT c.*, (c.vigente_hasta <= NOW()) AS vencida
     FROM cotizaciones c WHERE c.id=$1 FOR UPDATE`,
    [id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Cotización no encontrada.");
  return result.rows[0];
}

async function crearPedidoDesdeCotizacion(client, {
  cotizacionId,
  usuarioId,
  tipoEntrega = "RECOLECCION",
}) {
  const usuario = Number(usuarioId);
  if (!Number.isInteger(usuario) || usuario <= 0) {
    throw new ApiError(400, "La conversión requiere un usuario válido.");
  }
  const cotizacion = await bloquearCotizacion(client, cotizacionId);
  if (cotizacion.estado !== "VIGENTE") {
    throw new ApiError(409, "La cotización ya no está vigente para convertirse.");
  }
  if (cotizacion.vencida) {
    throw new ApiError(409, "La cotización venció; procesa los vencimientos antes de continuar.");
  }

  await cargarClienteActivo(client, cotizacion.cliente_id);
  if (tipoEntrega === "ENVIO" && !String(cotizacion.cliente_direccion || "").trim()) {
    throw new ApiError(409, "El cliente no tiene una dirección registrada para envío.");
  }

  const detalleResult = await client.query(
    `SELECT * FROM detalle_cotizaciones
     WHERE cotizacion_id=$1 ORDER BY producto_id`,
    [cotizacion.id]
  );
  if (!detalleResult.rows.length) {
    throw new ApiError(409, "La cotización no tiene artículos.");
  }
  const productos = await bloquearProductos(
    client,
    detalleResult.rows.map((linea) => linea.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  for (const linea of detalleResult.rows) {
    const producto = productoPorId.get(Number(linea.producto_id));
    if (!producto) throw new ApiError(404, `Producto ${linea.producto_id} no existe.`);
    if (!producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
    if (Number(producto.stock_disponible) < Number(linea.cantidad)) {
      throw new ApiError(
        409,
        `Stock insuficiente de "${producto.titulo}" (disponible: ${producto.stock_disponible}).`
      );
    }
  }

  const minutos = duracionReservaMinutos();
  const pedidoResult = await client.query(
    `INSERT INTO pedidos
       (canal, canal_precio, estado, publico_actor_clave, cotizacion_id,
        cliente_id, creado_por_usuario_id, cliente_nombre, cliente_telefono,
        cliente_email, cliente_direccion, segmento_precio, tipo_entrega, notas,
        subtotal, descuento, iva, total, expira_en)
     VALUES
       ('INTERNO','POS','RESERVADO',NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,NOW() + ($15::integer * INTERVAL '1 minute'))
     RETURNING *`,
    [
      cotizacion.id,
      cotizacion.cliente_id,
      usuario,
      cotizacion.cliente_nombre,
      cotizacion.cliente_telefono,
      cotizacion.cliente_email,
      cotizacion.cliente_direccion,
      cotizacion.segmento_precio,
      tipoEntrega,
      cotizacion.notas,
      cotizacion.subtotal,
      cotizacion.descuento,
      cotizacion.iva,
      cotizacion.total,
      minutos,
    ]
  );
  const pedido = pedidoResult.rows[0];

  for (const linea of detalleResult.rows) {
    const producto = productoPorId.get(Number(linea.producto_id));
    const detallePedido = await client.query(
      `INSERT INTO detalle_pedidos
         (pedido_id, producto_id, producto_sku, producto_titulo, cantidad,
          precio_lista, descuento_unitario, precio_unitario, iva_porcentaje,
          regla_precio_id, importe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        pedido.id,
        linea.producto_id,
        linea.producto_sku,
        linea.producto_titulo,
        linea.cantidad,
        linea.precio_lista,
        linea.descuento_unitario,
        linea.precio_unitario,
        linea.iva_porcentaje,
        linea.regla_precio_id,
        linea.importe,
      ]
    );
    const reservaResult = await client.query(
      `INSERT INTO reservas_stock
         (pedido_id, detalle_pedido_id, producto_id, cantidad, estado, expira_en)
       VALUES ($1,$2,$3,$4,'ACTIVA',(SELECT expira_en FROM pedidos WHERE id=$1))
       RETURNING *`,
      [pedido.id, detallePedido.rows[0].id, linea.producto_id, linea.cantidad]
    );
    const reserva = reservaResult.rows[0];
    await aplicarMovimiento(client, {
      producto,
      deltaReservado: Number(linea.cantidad),
      tipo: "RESERVA",
      usuarioId: usuario,
      motivo: `Reserva del pedido ${pedido.folio} desde cotización ${cotizacion.folio}`,
      pedidoId: pedido.id,
      reservaId: reserva.id,
      origenClave: `PEDIDO:${pedido.id}:RESERVA:${reserva.id}`,
    });
  }

  await client.query(
    `INSERT INTO cotizacion_transiciones
       (cotizacion_id, estado_anterior, estado_nuevo, actor, usuario_id,
        motivo, origen_clave)
     VALUES ($1,'VIGENTE','CONVERTIDA','USUARIO',$2,$3,$4)`,
    [
      cotizacion.id,
      usuario,
      `Cotización convertida en el pedido ${pedido.folio}.`,
      `COTIZACION:${cotizacion.id}:CONVERTIDA`,
    ]
  );

  return {
    cotizacion: await cargarCotizacion(client, cotizacion.id),
    pedido: await cargarPedido(client, pedido.id),
  };
}

async function cargarConversionPorPedido(db, pedidoId) {
  const pedido = await cargarPedido(db, pedidoId);
  if (pedido.cotizacion_id == null) {
    throw new ApiError(409, "El pedido no proviene de una cotización.");
  }
  return {
    cotizacion: await cargarCotizacion(db, pedido.cotizacion_id),
    pedido,
  };
}

async function cancelarCotizacion(client, { cotizacionId, usuarioId, motivo }) {
  const cotizacion = await bloquearCotizacion(client, cotizacionId);
  if (cotizacion.estado !== "VIGENTE") {
    throw new ApiError(409, "La cotización ya no puede cancelarse.");
  }
  if (cotizacion.vencida) {
    throw new ApiError(409, "La cotización venció; procesa los vencimientos antes de continuar.");
  }
  await client.query(
    `INSERT INTO cotizacion_transiciones
       (cotizacion_id, estado_anterior, estado_nuevo, actor, usuario_id,
        motivo, origen_clave)
     VALUES ($1,'VIGENTE','CANCELADA','USUARIO',$2,$3,$4)`,
    [
      cotizacion.id,
      usuarioId,
      motivo,
      `COTIZACION:${cotizacion.id}:CANCELADA`,
    ]
  );
  return cargarCotizacion(client, cotizacion.id);
}

async function expirarCotizacionesVencidas(client, { limit = 100, hasta = null } = {}) {
  const result = await client.query(
    `SELECT * FROM cotizaciones
     WHERE estado='VIGENTE' AND vigente_hasta <= COALESCE($2::timestamptz, NOW())
     ORDER BY id
     FOR UPDATE SKIP LOCKED
     LIMIT $1`,
    [limit, hasta]
  );
  for (const cotizacion of result.rows) {
    await client.query(
      `INSERT INTO cotizacion_transiciones
         (cotizacion_id, estado_anterior, estado_nuevo, actor, usuario_id,
          motivo, origen_clave)
       VALUES ($1,'VIGENTE','VENCIDA','SISTEMA',NULL,$2,$3)`,
      [
        cotizacion.id,
        `Vencimiento de la cotización ${cotizacion.folio}.`,
        `COTIZACION:${cotizacion.id}:VENCIDA`,
      ]
    );
  }
  return result.rows.map((cotizacion) => Number(cotizacion.id));
}

module.exports = {
  idCotizacionPositivo,
  cargarCotizacion,
  listarCotizaciones,
  crearCotizacion,
  crearPedidoDesdeCotizacion,
  cargarConversionPorPedido,
  cancelarCotizacion,
  expirarCotizacionesVencidas,
};
