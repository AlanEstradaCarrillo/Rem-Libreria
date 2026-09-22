const { ApiError, round2 } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento } = require("./inventario.service");

const ESTADOS_ORDEN_COMPRA = new Set(["EMITIDA", "PARCIAL", "RECIBIDA", "CANCELADA"]);
const ESTADOS_RECEPCION = new Set(["EMITIDA", "PARCIAL"]);

function idCompraPositivo(value, field = "orden_compra_id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${field} inválido.`);
  }
  return id;
}

function normalizarItemsUnicos(items, idKey) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "Se requiere al menos una partida.");
  }
  const normalizados = items
    .map((item) => ({ ...item, [idKey]: idCompraPositivo(item[idKey], idKey) }))
    .sort((a, b) => a[idKey] - b[idKey]);
  for (let index = 1; index < normalizados.length; index += 1) {
    if (normalizados[index - 1][idKey] === normalizados[index][idKey]) {
      throw new ApiError(400, `La partida ${normalizados[index][idKey]} está repetida.`);
    }
  }
  return normalizados;
}

function importesCompra(costoUnitario, cantidad, ivaPorcentaje) {
  const subtotal = round2(Number(costoUnitario) * Number(cantidad));
  const iva = round2(subtotal * Number(ivaPorcentaje) / 100);
  return { subtotal, iva, total: round2(subtotal + iva) };
}

function sumarImportes(lineas) {
  const subtotal = round2(lineas.reduce((suma, linea) => suma + linea.subtotal, 0));
  const iva = round2(lineas.reduce((suma, linea) => suma + linea.iva, 0));
  const total = round2(subtotal + iva);
  if ([subtotal, iva, total].some((importe) => importe > 9999999999.99)) {
    throw new ApiError(400, "Los importes del documento exceden el máximo permitido.");
  }
  return { subtotal, iva, total };
}

function agruparPor(rows, key) {
  const grupos = new Map();
  for (const row of rows) {
    const id = Number(row[key]);
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push(row);
  }
  return grupos;
}

async function cargarRecepcionCompra(db, recepcionId) {
  const id = idCompraPositivo(recepcionId, "recepcion_compra_id");
  const cabecera = await db.query(
    `SELECT r.*, r.documento_proveedor AS referencia,
            u.nombre AS recibido_por
     FROM recepciones_compra r
     JOIN usuarios u ON u.id=r.recibido_por_usuario_id
     WHERE r.id=$1`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Recepción de compra no encontrada.");

  const detalle = await db.query(
    `SELECT dr.*, d.producto_sku, d.producto_titulo,
            COALESCE((
              SELECT SUM(dd.cantidad)::int
              FROM detalle_devoluciones_proveedor dd
              WHERE dd.detalle_recepcion_compra_id=dr.id
            ),0)::int AS cantidad_devuelta,
            (dr.cantidad - COALESCE((
              SELECT SUM(dd.cantidad)::int
              FROM detalle_devoluciones_proveedor dd
              WHERE dd.detalle_recepcion_compra_id=dr.id
            ),0))::int AS cantidad_disponible_devolver
     FROM detalle_recepciones_compra dr
     JOIN detalle_ordenes_compra d ON d.id=dr.detalle_orden_compra_id
     WHERE dr.recepcion_compra_id=$1
     ORDER BY dr.id`,
    [id]
  );
  return { ...cabecera.rows[0], detalle: detalle.rows };
}

async function cargarDevolucionProveedor(db, devolucionId) {
  const id = idCompraPositivo(devolucionId, "devolucion_proveedor_id");
  const cabecera = await db.query(
    `SELECT d.*, u.nombre AS creado_por
     FROM devoluciones_proveedor d
     JOIN usuarios u ON u.id=d.creado_por_usuario_id
     WHERE d.id=$1`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Devolución a proveedor no encontrada.");

  const detalle = await db.query(
    `SELECT dd.*, dor.producto_sku, dor.producto_titulo,
            dr.recepcion_compra_id, rc.folio AS recepcion_folio
     FROM detalle_devoluciones_proveedor dd
     JOIN detalle_recepciones_compra dr ON dr.id=dd.detalle_recepcion_compra_id
     JOIN recepciones_compra rc ON rc.id=dr.recepcion_compra_id
     JOIN detalle_ordenes_compra dor ON dor.id=dr.detalle_orden_compra_id
     WHERE dd.devolucion_proveedor_id=$1
     ORDER BY dd.id`,
    [id]
  );
  return { ...cabecera.rows[0], detalle: detalle.rows };
}

async function cargarOrdenCompra(db, ordenId) {
  const id = idCompraPositivo(ordenId);
  const cabecera = await db.query(
    `SELECT oc.*, p.razon_social AS proveedor_razon_social, p.rfc AS proveedor_rfc,
            p.activo AS proveedor_activo, u.nombre AS creado_por
     FROM ordenes_compra oc
     JOIN proveedores p ON p.id=oc.proveedor_id
     JOIN usuarios u ON u.id=oc.creado_por_usuario_id
     WHERE oc.id=$1`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Orden de compra no encontrada.");

  const detalle = await db.query(
    `SELECT d.*,
            COALESCE((
              SELECT SUM(r.cantidad)::int
              FROM detalle_recepciones_compra r
              WHERE r.detalle_orden_compra_id=d.id
            ),0)::int AS cantidad_recibida,
            COALESCE((
              SELECT SUM(dd.cantidad)::int
              FROM detalle_devoluciones_proveedor dd
              JOIN detalle_recepciones_compra r ON r.id=dd.detalle_recepcion_compra_id
              WHERE r.detalle_orden_compra_id=d.id
            ),0)::int AS cantidad_devuelta
     FROM detalle_ordenes_compra d
     WHERE d.orden_compra_id=$1
     ORDER BY d.id`,
    [id]
  );
  const lineas = detalle.rows.map((linea) => {
    const recibida = Number(linea.cantidad_recibida);
    const devuelta = Number(linea.cantidad_devuelta);
    const remanente = Math.max(0, Number(linea.cantidad) - recibida);
    return {
      ...linea,
      cantidad_pendiente: ESTADOS_RECEPCION.has(cabecera.rows[0].estado) ? remanente : 0,
      cantidad_cancelada: cabecera.rows[0].estado === "CANCELADA" ? remanente : 0,
      cantidad_neta: recibida - devuelta,
    };
  });

  const recepciones = await db.query(
    `SELECT r.*, r.documento_proveedor AS referencia, u.nombre AS recibido_por
     FROM recepciones_compra r
     JOIN usuarios u ON u.id=r.recibido_por_usuario_id
     WHERE r.orden_compra_id=$1
     ORDER BY r.id`,
    [id]
  );
  const detallesRecepcion = await db.query(
    `SELECT dr.*, d.producto_sku, d.producto_titulo,
            COALESCE((
              SELECT SUM(dd.cantidad)::int
              FROM detalle_devoluciones_proveedor dd
              WHERE dd.detalle_recepcion_compra_id=dr.id
            ),0)::int AS cantidad_devuelta,
            (dr.cantidad - COALESCE((
              SELECT SUM(dd.cantidad)::int
              FROM detalle_devoluciones_proveedor dd
              WHERE dd.detalle_recepcion_compra_id=dr.id
            ),0))::int AS cantidad_disponible_devolver
     FROM detalle_recepciones_compra dr
     JOIN detalle_ordenes_compra d ON d.id=dr.detalle_orden_compra_id
     WHERE dr.orden_compra_id=$1
     ORDER BY dr.id`,
    [id]
  );
  const detalleRecepcionPorCabecera = agruparPor(detallesRecepcion.rows, "recepcion_compra_id");

  const devoluciones = await db.query(
    `SELECT d.*, u.nombre AS creado_por
     FROM devoluciones_proveedor d
     JOIN usuarios u ON u.id=d.creado_por_usuario_id
     WHERE d.orden_compra_id=$1
     ORDER BY d.id`,
    [id]
  );
  const detallesDevolucion = await db.query(
    `SELECT dd.*, dor.producto_sku, dor.producto_titulo,
            dr.recepcion_compra_id, rc.folio AS recepcion_folio
     FROM detalle_devoluciones_proveedor dd
     JOIN detalle_recepciones_compra dr ON dr.id=dd.detalle_recepcion_compra_id
     JOIN recepciones_compra rc ON rc.id=dr.recepcion_compra_id
     JOIN detalle_ordenes_compra dor ON dor.id=dr.detalle_orden_compra_id
     WHERE dd.orden_compra_id=$1
     ORDER BY dd.id`,
    [id]
  );
  const detalleDevolucionPorCabecera = agruparPor(
    detallesDevolucion.rows,
    "devolucion_proveedor_id"
  );

  const transiciones = await db.query(
    `SELECT t.*, u.nombre AS usuario
     FROM orden_compra_transiciones t
     JOIN usuarios u ON u.id=t.usuario_id
     WHERE t.orden_compra_id=$1
     ORDER BY t.id`,
    [id]
  );

  return {
    ...cabecera.rows[0],
    detalle: lineas,
    recepciones: recepciones.rows.map((recepcion) => ({
      ...recepcion,
      detalle: detalleRecepcionPorCabecera.get(Number(recepcion.id)) || [],
    })),
    devoluciones: devoluciones.rows.map((devolucion) => ({
      ...devolucion,
      detalle: detalleDevolucionPorCabecera.get(Number(devolucion.id)) || [],
    })),
    transiciones: transiciones.rows,
  };
}

async function listarOrdenesCompra(db, {
  estado = null,
  proveedorId = null,
  q = "",
  page = 1,
  limit = 30,
} = {}) {
  if (estado != null && !ESTADOS_ORDEN_COMPRA.has(estado)) {
    throw new ApiError(400, "Estado de orden de compra inválido.");
  }
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT oc.id, oc.folio, oc.proveedor_id, oc.proveedor_nombre, oc.estado,
            oc.referencia, oc.subtotal, oc.iva, oc.total,
            oc.creado_por_usuario_id, u.nombre AS creado_por,
            oc.creado_en, oc.actualizado_en,
            COALESCE(o.lineas,0)::int AS lineas,
            COALESCE(o.unidades,0)::int AS unidades_ordenadas,
            COALESCE(r.unidades,0)::int AS unidades_recibidas,
            COALESCE(d.unidades,0)::int AS unidades_devueltas,
            CASE WHEN oc.estado IN ('EMITIDA','PARCIAL')
              THEN GREATEST(COALESCE(o.unidades,0) - COALESCE(r.unidades,0),0)
              ELSE 0 END::int AS unidades_pendientes
     FROM ordenes_compra oc
     JOIN usuarios u ON u.id=oc.creado_por_usuario_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS lineas, SUM(cantidad)::bigint AS unidades
       FROM detalle_ordenes_compra WHERE orden_compra_id=oc.id
     ) o ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(cantidad)::bigint AS unidades
       FROM detalle_recepciones_compra WHERE orden_compra_id=oc.id
     ) r ON TRUE
     LEFT JOIN LATERAL (
       SELECT SUM(cantidad)::bigint AS unidades
       FROM detalle_devoluciones_proveedor WHERE orden_compra_id=oc.id
     ) d ON TRUE
     WHERE ($1::text IS NULL OR oc.estado=$1)
       AND ($2::bigint IS NULL OR oc.proveedor_id=$2)
       AND (
         $3::text=''
         OR oc.folio ILIKE '%' || $3 || '%'
         OR oc.proveedor_nombre ILIKE '%' || $3 || '%'
         OR COALESCE(oc.referencia,'') ILIKE '%' || $3 || '%'
       )
     ORDER BY oc.id DESC
     LIMIT $4 OFFSET $5`,
    [estado, proveedorId, q, limit, offset]
  );
  return { page, limit, resultados: result.rows };
}

async function crearOrdenCompra(client, {
  proveedorId,
  referencia = null,
  notas = null,
  items,
  usuarioId,
}) {
  const proveedor = (await client.query(
    `SELECT * FROM proveedores WHERE id=$1 FOR UPDATE`,
    [idCompraPositivo(proveedorId, "proveedor_id")]
  )).rows[0];
  if (!proveedor) throw new ApiError(404, "Proveedor no encontrado.");
  if (!proveedor.activo) throw new ApiError(409, "El proveedor está inactivo.");

  const normalizados = normalizarItemsUnicos(items, "producto_id");
  const ids = normalizados.map((item) => item.producto_id);
  const productosResult = await client.query(
    `SELECT id, sku, titulo, iva, activo
     FROM productos
     WHERE id=ANY($1::int[])
     ORDER BY id
     FOR UPDATE`,
    [ids]
  );
  if (productosResult.rowCount !== ids.length) {
    const encontrados = new Set(productosResult.rows.map((row) => Number(row.id)));
    const faltante = ids.find((id) => !encontrados.has(id));
    throw new ApiError(404, `Producto ${faltante} no existe.`);
  }
  const productos = new Map(productosResult.rows.map((producto) => [Number(producto.id), producto]));
  const lineas = normalizados.map((item) => {
    const producto = productos.get(item.producto_id);
    if (!producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
    const ivaPorcentaje = item.iva_porcentaje == null
      ? Number(producto.iva)
      : Number(item.iva_porcentaje);
    return {
      ...item,
      producto,
      costo_unitario: round2(item.costo_unitario),
      iva_porcentaje: round2(ivaPorcentaje),
      ...importesCompra(item.costo_unitario, item.cantidad, ivaPorcentaje),
    };
  });
  const totales = sumarImportes(lineas);
  const ordenResult = await client.query(
    `INSERT INTO ordenes_compra
       (proveedor_id, proveedor_nombre, estado, referencia, notas,
        subtotal, iva, total, creado_por_usuario_id)
     VALUES ($1,$2,'EMITIDA',$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      proveedor.id, proveedor.nombre, referencia, notas,
      totales.subtotal, totales.iva, totales.total, usuarioId,
    ]
  );
  const orden = ordenResult.rows[0];
  for (const linea of lineas) {
    await client.query(
      `INSERT INTO detalle_ordenes_compra
         (orden_compra_id, producto_id, producto_sku, producto_titulo,
          cantidad, costo_unitario, iva_porcentaje, subtotal, iva, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        orden.id, linea.producto.id, linea.producto.sku, linea.producto.titulo,
        linea.cantidad, linea.costo_unitario, linea.iva_porcentaje,
        linea.subtotal, linea.iva, linea.total,
      ]
    );
  }
  return cargarOrdenCompra(client, orden.id);
}

async function bloquearOrdenCompra(client, ordenId) {
  const id = idCompraPositivo(ordenId);
  const result = await client.query(`SELECT * FROM ordenes_compra WHERE id=$1 FOR UPDATE`, [id]);
  if (!result.rows[0]) throw new ApiError(404, "Orden de compra no encontrada.");
  return result.rows[0];
}

async function cancelarOrdenCompra(client, { ordenId, usuarioId, motivo, origenClave }) {
  const orden = await bloquearOrdenCompra(client, ordenId);
  if (!ESTADOS_RECEPCION.has(orden.estado)) {
    throw new ApiError(409, `La orden en estado ${orden.estado} no puede cancelarse.`);
  }
  await client.query(
    `INSERT INTO orden_compra_transiciones
       (orden_compra_id, estado_anterior, estado_nuevo, usuario_id, motivo, origen_clave)
     VALUES ($1,$2,'CANCELADA',$3,$4,$5)`,
    [orden.id, orden.estado, usuarioId, motivo, origenClave]
  );
  return cargarOrdenCompra(client, orden.id);
}

async function recibirOrdenCompra(client, {
  ordenId,
  usuarioId,
  referencia = null,
  notas = null,
  items,
}) {
  const orden = await bloquearOrdenCompra(client, ordenId);
  if (!ESTADOS_RECEPCION.has(orden.estado)) {
    throw new ApiError(409, `La orden en estado ${orden.estado} no admite recepciones.`);
  }
  const normalizados = normalizarItemsUnicos(items, "detalle_orden_compra_id");
  const detallesResult = await client.query(
    `SELECT * FROM detalle_ordenes_compra
     WHERE orden_compra_id=$1
     ORDER BY id
     FOR UPDATE`,
    [orden.id]
  );
  const detallePorId = new Map(detallesResult.rows.map((detalle) => [Number(detalle.id), detalle]));
  const recibidasResult = await client.query(
    `SELECT detalle_orden_compra_id, SUM(cantidad)::int AS cantidad
     FROM detalle_recepciones_compra
     WHERE orden_compra_id=$1
     GROUP BY detalle_orden_compra_id`,
    [orden.id]
  );
  const recibidas = new Map(
    recibidasResult.rows.map((row) => [Number(row.detalle_orden_compra_id), Number(row.cantidad)])
  );

  const lineas = normalizados.map((item) => {
    const detalle = detallePorId.get(item.detalle_orden_compra_id);
    if (!detalle) {
      throw new ApiError(400, `La partida ${item.detalle_orden_compra_id} no pertenece a la orden.`);
    }
    const pendiente = Number(detalle.cantidad) - (recibidas.get(Number(detalle.id)) || 0);
    if (item.cantidad > pendiente) {
      throw new ApiError(409, `La recepción excede el pendiente de "${detalle.producto_titulo}" (${pendiente}).`);
    }
    const costoUnitario = round2(item.costo_unitario == null
      ? Number(detalle.costo_unitario)
      : item.costo_unitario);
    return {
      ...item,
      detalle,
      costo_unitario: costoUnitario,
      iva_porcentaje: Number(detalle.iva_porcentaje),
      ...importesCompra(costoUnitario, item.cantidad, detalle.iva_porcentaje),
    };
  });
  const productos = await bloquearProductos(
    client,
    lineas.map((linea) => linea.detalle.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const totales = sumarImportes(lineas);
  const recepcionResult = await client.query(
    `INSERT INTO recepciones_compra
       (orden_compra_id, proveedor_id, documento_proveedor, notas,
        subtotal, iva, total, recibido_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      orden.id, orden.proveedor_id, referencia, notas,
      totales.subtotal, totales.iva, totales.total, usuarioId,
    ]
  );
  const recepcion = recepcionResult.rows[0];
  const recibidasAhora = new Map();
  for (const linea of lineas) {
    const producto = productoPorId.get(Number(linea.detalle.producto_id));
    const costoAnterior = Number(producto.costo);
    const detalleResult = await client.query(
      `INSERT INTO detalle_recepciones_compra
         (recepcion_compra_id, orden_compra_id, proveedor_id,
          detalle_orden_compra_id, producto_id, cantidad,
          costo_unitario, costo_anterior, costo_nuevo, iva_porcentaje,
          subtotal, iva, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        recepcion.id, orden.id, orden.proveedor_id,
        linea.detalle.id, linea.detalle.producto_id, linea.cantidad,
        linea.costo_unitario, costoAnterior, linea.costo_unitario, linea.iva_porcentaje,
        linea.subtotal, linea.iva, linea.total,
      ]
    );
    const detalleRecepcion = detalleResult.rows[0];
    producto.costo = linea.costo_unitario;
    await aplicarMovimiento(client, {
      producto,
      deltaFisico: linea.cantidad,
      tipo: "RECEPCION_COMPRA",
      usuarioId,
      motivo: `Recepción ${recepcion.folio} de la orden ${orden.folio}.`,
      recepcionCompraId: recepcion.id,
      detalleRecepcionCompraId: detalleRecepcion.id,
      origenClave: `RECEPCION_COMPRA:${recepcion.id}:DETALLE:${detalleRecepcion.id}`,
    });
    recibidasAhora.set(
      Number(linea.detalle.id),
      (recibidasAhora.get(Number(linea.detalle.id)) || 0) + linea.cantidad
    );
  }

  const completa = detallesResult.rows.every((detalle) => (
    (recibidas.get(Number(detalle.id)) || 0)
      + (recibidasAhora.get(Number(detalle.id)) || 0)
  ) === Number(detalle.cantidad));
  const nuevoEstado = completa ? "RECIBIDA" : "PARCIAL";
  if (nuevoEstado !== orden.estado) {
    await client.query(
      `INSERT INTO orden_compra_transiciones
         (orden_compra_id, estado_anterior, estado_nuevo, usuario_id, motivo, origen_clave)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        orden.id, orden.estado, nuevoEstado, usuarioId,
        `Recepción ${recepcion.folio} registrada.`,
        `RECEPCION_COMPRA:${recepcion.id}:ESTADO:${nuevoEstado}`,
      ]
    );
  }
  return {
    orden: await cargarOrdenCompra(client, orden.id),
    recepcion: await cargarRecepcionCompra(client, recepcion.id),
  };
}

async function devolverAProveedor(client, {
  ordenId,
  usuarioId,
  motivo,
  referencia = null,
  notas = null,
  items,
}) {
  const orden = await bloquearOrdenCompra(client, ordenId);
  const normalizados = normalizarItemsUnicos(items, "detalle_recepcion_compra_id");
  const ids = normalizados.map((item) => item.detalle_recepcion_compra_id);
  const fuentesResult = await client.query(
    `SELECT dr.*, dor.producto_sku, dor.producto_titulo
     FROM detalle_recepciones_compra dr
     JOIN detalle_ordenes_compra dor ON dor.id=dr.detalle_orden_compra_id
     WHERE dr.orden_compra_id=$1 AND dr.id=ANY($2::bigint[])
     ORDER BY dr.id
     FOR UPDATE OF dr`,
    [orden.id, ids]
  );
  if (fuentesResult.rowCount !== ids.length) {
    const encontradas = new Set(fuentesResult.rows.map((row) => Number(row.id)));
    const faltante = ids.find((id) => !encontradas.has(id));
    throw new ApiError(400, `La línea de recepción ${faltante} no pertenece a la orden.`);
  }
  const fuentePorId = new Map(fuentesResult.rows.map((row) => [Number(row.id), row]));
  const devueltasResult = await client.query(
    `SELECT detalle_recepcion_compra_id, SUM(cantidad)::int AS cantidad
     FROM detalle_devoluciones_proveedor
     WHERE detalle_recepcion_compra_id=ANY($1::bigint[])
     GROUP BY detalle_recepcion_compra_id`,
    [ids]
  );
  const devueltas = new Map(
    devueltasResult.rows.map((row) => [Number(row.detalle_recepcion_compra_id), Number(row.cantidad)])
  );
  const lineas = normalizados.map((item) => {
    const fuente = fuentePorId.get(item.detalle_recepcion_compra_id);
    const disponible = Number(fuente.cantidad) - (devueltas.get(Number(fuente.id)) || 0);
    if (item.cantidad > disponible) {
      throw new ApiError(
        409,
        `La devolución excede lo disponible de "${fuente.producto_titulo}" (${disponible}).`
      );
    }
    return {
      ...item,
      fuente,
      costo_unitario: Number(fuente.costo_unitario),
      iva_porcentaje: Number(fuente.iva_porcentaje),
      ...importesCompra(fuente.costo_unitario, item.cantidad, fuente.iva_porcentaje),
    };
  });
  const productos = await bloquearProductos(
    client,
    lineas.map((linea) => linea.fuente.producto_id)
  );
  const productoPorId = new Map(productos.map((producto) => [Number(producto.id), producto]));
  const requeridasPorProducto = new Map();
  for (const linea of lineas) {
    const productoId = Number(linea.fuente.producto_id);
    requeridasPorProducto.set(
      productoId,
      (requeridasPorProducto.get(productoId) || 0) + linea.cantidad
    );
  }
  for (const [productoId, cantidad] of requeridasPorProducto) {
    const producto = productoPorId.get(productoId);
    if (Number(producto.stock_disponible) < cantidad) {
      throw new ApiError(
        409,
        `La devolución afectaría unidades reservadas de "${producto.titulo}".`
      );
    }
  }

  const totales = sumarImportes(lineas);
  const devolucionResult = await client.query(
    `INSERT INTO devoluciones_proveedor
       (orden_compra_id, proveedor_id, referencia, motivo, notas,
        subtotal, iva, total, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      orden.id, orden.proveedor_id, referencia, motivo, notas,
      totales.subtotal, totales.iva, totales.total, usuarioId,
    ]
  );
  const devolucion = devolucionResult.rows[0];
  for (const linea of lineas) {
    const detalleResult = await client.query(
      `INSERT INTO detalle_devoluciones_proveedor
         (devolucion_proveedor_id, orden_compra_id, proveedor_id,
          detalle_recepcion_compra_id, producto_id, cantidad,
          costo_unitario, iva_porcentaje, subtotal, iva, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        devolucion.id, orden.id, orden.proveedor_id,
        linea.fuente.id, linea.fuente.producto_id, linea.cantidad,
        linea.costo_unitario, linea.iva_porcentaje,
        linea.subtotal, linea.iva, linea.total,
      ]
    );
    const detalleDevolucion = detalleResult.rows[0];
    await aplicarMovimiento(client, {
      producto: productoPorId.get(Number(linea.fuente.producto_id)),
      deltaFisico: -linea.cantidad,
      tipo: "DEVOLUCION_PROVEEDOR",
      usuarioId,
      motivo: `Devolución ${devolucion.folio} a proveedor: ${motivo}`,
      devolucionProveedorId: devolucion.id,
      detalleDevolucionProveedorId: detalleDevolucion.id,
      origenClave: `DEVOLUCION_PROVEEDOR:${devolucion.id}:DETALLE:${detalleDevolucion.id}`,
    });
  }
  return {
    orden: await cargarOrdenCompra(client, orden.id),
    devolucion: await cargarDevolucionProveedor(client, devolucion.id),
  };
}

module.exports = {
  ESTADOS_ORDEN_COMPRA,
  idCompraPositivo,
  normalizarItemsUnicos,
  cargarOrdenCompra,
  cargarRecepcionCompra,
  cargarDevolucionProveedor,
  listarOrdenesCompra,
  crearOrdenCompra,
  cancelarOrdenCompra,
  recibirOrdenCompra,
  devolverAProveedor,
};
