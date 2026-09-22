const { ApiError, round2 } = require("../utils/errors");
const { SEGMENTOS_PRECIO, cargarClienteActivo } = require("./clientes.service");

function compactarItems(items, idKey = "producto_id") {
  const cantidades = new Map();
  for (const item of items) {
    const id = item[idKey];
    cantidades.set(id, (cantidades.get(id) || 0) + item.cantidad);
  }
  return [...cantidades.entries()]
    .map(([id, cantidad]) => {
      if (cantidad > 999) {
        throw new ApiError(400, "La cantidad acumulada por artículo no puede superar 999.");
      }
      return { [idKey]: id, cantidad };
    })
    .sort((a, b) => a[idKey] - b[idKey]);
}

async function cotizar(client, {
  items,
  canal = "POS",
  fecha = null,
  productosBloqueados = null,
  clienteId = null,
  segmentoCliente = null,
}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("cotizar requiere un cliente PostgreSQL con query().");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "La cotización requiere al menos un artículo.");
  }
  if (!new Set(["POS", "WEB"]).has(canal)) {
    throw new ApiError(400, "Canal de precio inválido.");
  }
  if (clienteId != null && segmentoCliente != null) {
    throw new ApiError(400, "No combines cliente_id con un segmento interno de precio.");
  }
  if (canal === "WEB" && clienteId != null) {
    throw new ApiError(400, "La tienda pública no acepta un cliente registrado para cotizar.");
  }

  let segmento = segmentoCliente || "PUBLICO";
  if (clienteId != null) {
    const cliente = await cargarClienteActivo(client, clienteId);
    segmento = cliente.segmento_precio;
  }
  if (!SEGMENTOS_PRECIO.has(segmento)) {
    throw new ApiError(400, "Segmento de precio inválido.");
  }

  const compactados = compactarItems(items, "producto_id");
  const bloqueados = productosBloqueados
    ? new Map(productosBloqueados.map((producto) => [Number(producto.id), producto]))
    : null;
  const r = await client.query(
    `SELECT i.producto_id, i.cantidad, p.titulo, p.iva, p.activo, p.publicado_web,
            p.stock_disponible,
            pc.precio_lista, pc.descuento_unitario, pc.precio_unitario, pc.regla_precio_id
     FROM unnest($1::int[], $2::int[]) WITH ORDINALITY
       AS i(producto_id, cantidad, orden)
     JOIN productos p ON p.id=i.producto_id
     CROSS JOIN LATERAL calcular_precio_comun(
       i.producto_id, i.cantidad, $3::text, $4::text, $5::timestamptz
     ) pc
     ORDER BY i.orden`,
    [
      compactados.map((item) => item.producto_id),
      compactados.map((item) => item.cantidad),
      canal,
      segmento,
      fecha,
    ]
  );
  const filas = new Map(r.rows.map((row) => [Number(row.producto_id), row]));

  let subtotal = 0;
  let descuento = 0;
  let total = 0;
  const lineas = compactados.map((item) => {
    const productoId = Number(item.producto_id);
    const row = filas.get(productoId);
    if (!row || (bloqueados && !bloqueados.has(productoId))) {
      throw new ApiError(404, `Producto ${productoId} no existe.`);
    }
    if (!row.activo) throw new ApiError(409, `"${row.titulo}" está inactivo.`);
    if (canal === "WEB" && !row.publicado_web) {
      throw new ApiError(409, `"${row.titulo}" no está publicado para venta en línea.`);
    }

    const precioLista = Number(row.precio_lista);
    const descuentoUnitario = Number(row.descuento_unitario);
    const precioUnitario = Number(row.precio_unitario);
    const disponible = Number(row.stock_disponible);
    const importe = round2(precioUnitario * item.cantidad);
    const base = importe / (1 + Number(row.iva) / 100);
    subtotal += base;
    descuento += descuentoUnitario * item.cantidad;
    total += importe;

    return {
      producto_id: productoId,
      titulo: row.titulo,
      cantidad: item.cantidad,
      iva: Number(row.iva),
      precio_lista: precioLista,
      descuento_unitario: descuentoUnitario,
      precio_unitario: precioUnitario,
      regla_precio_id: row.regla_precio_id == null ? null : Number(row.regla_precio_id),
      disponible,
      disponible_suficiente: disponible >= item.cantidad,
      importe,
    };
  });

  subtotal = round2(subtotal);
  descuento = round2(descuento);
  total = round2(total);
  return {
    canal,
    segmento_cliente: segmento,
    lineas,
    subtotal,
    descuento,
    iva: round2(total - subtotal),
    total,
  };
}

module.exports = { compactarItems, cotizar };
