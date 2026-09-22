const { ApiError, round2 } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento } = require("./inventario.service");
const { compactarItems, cotizar } = require("./precios.service");
const { cargarClienteActivo } = require("./clientes.service");
const { idEditorialPositivo } = require("./editorial-obras.service");

const TIPOS_CONSIGNATARIO = new Set(["LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"]);

function montoLinea(linea, cantidad) {
  const importe = round2(Number(linea.precio_unitario) * cantidad);
  const descuento = round2(Number(linea.descuento_unitario) * cantidad);
  const subtotal = round2(importe / (1 + Number(linea.iva_porcentaje) / 100));
  return {
    subtotal,
    descuento,
    iva: round2(importe - subtotal),
    importe,
  };
}

function totalesLineas(lineas) {
  return lineas.reduce((totales, linea) => ({
    subtotal: round2(totales.subtotal + linea.montos.subtotal),
    descuento: round2(totales.descuento + linea.montos.descuento),
    iva: round2(totales.iva + linea.montos.iva),
    total: round2(totales.total + linea.montos.importe),
  }), { subtotal: 0, descuento: 0, iva: 0, total: 0 });
}

async function consultarDetalles(db, consignacionId, { bloquear = false } = {}) {
  const result = await db.query(
    `SELECT d.*, p.stock AS stock_tienda_actual,
            p.stock_reservado AS stock_reservado_actual,
            p.stock_consignado AS stock_consignado_actual,
            p.stock_disponible AS stock_disponible_actual,
            (d.cantidad_enviada-d.cantidad_vendida-d.cantidad_devuelta)::int
              AS cantidad_pendiente
     FROM consignacion_detalles d
     JOIN productos p ON p.id=d.producto_id
     WHERE d.consignacion_editorial_id=$1
     ORDER BY d.producto_id
     ${bloquear ? "FOR UPDATE OF d" : ""}`,
    [consignacionId]
  );
  return result.rows;
}

async function cargarConsignacionEditorial(db, consignacionId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(consignacionId, "consignacion_editorial_id");
  const cabecera = await db.query(
    `SELECT c.*, cli.nombre AS cliente_nombre_actual,
            cli.tipo_comercial AS tipo_comercial_actual,
            cli.segmento_precio AS segmento_precio_actual,
            uc.nombre AS creado_por, ue.nombre AS enviado_por,
            ux.nombre AS cerrado_por, ua.nombre AS cancelado_por
     FROM consignaciones_editoriales c
     JOIN clientes cli ON cli.id=c.cliente_id
     JOIN usuarios uc ON uc.id=c.creado_por_usuario_id
     LEFT JOIN usuarios ue ON ue.id=c.enviado_por_usuario_id
     LEFT JOIN usuarios ux ON ux.id=c.cerrado_por_usuario_id
     LEFT JOIN usuarios ua ON ua.id=c.cancelado_por_usuario_id
     WHERE c.id=$1
     ${bloquear ? "FOR UPDATE OF c" : ""}`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Consignación editorial no encontrada.");

  // Estas consultas también se ejecutan desde transacciones con un único
  // cliente pg; mantenerlas secuenciales evita solapar client.query().
  const detalles = await consultarDetalles(db, id);
  const operaciones = await db.query(
    `SELECT o.*, u.nombre AS usuario
     FROM consignacion_operaciones o
     JOIN usuarios u ON u.id=o.usuario_id
     WHERE o.consignacion_editorial_id=$1
     ORDER BY o.creado_en, o.id`,
    [id]
  );
  const detallesOperacion = await db.query(
    `SELECT od.*
     FROM consignacion_operacion_detalles od
     WHERE od.consignacion_editorial_id=$1
     ORDER BY od.consignacion_operacion_id, od.id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT t.*, u.nombre AS usuario
     FROM consignacion_transiciones t
     JOIN usuarios u ON u.id=t.usuario_id
     WHERE t.consignacion_editorial_id=$1 ORDER BY t.id`,
    [id]
  );
  const movimientos = await db.query(
    `SELECT m.*
     FROM inventario_movimientos m
     JOIN consignacion_operaciones o ON o.id=m.consignacion_operacion_id
     WHERE o.consignacion_editorial_id=$1 ORDER BY m.id`,
    [id]
  );
  const detallesPorOperacion = new Map();
  for (const detalle of detallesOperacion.rows) {
    const operacionId = Number(detalle.consignacion_operacion_id);
    if (!detallesPorOperacion.has(operacionId)) detallesPorOperacion.set(operacionId, []);
    detallesPorOperacion.get(operacionId).push(detalle);
  }
  const operacionesCompletas = operaciones.rows.map((operacion) => ({
    ...operacion,
    detalles: detallesPorOperacion.get(Number(operacion.id)) || [],
  }));
  const resumen = detalles.reduce((totales, detalle) => ({
    unidades_enviadas: totales.unidades_enviadas + Number(detalle.cantidad_enviada),
    unidades_vendidas: totales.unidades_vendidas + Number(detalle.cantidad_vendida),
    unidades_devueltas: totales.unidades_devueltas + Number(detalle.cantidad_devuelta),
    unidades_pendientes: totales.unidades_pendientes + Number(detalle.cantidad_pendiente),
    valor_enviado: round2(totales.valor_enviado + Number(detalle.importe_enviado)),
  }), {
    unidades_enviadas: 0,
    unidades_vendidas: 0,
    unidades_devueltas: 0,
    unidades_pendientes: 0,
    valor_enviado: 0,
  });
  resumen.venta_reportada = round2(operacionesCompletas
    .filter((operacion) => operacion.tipo === "VENTA")
    .reduce((total, operacion) => total + Number(operacion.total), 0));
  return {
    ...cabecera.rows[0],
    resumen,
    detalles,
    operaciones: operacionesCompletas,
    transiciones: transiciones.rows,
    movimientos_inventario: movimientos.rows,
  };
}

async function listarConsignacionesEditoriales(db, {
  estado = null,
  clienteId = null,
  tipoComercial = null,
  q = "",
  page = 1,
  limit = 30,
} = {}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT c.*,
            COALESCE(SUM(d.cantidad_enviada),0)::int AS unidades_enviadas,
            COALESCE(SUM(d.cantidad_vendida),0)::int AS unidades_vendidas,
            COALESCE(SUM(d.cantidad_devuelta),0)::int AS unidades_devueltas,
            COALESCE(SUM(d.cantidad_enviada-d.cantidad_vendida-d.cantidad_devuelta),0)::int
              AS unidades_pendientes,
            COALESCE(SUM(d.importe_enviado),0)::numeric(14,2) AS valor_enviado
     FROM consignaciones_editoriales c
     LEFT JOIN consignacion_detalles d ON d.consignacion_editorial_id=c.id
     WHERE ($1::text IS NULL OR c.estado=$1)
       AND ($2::bigint IS NULL OR c.cliente_id=$2)
       AND ($3::text IS NULL OR c.tipo_comercial=$3)
       AND (
         $4::text=''
         OR c.folio ILIKE '%'||$4||'%'
         OR c.cliente_nombre ILIKE '%'||$4||'%'
         OR COALESCE(c.referencia,'') ILIKE '%'||$4||'%'
       )
     GROUP BY c.id
     ORDER BY c.creado_en DESC, c.id DESC
     LIMIT $5 OFFSET $6`,
    [estado, clienteId, tipoComercial, q, limit, offset]
  );
  return { consignaciones: result.rows, page, limit };
}

async function crearConsignacionEditorial(client, {
  clienteId,
  fechaEnvioProgramada,
  fechaLimite = null,
  moneda = "MXN",
  referencia = null,
  notas = null,
  items,
  usuarioId,
  origenClave,
}) {
  const cliente = await cargarClienteActivo(client, clienteId);
  if (!TIPOS_CONSIGNATARIO.has(cliente.tipo_comercial)) {
    throw new ApiError(409, "El cliente no está clasificado como librería, distribuidor o institución.");
  }
  if (cliente.segmento_precio !== "MAYOREO") {
    throw new ApiError(409, "El consignatario debe usar el segmento de precio MAYOREO.");
  }
  const compactados = compactarItems(items, "producto_id");
  const productos = await bloquearProductos(
    client,
    compactados.map((item) => item.producto_id)
  );
  for (const producto of productos) {
    if (!producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
  }
  const cotizacion = await cotizar(client, {
    items: compactados,
    canal: "POS",
    productosBloqueados: productos,
    segmentoCliente: cliente.segmento_precio,
  });
  const creada = await client.query(
    `INSERT INTO consignaciones_editoriales
       (cliente_id, cliente_nombre, cliente_telefono, cliente_email,
        cliente_direccion, tipo_comercial, segmento_precio,
        fecha_envio_programada, fecha_limite, moneda, referencia, notas,
        creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      cliente.id, cliente.nombre, cliente.telefono || null,
      cliente.email || null, cliente.direccion || null,
      cliente.tipo_comercial, cliente.segmento_precio,
      fechaEnvioProgramada, fechaLimite, moneda, referencia, notas, usuarioId,
    ]
  );
  const consignacionId = creada.rows[0].id;
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const precioPorId = new Map(cotizacion.lineas.map((linea) => [Number(linea.producto_id), linea]));
  for (const item of compactados) {
    const producto = productoPorId.get(Number(item.producto_id));
    const precio = precioPorId.get(Number(item.producto_id));
    const linea = {
      precio_unitario: precio.precio_unitario,
      descuento_unitario: precio.descuento_unitario,
      iva_porcentaje: precio.iva,
    };
    const montos = montoLinea(linea, item.cantidad);
    await client.query(
      `INSERT INTO consignacion_detalles
         (consignacion_editorial_id, producto_id, producto_sku,
          producto_titulo, producto_isbn, cantidad_enviada,
          precio_lista, descuento_unitario, precio_unitario, iva_porcentaje,
          regla_precio_id, subtotal_enviado, descuento_enviado, iva_enviado,
          importe_enviado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        consignacionId, producto.id, producto.sku, producto.titulo,
        producto.isbn || null, item.cantidad,
        precio.precio_lista, precio.descuento_unitario, precio.precio_unitario,
        precio.iva, precio.regla_precio_id,
        montos.subtotal, montos.descuento, montos.iva, montos.importe,
      ]
    );
  }
  await client.query(
    `INSERT INTO consignacion_transiciones
       (consignacion_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'BORRADOR',$2,$3,$4)`,
    [consignacionId, usuarioId, "Consignación editorial creada.", origenClave]
  );
  return cargarConsignacionEditorial(client, consignacionId);
}

async function crearOperacion(client, {
  consignacion,
  tipo,
  lineas,
  usuarioId,
  referencia = null,
  motivo,
  origenClave,
}) {
  const conMontos = lineas.map((linea) => ({
    ...linea,
    montos: montoLinea(linea.detalle, linea.cantidad),
  }));
  const totales = totalesLineas(conMontos);
  const operacionResult = await client.query(
    `INSERT INTO consignacion_operaciones
       (consignacion_editorial_id, tipo, usuario_id, referencia, motivo,
        subtotal, descuento, iva, total, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      consignacion.id, tipo, usuarioId, referencia, motivo,
      totales.subtotal, totales.descuento, totales.iva, totales.total, origenClave,
    ]
  );
  const operacion = operacionResult.rows[0];
  for (const linea of conMontos) {
    const detalle = linea.detalle;
    const opDetalleResult = await client.query(
      `INSERT INTO consignacion_operacion_detalles
         (consignacion_operacion_id, consignacion_editorial_id,
          consignacion_detalle_id, producto_id, cantidad,
          precio_lista, descuento_unitario, precio_unitario, iva_porcentaje,
          subtotal, descuento, iva, importe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        operacion.id, consignacion.id, detalle.id, detalle.producto_id,
        linea.cantidad, detalle.precio_lista, detalle.descuento_unitario,
        detalle.precio_unitario, detalle.iva_porcentaje,
        linea.montos.subtotal, linea.montos.descuento,
        linea.montos.iva, linea.montos.importe,
      ]
    );
    const opDetalle = opDetalleResult.rows[0];
    const producto = linea.producto;
    const inventario = tipo === "ENVIO"
      ? { tipo: "SALIDA_CONSIGNACION", deltaFisico: -linea.cantidad, deltaConsignado: linea.cantidad }
      : tipo === "VENTA"
        ? { tipo: "VENTA_CONSIGNACION", deltaFisico: 0, deltaConsignado: -linea.cantidad }
        : { tipo: "DEVOLUCION_CONSIGNACION", deltaFisico: linea.cantidad, deltaConsignado: -linea.cantidad };
    await aplicarMovimiento(client, {
      producto,
      ...inventario,
      usuarioId,
      motivo,
      consignacionOperacionId: operacion.id,
      detalleConsignacionOperacionId: opDetalle.id,
      origenClave: `CONSIGNACION:${consignacion.id}:OPERACION:${operacion.id}:DETALLE:${opDetalle.id}`,
    });
  }
  return operacion;
}

async function despacharConsignacionEditorial(client, {
  consignacionId,
  usuarioId,
  motivo,
  referencia = null,
  origenClave,
}) {
  const consignacion = await cargarConsignacionEditorial(
    client,
    consignacionId,
    { bloquear: true }
  );
  if (consignacion.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo una consignación en borrador puede enviarse.");
  }
  const detalles = await consultarDetalles(client, consignacion.id, { bloquear: true });
  if (!detalles.length) throw new ApiError(409, "La consignación no tiene artículos.");
  const productos = await bloquearProductos(client, detalles.map((detalle) => detalle.producto_id));
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const lineas = detalles.map((detalle) => {
    const producto = productoPorId.get(Number(detalle.producto_id));
    if (!producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
    if (Number(producto.stock_disponible) < Number(detalle.cantidad_enviada)) {
      throw new ApiError(
        409,
        `Stock disponible insuficiente de "${producto.titulo}" para el envío.`
      );
    }
    return { detalle, producto, cantidad: Number(detalle.cantidad_enviada) };
  });
  await crearOperacion(client, {
    consignacion,
    tipo: "ENVIO",
    lineas,
    usuarioId,
    referencia,
    motivo,
    origenClave,
  });
  await client.query(`SELECT set_config('libra.aplicando_consignacion','1',true)`);
  await client.query(
    `UPDATE consignaciones_editoriales
     SET estado='ENVIADA', enviado_por_usuario_id=$2, enviado_en=NOW()
     WHERE id=$1`,
    [consignacion.id, usuarioId]
  );
  await client.query(
    `INSERT INTO consignacion_transiciones
       (consignacion_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','ENVIADA',$2,$3,$4)`,
    [consignacion.id, usuarioId, motivo, `${origenClave}:TRANSICION`]
  );
  return cargarConsignacionEditorial(client, consignacion.id);
}

async function registrarOperacionConsignacion(client, {
  consignacionId,
  tipo,
  items,
  usuarioId,
  referencia = null,
  motivo,
  origenClave,
}) {
  if (!new Set(["VENTA", "DEVOLUCION"]).has(tipo)) {
    throw new ApiError(400, "Tipo de operación de consignación inválido.");
  }
  const consignacion = await cargarConsignacionEditorial(
    client,
    consignacionId,
    { bloquear: true }
  );
  if (!new Set(["ENVIADA", "PARCIAL"]).has(consignacion.estado)) {
    throw new ApiError(409, "La consignación no admite nuevas operaciones.");
  }
  const compactados = compactarItems(items, "producto_id");
  const detalles = await consultarDetalles(client, consignacion.id, { bloquear: true });
  const detallePorProducto = new Map(detalles.map((detalle) => [Number(detalle.producto_id), detalle]));
  for (const item of compactados) {
    const detalle = detallePorProducto.get(Number(item.producto_id));
    if (!detalle) throw new ApiError(404, `El producto ${item.producto_id} no pertenece a la consignación.`);
    if (Number(item.cantidad) > Number(detalle.cantidad_pendiente)) {
      throw new ApiError(
        409,
        `La cantidad supera el saldo consignado de "${detalle.producto_titulo}".`
      );
    }
  }
  const productos = await bloquearProductos(
    client,
    compactados.map((item) => item.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const lineas = compactados.map((item) => ({
    detalle: detallePorProducto.get(Number(item.producto_id)),
    producto: productoPorId.get(Number(item.producto_id)),
    cantidad: Number(item.cantidad),
  }));
  await crearOperacion(client, {
    consignacion,
    tipo,
    lineas,
    usuarioId,
    referencia,
    motivo,
    origenClave,
  });
  await client.query(`SELECT set_config('libra.aplicando_consignacion','1',true)`);
  for (const linea of lineas) {
    await client.query(
      `UPDATE consignacion_detalles
       SET ${tipo === "VENTA"
    ? "cantidad_vendida=cantidad_vendida+$2"
    : "cantidad_devuelta=cantidad_devuelta+$2"}
       WHERE id=$1`,
      [linea.detalle.id, linea.cantidad]
    );
  }
  const procesadas = lineas.reduce((total, linea) => total + linea.cantidad, 0);
  const pendientesAntes = detalles.reduce(
    (total, detalle) => total + Number(detalle.cantidad_pendiente),
    0
  );
  const pendientesDespues = pendientesAntes - procesadas;
  const estadoNuevo = pendientesDespues === 0 ? "LIQUIDADA" : "PARCIAL";
  if (consignacion.estado !== estadoNuevo) {
    await client.query(
      `UPDATE consignaciones_editoriales SET estado=$2 WHERE id=$1`,
      [consignacion.id, estadoNuevo]
    );
    await client.query(
      `INSERT INTO consignacion_transiciones
         (consignacion_editorial_id, estado_anterior, estado_nuevo,
          usuario_id, motivo, origen_clave)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        consignacion.id, consignacion.estado, estadoNuevo, usuarioId,
        estadoNuevo === "LIQUIDADA"
          ? "Todas las unidades enviadas quedaron vendidas o devueltas."
          : "Se registró actividad parcial de consignación.",
        `${origenClave}:TRANSICION`,
      ]
    );
  }
  return cargarConsignacionEditorial(client, consignacion.id);
}

async function cerrarConsignacionEditorial(client, {
  consignacionId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const consignacion = await cargarConsignacionEditorial(
    client,
    consignacionId,
    { bloquear: true }
  );
  if (consignacion.estado !== "LIQUIDADA") {
    throw new ApiError(409, "La consignación sólo puede cerrarse cuando no quedan unidades pendientes.");
  }
  await client.query(`SELECT set_config('libra.aplicando_consignacion','1',true)`);
  await client.query(
    `UPDATE consignaciones_editoriales
     SET estado='CERRADA', cerrado_por_usuario_id=$2, cerrado_en=NOW()
     WHERE id=$1`,
    [consignacion.id, usuarioId]
  );
  await client.query(
    `INSERT INTO consignacion_transiciones
       (consignacion_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'LIQUIDADA','CERRADA',$2,$3,$4)`,
    [consignacion.id, usuarioId, motivo, origenClave]
  );
  return cargarConsignacionEditorial(client, consignacion.id);
}

async function cancelarConsignacionEditorial(client, {
  consignacionId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const consignacion = await cargarConsignacionEditorial(
    client,
    consignacionId,
    { bloquear: true }
  );
  if (consignacion.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo una consignación sin enviar puede cancelarse.");
  }
  await client.query(`SELECT set_config('libra.aplicando_consignacion','1',true)`);
  await client.query(
    `UPDATE consignaciones_editoriales
     SET estado='CANCELADA', cancelado_por_usuario_id=$2,
         cancelado_en=NOW(), cancelacion_motivo=$3
     WHERE id=$1`,
    [consignacion.id, usuarioId, motivo]
  );
  await client.query(
    `INSERT INTO consignacion_transiciones
       (consignacion_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','CANCELADA',$2,$3,$4)`,
    [consignacion.id, usuarioId, motivo, origenClave]
  );
  return cargarConsignacionEditorial(client, consignacion.id);
}

module.exports = {
  TIPOS_CONSIGNATARIO,
  cargarConsignacionEditorial,
  listarConsignacionesEditoriales,
  crearConsignacionEditorial,
  despacharConsignacionEditorial,
  registrarOperacionConsignacion,
  cerrarConsignacionEditorial,
  cancelarConsignacionEditorial,
};
