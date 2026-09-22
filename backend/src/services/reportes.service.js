const { ApiError } = require("../utils/errors");
const { crearCsv } = require("../utils/csv");
const { CTE_MERCANCIA_EN_TRANSITO } = require("./reposicion-conteos.service");

const LIMITE_EXPORTACION = 20000;

const EVENTOS_VENTA_CTE = `eventos_venta AS (
  SELECT evento_clave, fecha_evento AS creado_en,
         tipo_evento AS tipo, fuente, movimiento_id, sesion_id, caja_id,
         usuario_id, metodo_pago, importe, importe_neto,
         venta_id, consignacion_editorial_id, consignacion_operacion_id,
         folio, cliente_nombre AS cliente, cliente_id, canal, origen,
         caja_nombre, usuario, referencia, concepto
  FROM eventos_comerciales
)`;

const LINEAS_VENTA_CTE = `lineas_venta AS (
  SELECT l.evento_clave, l.fecha_evento AS creado_en,
         l.caja_id, l.usuario_id, l.metodo_pago, l.cliente_id,
         l.cliente_nombre, l.canal, l.tipo_evento AS tipo, l.signo,
         l.producto_id, l.cantidad, l.importe, l.descuento,
         l.precio_lista, l.descuento_unitario, l.precio_unitario,
         l.iva_porcentaje, l.fuente, l.movimiento_id, l.venta_id,
         l.consignacion_editorial_id, l.consignacion_operacion_id,
         p.sku, p.isbn, p.titulo, p.autor, p.editorial,
         p.categoria_id, cat.nombre AS categoria
  FROM lineas_comerciales l
  JOIN productos p ON p.id=l.producto_id
  LEFT JOIN categorias cat ON cat.id=p.categoria_id
)`;

const FILTRO_EVENTOS_VENTA = `e.creado_en >= $1::timestamptz
  AND e.creado_en < $2::timestamptz
  AND ($3::int IS NULL OR e.caja_id=$3)
  AND ($4::int IS NULL OR e.usuario_id=$4)
  AND ($5::text IS NULL OR e.metodo_pago=$5)
  AND ($6::text IS NULL OR e.canal=$6)`;

const FILTRO_LINEAS_VENTA = `l.creado_en >= $1::timestamptz
  AND l.creado_en < $2::timestamptz
  AND ($3::int IS NULL OR l.caja_id=$3)
  AND ($4::int IS NULL OR l.usuario_id=$4)
  AND ($5::text IS NULL OR l.metodo_pago=$5)
  AND ($6::text IS NULL OR l.canal=$6)`;

async function iniciarLecturaConsistente(client) {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
}

async function resolverPeriodo(db, { desde, hasta, zonaHoraria }) {
  const zona = await db.query(
    `SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)::boolean AS valida`,
    [zonaHoraria]
  );
  if (!zona.rows[0].valida) throw new ApiError(400, "Zona horaria inválida.");
  return {
    desde,
    hasta,
    zona_horaria: zonaHoraria,
  };
}

function parametrosVentas(periodo, filtros) {
  return [
    periodo.desde,
    periodo.hasta,
    filtros.cajaId || null,
    filtros.usuarioId || null,
    filtros.metodoPago || null,
    filtros.canal || null,
  ];
}

function paginacion(page, limit, total, resultados) {
  return {
    page,
    limit,
    total: Number(total || 0),
    resultados,
  };
}

async function obtenerFiltrosReportes(db) {
  const [cajas, usuarios, categorias, proveedores] = await Promise.all([
    db.query(`SELECT id, nombre, activo FROM caja ORDER BY nombre, id`),
    db.query(
      `SELECT u.id, u.nombre, u.activo, r.nombre AS rol
       FROM usuarios u JOIN roles r ON r.id=u.rol_id
       ORDER BY u.nombre, u.id`
    ),
    db.query(`SELECT id, nombre, activo FROM categorias ORDER BY orden, nombre, id`),
    db.query(`SELECT id, nombre, activo FROM proveedores ORDER BY nombre, id`),
  ]);
  return {
    cajas: cajas.rows,
    usuarios: usuarios.rows,
    categorias: categorias.rows,
    proveedores: proveedores.rows,
  };
}

async function rankingsVentas(db, params) {
  const configuraciones = {
    productos: {
      clave: "l.producto_id::text",
      etiqueta: "MAX(l.titulo)",
      extra: "MAX(l.sku) AS sku, MAX(l.isbn) AS isbn",
      grupo: "l.producto_id",
    },
    categorias: {
      clave: "COALESCE(l.categoria_id::text, 'SIN_CATEGORIA')",
      etiqueta: "COALESCE(l.categoria, 'Sin categoría')",
      extra: "NULL::text AS sku, NULL::text AS isbn",
      grupo: "COALESCE(l.categoria_id::text, 'SIN_CATEGORIA'), COALESCE(l.categoria, 'Sin categoría')",
    },
    editoriales: {
      clave: "COALESCE(NULLIF(btrim(l.editorial),''), 'SIN_EDITORIAL')",
      etiqueta: "COALESCE(NULLIF(btrim(l.editorial),''), 'Sin editorial')",
      extra: "NULL::text AS sku, NULL::text AS isbn",
      grupo: "COALESCE(NULLIF(btrim(l.editorial),''), 'SIN_EDITORIAL'), COALESCE(NULLIF(btrim(l.editorial),''), 'Sin editorial')",
    },
    autores: {
      clave: "COALESCE(NULLIF(btrim(l.autor),''), 'SIN_AUTOR')",
      etiqueta: "COALESCE(NULLIF(btrim(l.autor),''), 'Sin autor')",
      extra: "NULL::text AS sku, NULL::text AS isbn",
      grupo: "COALESCE(NULLIF(btrim(l.autor),''), 'SIN_AUTOR'), COALESCE(NULLIF(btrim(l.autor),''), 'Sin autor')",
    },
  };
  const bloques = Object.entries(configuraciones).map(([tipo, config]) => `ranking_${tipo} AS (
    SELECT '${tipo}'::text AS tipo_ranking,
           ${config.clave} AS clave, ${config.etiqueta} AS etiqueta, ${config.extra},
           COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='VENTA'),0)::int AS unidades_brutas,
           COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='CANCELACION'),0)::int AS unidades_canceladas,
           COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='DEVOLUCION'),0)::int AS unidades_devueltas,
           COALESCE(SUM(l.signo*l.cantidad),0)::int AS unidades_netas,
           COALESCE(SUM(l.importe) FILTER (WHERE l.tipo='VENTA'),0) AS importe_bruto,
           COALESCE(SUM(l.importe) FILTER (WHERE l.tipo='CANCELACION'),0) AS importe_cancelado,
           COALESCE(SUM(l.importe) FILTER (WHERE l.tipo='DEVOLUCION'),0) AS importe_devuelto,
           COALESCE(SUM(l.signo*l.importe),0) AS importe_neto
    FROM lineas_filtradas l
    GROUP BY ${config.grupo}
    ORDER BY importe_neto DESC, unidades_netas DESC, etiqueta
    LIMIT 20
  )`);
  const uniones = Object.keys(configuraciones)
    .map((tipo) => `SELECT * FROM ranking_${tipo}`)
    .join(" UNION ALL ");
  const result = await db.query(
    `WITH ${LINEAS_VENTA_CTE},
     lineas_filtradas AS MATERIALIZED (
       SELECT * FROM lineas_venta l WHERE ${FILTRO_LINEAS_VENTA}
     ), ${bloques.join(", ")}
     ${uniones}
     ORDER BY tipo_ranking, importe_neto DESC, unidades_netas DESC, etiqueta`,
    params
  );
  const rankings = { productos: [], categorias: [], editoriales: [], autores: [] };
  for (const row of result.rows) {
    const { tipo_ranking: tipo, ...item } = row;
    rankings[tipo].push(item);
  }
  return rankings;
}

async function reporteVentas(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = parametrosVentas(periodo, filtros);
  const offset = (filtros.page - 1) * filtros.limit;
  const [resumenDinero, resumenLineas, porDia, porMetodo, porCanal,
    rankings, movimientos] = await Promise.all([
    db.query(
      `WITH ${EVENTOS_VENTA_CTE}
       SELECT COUNT(*) FILTER (WHERE e.tipo='VENTA')::int AS ventas,
              COUNT(*) FILTER (WHERE e.tipo='CANCELACION')::int AS cancelaciones,
              COUNT(*) FILTER (WHERE e.tipo='DEVOLUCION')::int AS devoluciones,
              COUNT(*)::int AS movimientos,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='VENTA'),0) AS venta_bruta,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='CANCELACION'),0) AS importe_cancelado,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='DEVOLUCION'),0) AS importe_devuelto,
              COALESCE(SUM(CASE WHEN e.tipo='VENTA' THEN e.importe ELSE -e.importe END),0) AS venta_neta,
              COALESCE(AVG(e.importe) FILTER (WHERE e.tipo='VENTA'),0) AS ticket_promedio
       FROM eventos_venta e WHERE ${FILTRO_EVENTOS_VENTA}`,
      params
    ),
    db.query(
      `WITH ${LINEAS_VENTA_CTE}
       SELECT COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='VENTA'),0)::int AS unidades_brutas,
              COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo<>'VENTA'),0)::int AS unidades_revertidas,
              COALESCE(SUM(l.signo*l.cantidad),0)::int AS unidades_netas,
              COALESCE(SUM(l.descuento) FILTER (WHERE l.tipo='VENTA'),0) AS descuentos_brutos,
              COALESCE(SUM(l.descuento) FILTER (WHERE l.tipo<>'VENTA'),0) AS descuentos_revertidos,
              COALESCE(SUM(l.signo*l.descuento),0) AS descuentos_netos
       FROM lineas_venta l WHERE ${FILTRO_LINEAS_VENTA}`,
      params
    ),
    db.query(
      `WITH ${EVENTOS_VENTA_CTE}
       SELECT (e.creado_en AT TIME ZONE $7)::date::text AS fecha,
              COUNT(*) FILTER (WHERE e.tipo='VENTA')::int AS ventas,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='VENTA'),0) AS venta_bruta,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='CANCELACION'),0) AS cancelaciones,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='DEVOLUCION'),0) AS devoluciones,
              COALESCE(SUM(CASE WHEN e.tipo='VENTA' THEN e.importe ELSE -e.importe END),0) AS venta_neta
       FROM eventos_venta e WHERE ${FILTRO_EVENTOS_VENTA}
       GROUP BY (e.creado_en AT TIME ZONE $7)::date
       ORDER BY (e.creado_en AT TIME ZONE $7)::date`,
      [...params, periodo.zona_horaria]
    ),
    db.query(
      `WITH ${EVENTOS_VENTA_CTE}
       SELECT COALESCE(e.metodo_pago,'SIN_CAJA') AS metodo_pago,
              COUNT(*) FILTER (WHERE e.tipo='VENTA')::int AS ventas,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='VENTA'),0) AS venta_bruta,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo<>'VENTA'),0) AS reversos,
              COALESCE(SUM(CASE WHEN e.tipo='VENTA' THEN e.importe ELSE -e.importe END),0) AS venta_neta
       FROM eventos_venta e WHERE ${FILTRO_EVENTOS_VENTA}
       GROUP BY COALESCE(e.metodo_pago,'SIN_CAJA')
       ORDER BY COALESCE(e.metodo_pago,'SIN_CAJA')`,
      params
    ),
    db.query(
      `WITH ${EVENTOS_VENTA_CTE}
       SELECT e.canal,
              COUNT(*) FILTER (WHERE e.tipo='VENTA')::int AS ventas,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo='VENTA'),0) AS venta_bruta,
              COALESCE(SUM(e.importe) FILTER (WHERE e.tipo<>'VENTA'),0) AS reversos,
              COALESCE(SUM(CASE WHEN e.tipo='VENTA' THEN e.importe ELSE -e.importe END),0) AS venta_neta
       FROM eventos_venta e WHERE ${FILTRO_EVENTOS_VENTA}
       GROUP BY e.canal ORDER BY e.canal`,
      params
    ),
    rankingsVentas(db, params),
    db.query(
      `WITH ${EVENTOS_VENTA_CTE}
       SELECT e.* FROM eventos_venta e
       WHERE ${FILTRO_EVENTOS_VENTA}
       ORDER BY e.creado_en DESC, e.evento_clave DESC
       LIMIT $7 OFFSET $8`,
      [...params, filtros.limit, offset]
    ),
  ]);
  const resumen = { ...resumenDinero.rows[0], ...resumenLineas.rows[0] };
  return {
    generado_en: new Date().toISOString(),
    periodo,
    resumen,
    por_dia: porDia.rows,
    por_metodo: porMetodo.rows,
    por_canal: porCanal.rows,
    rankings,
    movimientos: paginacion(
      filtros.page,
      filtros.limit,
      resumen.movimientos,
      movimientos.rows
    ),
  };
}

const INVENTARIO_BASE_CTE = `
  ${CTE_MERCANCIA_EN_TRANSITO},
  inventario_base AS (
    SELECT p.id AS producto_id, p.sku, p.codigo_barras, p.isbn, p.titulo,
           p.autor, p.editorial, p.categoria_id, cat.nombre AS categoria,
           p.costo, p.precio, p.iva, p.activo, p.publicado_web,
           p.stock::int AS fisico,
           p.stock_reservado::int AS reservado,
           p.stock_consignado::int AS consignado,
           (p.stock+p.stock_consignado)::int AS propiedad_total,
           p.stock_disponible::int AS disponible,
           pr.stock_minimo::int, pr.stock_objetivo::int,
           pr.proveedor_preferido_id, prov.nombre AS proveedor_preferido,
           COALESCE(et.cantidad,0)::int AS en_transito,
           (p.stock_disponible + COALESCE(et.cantidad,0))::int AS disponible_proyectado,
           CASE
             WHEN p.activo AND pr.stock_objetivo > 0
                  AND p.stock_disponible + COALESCE(et.cantidad,0) <= pr.stock_minimo
                  AND pr.stock_objetivo > p.stock_disponible + COALESCE(et.cantidad,0)
             THEN pr.stock_objetivo - (p.stock_disponible + COALESCE(et.cantidad,0))
             ELSE 0
           END::int AS cantidad_sugerida,
           ROUND(p.stock * p.costo,2) AS valor_costo_fisico,
           ROUND(p.stock_consignado * p.costo,2) AS valor_costo_consignado,
           ROUND((p.stock+p.stock_consignado) * p.costo,2) AS valor_costo_total,
           ROUND(p.stock_disponible * p.precio,2) AS valor_venta_disponible
    FROM productos p
    LEFT JOIN categorias cat ON cat.id=p.categoria_id
    LEFT JOIN politicas_reposicion pr ON pr.producto_id=p.id
    LEFT JOIN proveedores prov ON prov.id=pr.proveedor_preferido_id
    LEFT JOIN en_transito et ON et.producto_id=p.id
  ), inventario_filtrado AS (
    SELECT * FROM inventario_base i
    WHERE ($1::text='' OR i.sku ILIKE '%'||$1||'%'
           OR COALESCE(i.isbn,'') ILIKE '%'||$1||'%'
           OR i.titulo ILIKE '%'||$1||'%'
           OR COALESCE(i.autor,'') ILIKE '%'||$1||'%'
           OR COALESCE(i.editorial,'') ILIKE '%'||$1||'%')
      AND ($2::int IS NULL OR i.categoria_id=$2)
      AND ($3::text IS NULL OR
        ($3='BAJO_MINIMO' AND i.cantidad_sugerida>0)
        OR ($3='SIN_EXISTENCIA' AND i.fisico=0)
        OR ($3='CON_RESERVA' AND i.reservado>0)
        OR ($3='CON_CONSIGNACION' AND i.consignado>0)
        OR ($3='SIN_POLITICA' AND i.stock_minimo IS NULL))
      AND ($4::boolean IS NULL OR i.publicado_web=$4)
      AND ($5::boolean IS NULL OR i.activo=$5)
      AND ($6::bigint IS NULL OR i.proveedor_preferido_id=$6)
  )`;

function parametrosInventario(filtros) {
  return [
    filtros.q || "",
    filtros.categoriaId || null,
    filtros.estado || null,
    filtros.publicadoWeb == null ? null : filtros.publicadoWeb,
    filtros.activo == null ? null : filtros.activo,
    filtros.proveedorId || null,
  ];
}

async function reporteInventario(db, filtros) {
  const params = parametrosInventario(filtros);
  const offset = (filtros.page - 1) * filtros.limit;
  const [resumen, filas] = await Promise.all([
    db.query(
      `WITH ${INVENTARIO_BASE_CTE}
       SELECT COUNT(*)::int AS productos,
              COALESCE(SUM(fisico),0)::int AS unidades_fisicas,
              COALESCE(SUM(reservado),0)::int AS unidades_reservadas,
              COALESCE(SUM(consignado),0)::int AS unidades_consignadas,
              COALESCE(SUM(propiedad_total),0)::int AS unidades_propiedad_total,
              COALESCE(SUM(disponible),0)::int AS unidades_disponibles,
              COALESCE(SUM(en_transito),0)::int AS unidades_en_transito,
              COUNT(*) FILTER (WHERE cantidad_sugerida>0)::int AS bajo_minimo,
              COUNT(*) FILTER (WHERE fisico=0)::int AS sin_existencia,
              COALESCE(SUM(valor_costo_fisico),0) AS valor_costo_fisico,
              COALESCE(SUM(valor_costo_consignado),0) AS valor_costo_consignado,
              COALESCE(SUM(valor_costo_total),0) AS valor_costo_total,
              COALESCE(SUM(valor_venta_disponible),0) AS valor_venta_disponible
       FROM inventario_filtrado`,
      params
    ),
    db.query(
      `WITH ${INVENTARIO_BASE_CTE}
       SELECT * FROM inventario_filtrado
       ORDER BY
         CASE WHEN stock_minimo IS NOT NULL AND disponible_proyectado <= stock_minimo THEN 0 ELSE 1 END,
         cantidad_sugerida DESC, titulo, producto_id
       LIMIT $7 OFFSET $8`,
      [...params, filtros.limit, offset]
    ),
  ]);
  return {
    generado_en: new Date().toISOString(),
    resumen: resumen.rows[0],
    productos: paginacion(
      filtros.page,
      filtros.limit,
      resumen.rows[0].productos,
      filas.rows
    ),
  };
}

const EVENTOS_COMPRA_CTE = `eventos_compra AS (
  SELECT rc.id AS documento_id, rc.creado_en, 'RECEPCION'::text AS tipo,
         1::int AS signo, rc.folio, oc.folio AS orden_folio,
         rc.orden_compra_id, rc.proveedor_id, oc.proveedor_nombre,
         rc.recibido_por_usuario_id AS usuario_id, u.nombre AS usuario,
         rc.documento_proveedor AS referencia, rc.subtotal, rc.iva, rc.total
  FROM recepciones_compra rc
  JOIN ordenes_compra oc ON oc.id=rc.orden_compra_id
  JOIN usuarios u ON u.id=rc.recibido_por_usuario_id

  UNION ALL

  SELECT dp.id AS documento_id, dp.creado_en, 'DEVOLUCION_PROVEEDOR'::text AS tipo,
         -1::int AS signo, dp.folio, oc.folio AS orden_folio,
         dp.orden_compra_id, dp.proveedor_id, oc.proveedor_nombre,
         dp.creado_por_usuario_id AS usuario_id, u.nombre AS usuario,
         dp.referencia, dp.subtotal, dp.iva, dp.total
  FROM devoluciones_proveedor dp
  JOIN ordenes_compra oc ON oc.id=dp.orden_compra_id
  JOIN usuarios u ON u.id=dp.creado_por_usuario_id
)`;

const LINEAS_COMPRA_CTE = `lineas_compra AS (
  SELECT rc.creado_en, 'RECEPCION'::text AS tipo, 1::int AS signo,
         rc.proveedor_id, oc.proveedor_nombre, dr.producto_id,
         doc.producto_sku AS sku, doc.producto_titulo AS titulo,
         p.editorial, p.categoria_id, cat.nombre AS categoria,
         dr.cantidad::int AS cantidad, dr.subtotal, dr.iva, dr.total
  FROM detalle_recepciones_compra dr
  JOIN recepciones_compra rc ON rc.id=dr.recepcion_compra_id
  JOIN ordenes_compra oc ON oc.id=rc.orden_compra_id
  JOIN detalle_ordenes_compra doc ON doc.id=dr.detalle_orden_compra_id
  JOIN productos p ON p.id=dr.producto_id
  LEFT JOIN categorias cat ON cat.id=p.categoria_id

  UNION ALL

  SELECT dp.creado_en, 'DEVOLUCION_PROVEEDOR'::text AS tipo, -1::int AS signo,
         dp.proveedor_id, oc.proveedor_nombre, dd.producto_id,
         doc.producto_sku AS sku, doc.producto_titulo AS titulo,
         p.editorial, p.categoria_id, cat.nombre AS categoria,
         dd.cantidad::int AS cantidad, dd.subtotal, dd.iva, dd.total
  FROM detalle_devoluciones_proveedor dd
  JOIN devoluciones_proveedor dp ON dp.id=dd.devolucion_proveedor_id
  JOIN ordenes_compra oc ON oc.id=dp.orden_compra_id
  JOIN detalle_recepciones_compra dr ON dr.id=dd.detalle_recepcion_compra_id
  JOIN detalle_ordenes_compra doc ON doc.id=dr.detalle_orden_compra_id
  JOIN productos p ON p.id=dd.producto_id
  LEFT JOIN categorias cat ON cat.id=p.categoria_id
)`;

const FILTRO_COMPRA_EVENTO = `e.creado_en >= $1::timestamptz
  AND e.creado_en < $2::timestamptz
  AND ($3::bigint IS NULL OR e.proveedor_id=$3)`;
const FILTRO_COMPRA_LINEA = `l.creado_en >= $1::timestamptz
  AND l.creado_en < $2::timestamptz
  AND ($3::bigint IS NULL OR l.proveedor_id=$3)`;

async function reporteCompras(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [periodo.desde, periodo.hasta, filtros.proveedorId || null];
  const offset = (filtros.page - 1) * filtros.limit;
  const [resumenDocumentos, resumenLineas, proveedores, productos, movimientos, compromisos] = await Promise.all([
    db.query(
      `WITH ${EVENTOS_COMPRA_CTE}
       SELECT COUNT(*) FILTER (WHERE e.tipo='RECEPCION')::int AS recepciones,
              COUNT(*) FILTER (WHERE e.tipo='DEVOLUCION_PROVEEDOR')::int AS devoluciones,
              COUNT(*)::int AS movimientos,
              COALESCE(SUM(e.subtotal) FILTER (WHERE e.tipo='RECEPCION'),0) AS subtotal_recibido,
              COALESCE(SUM(e.iva) FILTER (WHERE e.tipo='RECEPCION'),0) AS iva_recibido,
              COALESCE(SUM(e.total) FILTER (WHERE e.tipo='RECEPCION'),0) AS total_recibido,
              COALESCE(SUM(e.total) FILTER (WHERE e.tipo='DEVOLUCION_PROVEEDOR'),0) AS total_devuelto,
              COALESCE(SUM(e.signo*e.total),0) AS compra_neta
       FROM eventos_compra e WHERE ${FILTRO_COMPRA_EVENTO}`,
      params
    ),
    db.query(
      `WITH ${LINEAS_COMPRA_CTE}
       SELECT COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='RECEPCION'),0)::int AS unidades_recibidas,
              COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='DEVOLUCION_PROVEEDOR'),0)::int AS unidades_devueltas,
              COALESCE(SUM(l.signo*l.cantidad),0)::int AS unidades_netas
       FROM lineas_compra l WHERE ${FILTRO_COMPRA_LINEA}`,
      params
    ),
    db.query(
      `WITH ${EVENTOS_COMPRA_CTE}
       SELECT e.proveedor_id, p.nombre AS proveedor_nombre,
              COUNT(*) FILTER (WHERE e.tipo='RECEPCION')::int AS recepciones,
              COALESCE(SUM(e.total) FILTER (WHERE e.tipo='RECEPCION'),0) AS total_recibido,
              COALESCE(SUM(e.total) FILTER (WHERE e.tipo='DEVOLUCION_PROVEEDOR'),0) AS total_devuelto,
              COALESCE(SUM(e.signo*e.total),0) AS compra_neta
       FROM eventos_compra e
       JOIN proveedores p ON p.id=e.proveedor_id
       WHERE ${FILTRO_COMPRA_EVENTO}
       GROUP BY e.proveedor_id, p.nombre
       ORDER BY compra_neta DESC, p.nombre LIMIT 20`,
      params
    ),
    db.query(
      `WITH ${LINEAS_COMPRA_CTE}
       SELECT l.producto_id, MAX(l.sku) AS sku, MAX(l.titulo) AS titulo,
              MAX(l.editorial) AS editorial,
              COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='RECEPCION'),0)::int AS unidades_recibidas,
              COALESCE(SUM(l.cantidad) FILTER (WHERE l.tipo='DEVOLUCION_PROVEEDOR'),0)::int AS unidades_devueltas,
              COALESCE(SUM(l.signo*l.cantidad),0)::int AS unidades_netas,
              COALESCE(SUM(l.signo*l.total),0) AS costo_neto
       FROM lineas_compra l WHERE ${FILTRO_COMPRA_LINEA}
       GROUP BY l.producto_id
       ORDER BY costo_neto DESC, titulo LIMIT 20`,
      params
    ),
    db.query(
      `WITH ${EVENTOS_COMPRA_CTE}
       SELECT e.* FROM eventos_compra e
       WHERE ${FILTRO_COMPRA_EVENTO}
       ORDER BY e.creado_en DESC, e.tipo, e.documento_id DESC
       LIMIT $4 OFFSET $5`,
      [...params, filtros.limit, offset]
    ),
    db.query(
      `WITH recibido AS (
         SELECT detalle_orden_compra_id, SUM(cantidad)::int AS cantidad
         FROM detalle_recepciones_compra GROUP BY detalle_orden_compra_id
       )
       SELECT COUNT(DISTINCT oc.id)::int AS ordenes_abiertas,
              COALESCE(SUM(GREATEST(doc.cantidad-COALESCE(r.cantidad,0),0)),0)::int AS unidades_pendientes,
              COALESCE(SUM(ROUND(GREATEST(doc.cantidad-COALESCE(r.cantidad,0),0)
                * doc.costo_unitario * (1 + doc.iva_porcentaje/100),2)),0) AS importe_pendiente
       FROM ordenes_compra oc
       JOIN detalle_ordenes_compra doc ON doc.orden_compra_id=oc.id
       LEFT JOIN recibido r ON r.detalle_orden_compra_id=doc.id
       WHERE oc.estado IN ('EMITIDA','PARCIAL')
         AND ($1::bigint IS NULL OR oc.proveedor_id=$1)`,
      [filtros.proveedorId || null]
    ),
  ]);
  const resumen = {
    ...resumenDocumentos.rows[0],
    ...resumenLineas.rows[0],
  };
  return {
    generado_en: new Date().toISOString(),
    periodo,
    resumen,
    compromisos_actuales: compromisos.rows[0],
    proveedores: proveedores.rows,
    productos: productos.rows,
    movimientos: paginacion(
      filtros.page,
      filtros.limit,
      resumen.movimientos,
      movimientos.rows
    ),
  };
}

const PEDIDOS_FILTRADOS_CTE = `pedidos_filtrados AS (
  SELECT p.id, p.folio, p.canal, p.canal_precio, p.estado, p.cliente_id,
         p.cliente_nombre, p.cliente_telefono, p.tipo_entrega,
         p.subtotal, p.descuento, p.iva, p.total, p.expira_en,
         p.whatsapp_notificado_en, p.creado_en, p.actualizado_en,
         p.creado_por_usuario_id, u.nombre AS creado_por,
         COALESCE(SUM(dp.cantidad),0)::int AS unidades,
         COALESCE(SUM(rs.cantidad) FILTER (WHERE rs.estado='ACTIVA'),0)::int AS unidades_reservadas,
         COUNT(rs.id) FILTER (WHERE rs.estado='ACTIVA')::int AS reservas_activas,
         (p.estado IN ('RESERVADO','LISTO') AND p.expira_en <= NOW()) AS vencido_pendiente,
         v.id AS venta_id, v.folio AS venta_folio
  FROM pedidos p
  LEFT JOIN usuarios u ON u.id=p.creado_por_usuario_id
  JOIN detalle_pedidos dp ON dp.pedido_id=p.id
  LEFT JOIN reservas_stock rs ON rs.detalle_pedido_id=dp.id
  LEFT JOIN ventas v ON v.pedido_id=p.id
  WHERE p.creado_en >= $1::timestamptz AND p.creado_en < $2::timestamptz
    AND ($3::text IS NULL OR p.canal=$3)
    AND ($4::text IS NULL OR p.estado=$4)
    AND ($5::text IS NULL OR p.tipo_entrega=$5)
  GROUP BY p.id, u.nombre, v.id, v.folio
)`;

async function reportePedidos(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [
    periodo.desde,
    periodo.hasta,
    filtros.canal || null,
    filtros.estado || null,
    filtros.tipoEntrega || null,
  ];
  const offset = (filtros.page - 1) * filtros.limit;
  const [resumen, porEstado, porCanal, porEntrega, transiciones, filas] = await Promise.all([
    db.query(
      `WITH ${PEDIDOS_FILTRADOS_CTE}
       SELECT COUNT(*)::int AS pedidos,
              COALESCE(SUM(total),0) AS importe_solicitado,
              COALESCE(SUM(unidades),0)::int AS unidades_solicitadas,
              COUNT(*) FILTER (WHERE estado IN ('RESERVADO','LISTO'))::int AS activos,
              COUNT(*) FILTER (WHERE estado='COMPLETADO')::int AS completados,
              COUNT(*) FILTER (WHERE estado='CANCELADO')::int AS cancelados,
              COUNT(*) FILTER (WHERE estado='EXPIRADO')::int AS expirados,
              COUNT(*) FILTER (WHERE vencido_pendiente)::int AS vencidos_pendientes,
              COUNT(*) FILTER (WHERE whatsapp_notificado_en IS NOT NULL)::int AS notificados_whatsapp,
              COUNT(*) FILTER (WHERE estado='COMPLETADO' AND venta_id IS NULL)::int AS completados_sin_venta,
              COUNT(*) FILTER (WHERE estado IN ('COMPLETADO','CANCELADO','EXPIRADO')
                AND reservas_activas>0)::int AS finales_con_reserva,
              COALESCE(SUM(unidades_reservadas),0)::int AS unidades_reservadas
       FROM pedidos_filtrados`,
      params
    ),
    db.query(
      `WITH ${PEDIDOS_FILTRADOS_CTE}
       SELECT estado, COUNT(*)::int AS pedidos, COALESCE(SUM(total),0) AS importe
       FROM pedidos_filtrados GROUP BY estado ORDER BY estado`,
      params
    ),
    db.query(
      `WITH ${PEDIDOS_FILTRADOS_CTE}
       SELECT canal, COUNT(*)::int AS pedidos, COALESCE(SUM(total),0) AS importe,
              COUNT(*) FILTER (WHERE estado='COMPLETADO')::int AS completados
       FROM pedidos_filtrados GROUP BY canal ORDER BY canal`,
      params
    ),
    db.query(
      `WITH ${PEDIDOS_FILTRADOS_CTE}
       SELECT tipo_entrega, COUNT(*)::int AS pedidos, COALESCE(SUM(total),0) AS importe
       FROM pedidos_filtrados GROUP BY tipo_entrega ORDER BY tipo_entrega`,
      params
    ),
    db.query(
      `SELECT pt.estado_nuevo AS estado, COUNT(*)::int AS transiciones
       FROM pedido_transiciones pt
       JOIN pedidos p ON p.id=pt.pedido_id
       WHERE pt.creado_en >= $1::timestamptz AND pt.creado_en < $2::timestamptz
         AND pt.estado_anterior IS NOT NULL
         AND ($3::text IS NULL OR p.canal=$3)
         AND ($4::text IS NULL OR pt.estado_nuevo=$4)
         AND ($5::text IS NULL OR p.tipo_entrega=$5)
       GROUP BY pt.estado_nuevo ORDER BY pt.estado_nuevo`,
      params
    ),
    db.query(
      `WITH ${PEDIDOS_FILTRADOS_CTE}
       SELECT * FROM pedidos_filtrados
       ORDER BY creado_en DESC, id DESC
       LIMIT $6 OFFSET $7`,
      [...params, filtros.limit, offset]
    ),
  ]);
  return {
    generado_en: new Date().toISOString(),
    periodo,
    resumen: resumen.rows[0],
    por_estado: porEstado.rows,
    por_canal: porCanal.rows,
    por_entrega: porEntrega.rows,
    transiciones_periodo: transiciones.rows,
    pedidos: paginacion(
      filtros.page,
      filtros.limit,
      resumen.rows[0].pedidos,
      filas.rows
    ),
  };
}

const FILTRO_MOVIMIENTOS_CAJA = `m.creado_en >= $1::timestamptz
  AND m.creado_en < $2::timestamptz
  AND ($3::int IS NULL OR m.caja_id=$3)
  AND ($4::int IS NULL OR m.usuario_id=$4)
  AND ($5::int IS NULL OR EXISTS (
    SELECT 1 FROM sesiones_caja so
    WHERE so.id=m.sesion_id AND so.usuario_id=$5
  ))`;

async function reporteCaja(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [
    periodo.desde,
    periodo.hasta,
    filtros.cajaId || null,
    filtros.usuarioId || null,
    filtros.operadorId || null,
  ];
  const offset = (filtros.page - 1) * filtros.limit;
  const [resumenMovimientos, resumenCortes, porCajaUsuario, movimientos, cortes, abiertas] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS movimientos,
              COUNT(*) FILTER (WHERE m.actor_inferido)::int AS actores_inferidos,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='APERTURA'),0) AS fondos_apertura,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='VENTA' AND m.metodo_pago='EFECTIVO'),0) AS ventas_efectivo,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='VENTA' AND m.metodo_pago='TARJETA'),0) AS ventas_tarjeta,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='VENTA' AND m.metodo_pago='TRANSFERENCIA'),0) AS ventas_transferencia,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo IN ('CANCELACION','DEVOLUCION')
                AND m.metodo_pago='EFECTIVO'),0) AS reversos_efectivo,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo IN ('CANCELACION','DEVOLUCION')
                AND m.metodo_pago='TARJETA'),0) AS reversos_tarjeta,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo IN ('CANCELACION','DEVOLUCION')
                AND m.metodo_pago='TRANSFERENCIA'),0) AS reversos_transferencia,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='INGRESO'),0) AS ingresos,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='RETIRO'),0) AS retiros,
              COALESCE(SUM(CASE
                WHEN m.tipo='VENTA' AND m.metodo_pago='EFECTIVO' THEN m.monto
                WHEN m.tipo='INGRESO' THEN m.monto
                WHEN m.tipo='RETIRO' THEN -m.monto
                WHEN m.tipo IN ('CANCELACION','DEVOLUCION') AND m.metodo_pago='EFECTIVO' THEN -m.monto
                ELSE 0 END),0) AS flujo_efectivo
       FROM movimientos m WHERE ${FILTRO_MOVIMIENTOS_CAJA}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS cortes,
              COALESCE(SUM(cor.diferencia),0) AS diferencia_cortes,
              COALESCE(SUM(ABS(cor.diferencia)),0) AS diferencia_absoluta_cortes
       FROM cortes cor
       JOIN sesiones_caja s ON s.id=cor.sesion_id
       WHERE cor.creado_en >= $1::timestamptz AND cor.creado_en < $2::timestamptz
         AND ($3::int IS NULL OR s.caja_id=$3)
         AND ($4::int IS NULL OR cor.usuario_id=$4)
         AND ($5::int IS NULL OR s.usuario_id=$5)`,
      params
    ),
    db.query(
      `SELECT m.caja_id, c.nombre AS caja_nombre, m.usuario_id, u.nombre AS usuario,
              COUNT(*)::int AS movimientos,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='VENTA'),0) AS ventas,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo IN ('CANCELACION','DEVOLUCION')),0) AS reversos,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='INGRESO'),0) AS ingresos,
              COALESCE(SUM(m.monto) FILTER (WHERE m.tipo='RETIRO'),0) AS retiros,
              COALESCE(SUM(CASE
                WHEN m.tipo='VENTA' AND m.metodo_pago='EFECTIVO' THEN m.monto
                WHEN m.tipo='INGRESO' THEN m.monto
                WHEN m.tipo='RETIRO' THEN -m.monto
                WHEN m.tipo IN ('CANCELACION','DEVOLUCION') AND m.metodo_pago='EFECTIVO' THEN -m.monto
                ELSE 0 END),0) AS flujo_efectivo
       FROM movimientos m
       JOIN caja c ON c.id=m.caja_id JOIN usuarios u ON u.id=m.usuario_id
       WHERE ${FILTRO_MOVIMIENTOS_CAJA}
       GROUP BY m.caja_id, c.nombre, m.usuario_id, u.nombre
       ORDER BY c.nombre, u.nombre`,
      params
    ),
    db.query(
      `SELECT m.id, m.creado_en, m.tipo, m.referencia, m.concepto, m.monto,
              m.metodo_pago, m.sesion_id, m.caja_id, c.nombre AS caja_nombre,
              m.usuario_id, u.nombre AS usuario, m.actor_inferido
       FROM movimientos m
       JOIN caja c ON c.id=m.caja_id JOIN usuarios u ON u.id=m.usuario_id
       WHERE ${FILTRO_MOVIMIENTOS_CAJA}
       ORDER BY m.creado_en DESC, m.id DESC
       LIMIT $6 OFFSET $7`,
      [...params, filtros.limit, offset]
    ),
    db.query(
      `SELECT cor.*, s.fecha_apertura, s.fecha_cierre, s.caja_id,
              c.nombre AS caja_nombre, s.usuario_id AS operador_id,
              op.nombre AS operador, resp.nombre AS responsable
       FROM cortes cor
       JOIN sesiones_caja s ON s.id=cor.sesion_id
       JOIN caja c ON c.id=s.caja_id
       JOIN usuarios op ON op.id=s.usuario_id
       JOIN usuarios resp ON resp.id=cor.usuario_id
       WHERE cor.creado_en >= $1::timestamptz AND cor.creado_en < $2::timestamptz
         AND ($3::int IS NULL OR s.caja_id=$3)
         AND ($4::int IS NULL OR cor.usuario_id=$4)
         AND ($5::int IS NULL OR s.usuario_id=$5)
       ORDER BY cor.creado_en DESC, cor.id DESC LIMIT 100`,
      params
    ),
    db.query(
      `SELECT s.id AS sesion_id, s.caja_id, c.nombre AS caja_nombre,
              s.usuario_id, u.nombre AS operador, s.fondo_inicial,
              s.fecha_apertura
       FROM sesiones_caja s
       JOIN caja c ON c.id=s.caja_id JOIN usuarios u ON u.id=s.usuario_id
       WHERE s.estado='ABIERTA'
         AND ($1::int IS NULL OR s.caja_id=$1)
         AND ($2::int IS NULL OR s.usuario_id=$2)
       ORDER BY c.nombre, s.id`,
      [filtros.cajaId || null, filtros.operadorId || null]
    ),
  ]);
  const resumen = {
    ...resumenMovimientos.rows[0],
    ...resumenCortes.rows[0],
    sesiones_abiertas: abiertas.rowCount,
  };
  return {
    generado_en: new Date().toISOString(),
    periodo,
    resumen,
    por_caja_usuario: porCajaUsuario.rows,
    cortes: cortes.rows,
    sesiones_abiertas: abiertas.rows,
    movimientos: paginacion(
      filtros.page,
      filtros.limit,
      resumen.movimientos,
      movimientos.rows
    ),
  };
}

function exigirLimiteExportacion(filas) {
  if (filas.length > LIMITE_EXPORTACION) {
    throw new ApiError(
      413,
      `La exportación supera ${LIMITE_EXPORTACION} filas. Reduce el periodo o aplica más filtros.`
    );
  }
  return filas;
}

function nombreExportacion(tipo) {
  return `libreria-rem-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`;
}

async function exportarVentas(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = parametrosVentas(periodo, filtros);
  const result = await db.query(
    `WITH ${EVENTOS_VENTA_CTE}
     SELECT e.* FROM eventos_venta e
     WHERE ${FILTRO_EVENTOS_VENTA}
     ORDER BY e.creado_en, e.evento_clave
     LIMIT $7`,
    [...params, LIMITE_EXPORTACION + 1]
  );
  const filas = exigirLimiteExportacion(result.rows);
  const columnas = [
    { clave: "creado_en", etiqueta: "Fecha" },
    { clave: "tipo", etiqueta: "Tipo de evento" },
    { clave: "folio", etiqueta: "Folio de venta" },
    { clave: "canal", etiqueta: "Canal" },
    { clave: "origen", etiqueta: "Origen" },
    { clave: "cliente", etiqueta: "Cliente" },
    { clave: "caja_nombre", etiqueta: "Caja" },
    { clave: "usuario", etiqueta: "Usuario del evento" },
    { clave: "metodo_pago", etiqueta: "Método de pago" },
    { clave: "importe", etiqueta: "Importe" },
    {
      etiqueta: "Importe neto",
      valor: (fila) => fila.tipo === "VENTA" ? fila.importe : -Number(fila.importe),
    },
    { clave: "referencia", etiqueta: "Referencia" },
    { clave: "concepto", etiqueta: "Concepto" },
  ];
  return { nombre: nombreExportacion("ventas"), contenido: crearCsv(columnas, filas), filas: filas.length };
}

async function exportarInventario(db, filtros) {
  const params = parametrosInventario(filtros);
  const result = await db.query(
    `WITH ${INVENTARIO_BASE_CTE}
     SELECT * FROM inventario_filtrado
     ORDER BY titulo, producto_id LIMIT $7`,
    [...params, LIMITE_EXPORTACION + 1]
  );
  const filas = exigirLimiteExportacion(result.rows);
  const columnas = [
    { clave: "sku", etiqueta: "SKU" },
    { clave: "isbn", etiqueta: "ISBN" },
    { clave: "titulo", etiqueta: "Título" },
    { clave: "autor", etiqueta: "Autor" },
    { clave: "editorial", etiqueta: "Editorial" },
    { clave: "categoria", etiqueta: "Categoría" },
    { clave: "fisico", etiqueta: "Existencia física" },
    { clave: "reservado", etiqueta: "Reservado" },
    { clave: "consignado", etiqueta: "En consignación" },
    { clave: "propiedad_total", etiqueta: "Existencia propia total" },
    { clave: "disponible", etiqueta: "Disponible" },
    { clave: "en_transito", etiqueta: "En tránsito" },
    { clave: "stock_minimo", etiqueta: "Mínimo" },
    { clave: "stock_objetivo", etiqueta: "Objetivo" },
    { clave: "cantidad_sugerida", etiqueta: "Reposición sugerida" },
    { clave: "proveedor_preferido", etiqueta: "Proveedor preferido" },
    { clave: "costo", etiqueta: "Costo actual" },
    { clave: "precio", etiqueta: "Precio actual" },
    { clave: "valor_costo_fisico", etiqueta: "Valor físico a costo actual" },
    { clave: "valor_costo_consignado", etiqueta: "Valor consignado a costo actual" },
    { clave: "valor_costo_total", etiqueta: "Valor total propio a costo actual" },
    { clave: "valor_venta_disponible", etiqueta: "Valor disponible a precio actual" },
    { clave: "publicado_web", etiqueta: "Publicado en línea" },
    { clave: "activo", etiqueta: "Activo" },
  ];
  return { nombre: nombreExportacion("inventario"), contenido: crearCsv(columnas, filas), filas: filas.length };
}

async function exportarCompras(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [periodo.desde, periodo.hasta, filtros.proveedorId || null];
  const result = await db.query(
    `WITH ${EVENTOS_COMPRA_CTE}
     SELECT e.* FROM eventos_compra e
     WHERE ${FILTRO_COMPRA_EVENTO}
     ORDER BY e.creado_en, e.tipo, e.documento_id LIMIT $4`,
    [...params, LIMITE_EXPORTACION + 1]
  );
  const filas = exigirLimiteExportacion(result.rows);
  const columnas = [
    { clave: "creado_en", etiqueta: "Fecha" },
    { clave: "tipo", etiqueta: "Tipo de evento" },
    { clave: "folio", etiqueta: "Folio" },
    { clave: "orden_folio", etiqueta: "Orden de compra" },
    { clave: "proveedor_nombre", etiqueta: "Proveedor" },
    { clave: "usuario", etiqueta: "Usuario" },
    { clave: "referencia", etiqueta: "Documento o referencia" },
    { clave: "subtotal", etiqueta: "Subtotal" },
    { clave: "iva", etiqueta: "IVA" },
    { clave: "total", etiqueta: "Total" },
    {
      etiqueta: "Total neto",
      valor: (fila) => fila.tipo === "RECEPCION" ? fila.total : -Number(fila.total),
    },
  ];
  return { nombre: nombreExportacion("compras"), contenido: crearCsv(columnas, filas), filas: filas.length };
}

async function exportarPedidos(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [
    periodo.desde,
    periodo.hasta,
    filtros.canal || null,
    filtros.estado || null,
    filtros.tipoEntrega || null,
  ];
  const result = await db.query(
    `WITH ${PEDIDOS_FILTRADOS_CTE}
     SELECT * FROM pedidos_filtrados
     ORDER BY creado_en, id LIMIT $6`,
    [...params, LIMITE_EXPORTACION + 1]
  );
  const filas = exigirLimiteExportacion(result.rows);
  const columnas = [
    { clave: "creado_en", etiqueta: "Fecha de creación" },
    { clave: "folio", etiqueta: "Folio" },
    { clave: "canal", etiqueta: "Canal" },
    { clave: "estado", etiqueta: "Estado actual" },
    { clave: "cliente_nombre", etiqueta: "Cliente" },
    { clave: "cliente_telefono", etiqueta: "Teléfono" },
    { clave: "tipo_entrega", etiqueta: "Entrega" },
    { clave: "unidades", etiqueta: "Unidades solicitadas" },
    { clave: "unidades_reservadas", etiqueta: "Unidades reservadas" },
    { clave: "total", etiqueta: "Importe solicitado" },
    { clave: "expira_en", etiqueta: "Expiración de reserva" },
    { clave: "vencido_pendiente", etiqueta: "Vencido pendiente de procesar" },
    { clave: "venta_folio", etiqueta: "Venta vinculada" },
    { clave: "creado_por", etiqueta: "Creado por" },
  ];
  return { nombre: nombreExportacion("pedidos"), contenido: crearCsv(columnas, filas), filas: filas.length };
}

async function exportarCaja(db, filtros) {
  const periodo = await resolverPeriodo(db, filtros);
  const params = [
    periodo.desde,
    periodo.hasta,
    filtros.cajaId || null,
    filtros.usuarioId || null,
    filtros.operadorId || null,
  ];
  const result = await db.query(
    `SELECT m.id, m.creado_en, m.tipo, m.referencia, m.concepto, m.monto,
            m.metodo_pago, m.sesion_id, c.nombre AS caja_nombre,
            u.nombre AS usuario, m.actor_inferido
     FROM movimientos m
     JOIN caja c ON c.id=m.caja_id JOIN usuarios u ON u.id=m.usuario_id
     WHERE ${FILTRO_MOVIMIENTOS_CAJA}
     ORDER BY m.creado_en, m.id LIMIT $6`,
    [...params, LIMITE_EXPORTACION + 1]
  );
  const filas = exigirLimiteExportacion(result.rows);
  const columnas = [
    { clave: "creado_en", etiqueta: "Fecha" },
    { clave: "tipo", etiqueta: "Tipo" },
    { clave: "caja_nombre", etiqueta: "Caja" },
    { clave: "sesion_id", etiqueta: "Sesión" },
    { clave: "usuario", etiqueta: "Usuario" },
    { clave: "metodo_pago", etiqueta: "Método de pago" },
    { clave: "monto", etiqueta: "Monto" },
    {
      etiqueta: "Monto firmado",
      valor: (fila) => {
        if (["RETIRO", "CANCELACION", "DEVOLUCION"].includes(fila.tipo)) return -Number(fila.monto);
        if (fila.tipo === "CIERRE") return 0;
        return Number(fila.monto);
      },
    },
    {
      etiqueta: "Impacto en efectivo",
      valor: (fila) => {
        if (fila.tipo === "INGRESO") return Number(fila.monto);
        if (fila.tipo === "RETIRO") return -Number(fila.monto);
        if (fila.metodo_pago !== "EFECTIVO") return 0;
        return fila.tipo === "VENTA" ? Number(fila.monto) : -Number(fila.monto);
      },
    },
    { clave: "referencia", etiqueta: "Referencia" },
    { clave: "concepto", etiqueta: "Concepto" },
    { clave: "actor_inferido", etiqueta: "Actor inferido" },
  ];
  return { nombre: nombreExportacion("caja"), contenido: crearCsv(columnas, filas), filas: filas.length };
}

async function exportarReporte(db, tipo, filtros) {
  if (tipo === "ventas") return exportarVentas(db, filtros);
  if (tipo === "inventario") return exportarInventario(db, filtros);
  if (tipo === "compras") return exportarCompras(db, filtros);
  if (tipo === "pedidos") return exportarPedidos(db, filtros);
  if (tipo === "caja") return exportarCaja(db, filtros);
  throw new ApiError(404, "Tipo de reporte inexistente.");
}

module.exports = {
  LIMITE_EXPORTACION,
  iniciarLecturaConsistente,
  obtenerFiltrosReportes,
  reporteVentas,
  reporteInventario,
  reporteCompras,
  reportePedidos,
  reporteCaja,
  exportarReporte,
};
