const { ApiError } = require("../utils/errors");

function idsOrdenados(ids) {
  return [...new Set(ids.map(Number))].sort((a, b) => a - b);
}

async function bloquearProductos(client, ids) {
  const ordenados = idsOrdenados(ids);
  if (!ordenados.length) throw new ApiError(400, "Se requiere al menos un producto.");
  if (ordenados.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ApiError(400, "Producto inválido.");
  }
  const r = await client.query(
    `SELECT p.*
     FROM productos p
     WHERE p.id=ANY($1::int[])
     ORDER BY p.id
     FOR UPDATE`,
    [ordenados]
  );
  if (r.rowCount !== ordenados.length) {
    const encontrados = new Set(r.rows.map((row) => row.id));
    const faltante = ordenados.find((id) => !encontrados.has(id));
    throw new ApiError(404, `Producto ${faltante} no existe.`);
  }
  return r.rows;
}

async function aplicarMovimiento(client, {
  producto,
  deltaFisico = 0,
  deltaReservado = 0,
  deltaConsignado = 0,
  tipo,
  usuarioId = null,
  actor = usuarioId ? "USUARIO" : "SISTEMA",
  motivo = null,
  origenClave,
  ventaId = null,
  cancelacionId = null,
  devolucionId = null,
  pedidoId = null,
  reservaId = null,
  recepcionCompraId = null,
  detalleRecepcionCompraId = null,
  devolucionProveedorId = null,
  detalleDevolucionProveedorId = null,
  conteoInventarioId = null,
  detalleConteoInventarioId = null,
  tirajeEditorialId = null,
  consignacionOperacionId = null,
  detalleConsignacionOperacionId = null,
}) {
  const fisicoAnterior = Number(producto.stock);
  const reservadoAnterior = Number(producto.stock_reservado || 0);
  const consignadoAnterior = Number(producto.stock_consignado || 0);
  const fisicoNuevo = fisicoAnterior + Number(deltaFisico);
  const reservadoNuevo = reservadoAnterior + Number(deltaReservado);
  const consignadoNuevo = consignadoAnterior + Number(deltaConsignado);
  if (!Number.isInteger(fisicoNuevo)
      || !Number.isInteger(reservadoNuevo)
      || !Number.isInteger(consignadoNuevo)) {
    throw new ApiError(400, "Los movimientos de inventario deben usar cantidades enteras.");
  }
  if (fisicoNuevo < 0) throw new ApiError(409, `Stock insuficiente de "${producto.titulo}".`);
  if (reservadoNuevo < 0 || reservadoNuevo > fisicoNuevo) {
    throw new ApiError(409, `La operación afectaría unidades reservadas de "${producto.titulo}".`);
  }
  if (consignadoNuevo < 0) {
    throw new ApiError(409, `La operación afectaría unidades consignadas de "${producto.titulo}".`);
  }

  const actualizado = await client.query(
    `UPDATE productos
     SET stock=$2, stock_reservado=$3, stock_consignado=$4, actualizado_en=NOW()
     WHERE id=$1
     RETURNING *`,
    [producto.id, fisicoNuevo, reservadoNuevo, consignadoNuevo]
  );
  const mov = await client.query(
    `INSERT INTO inventario_movimientos
       (producto_id, tipo, delta_fisico, delta_reservado, delta_consignado,
        stock_fisico_resultante, stock_reservado_resultante,
        stock_consignado_resultante,
        actor, usuario_id, motivo, venta_id, cancelacion_id, devolucion_id,
        pedido_id, reserva_id, origen_clave,
        recepcion_compra_id, detalle_recepcion_compra_id,
        devolucion_proveedor_id, detalle_devolucion_proveedor_id,
        conteo_inventario_id, detalle_conteo_inventario_id,
        tiraje_editorial_id, consignacion_operacion_id,
        detalle_consignacion_operacion_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26)
     RETURNING *`,
    [
      producto.id, tipo, deltaFisico, deltaReservado, deltaConsignado,
      fisicoNuevo, reservadoNuevo, consignadoNuevo,
      actor, usuarioId, motivo, ventaId, cancelacionId, devolucionId,
      pedidoId, reservaId, origenClave,
      recepcionCompraId, detalleRecepcionCompraId,
      devolucionProveedorId, detalleDevolucionProveedorId,
      conteoInventarioId, detalleConteoInventarioId,
      tirajeEditorialId,
      consignacionOperacionId, detalleConsignacionOperacionId,
    ]
  );

  Object.assign(producto, actualizado.rows[0]);
  return { producto: actualizado.rows[0], movimiento: mov.rows[0] };
}

module.exports = { bloquearProductos, aplicarMovimiento, idsOrdenados };
