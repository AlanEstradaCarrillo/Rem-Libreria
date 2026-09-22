const { ApiError } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento, idsOrdenados } = require("./inventario.service");

const CTE_MERCANCIA_EN_TRANSITO = `recibido AS (
       SELECT detalle_orden_compra_id, SUM(cantidad)::int AS cantidad
       FROM detalle_recepciones_compra
       GROUP BY detalle_orden_compra_id
     ), en_transito AS (
       SELECT d.producto_id,
              SUM(GREATEST(d.cantidad - COALESCE(r.cantidad, 0), 0))::int AS cantidad
       FROM detalle_ordenes_compra d
       JOIN ordenes_compra oc ON oc.id=d.orden_compra_id
       LEFT JOIN recibido r ON r.detalle_orden_compra_id=d.id
       WHERE oc.estado IN ('EMITIDA', 'PARCIAL')
       GROUP BY d.producto_id
     )`;

function idPositivo(value, field = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${field} inválido.`);
  return id;
}

function mapaUltimoMovimiento(rows) {
  return new Map(rows.map((row) => [Number(row.producto_id), row.movimiento_id == null ? null : Number(row.movimiento_id)]));
}

async function ultimosMovimientos(db, productoIds) {
  if (!productoIds.length) return new Map();
  const result = await db.query(
    `SELECT p.id AS producto_id,
            (SELECT im.id FROM inventario_movimientos im
             WHERE im.producto_id=p.id ORDER BY im.id DESC LIMIT 1) AS movimiento_id
     FROM productos p
     WHERE p.id=ANY($1::int[])
     ORDER BY p.id`,
    [idsOrdenados(productoIds)]
  );
  return mapaUltimoMovimiento(result.rows);
}

async function cargarPoliticaReposicion(db, productoId) {
  const id = idPositivo(productoId, "producto_id");
  const result = await db.query(
    `SELECT p.id AS producto_id, p.sku, p.titulo, p.stock AS fisico,
            p.stock_reservado AS reservado, p.stock_consignado AS consignado,
            (p.stock+p.stock_consignado)::int AS propiedad_total,
            p.stock_disponible AS disponible,
            COALESCE(pr.stock_minimo, 0)::int AS stock_minimo,
            COALESCE(pr.stock_objetivo, 0)::int AS stock_objetivo,
            pr.proveedor_preferido_id, prov.nombre AS proveedor_preferido,
            prov.activo AS proveedor_preferido_activo,
            pr.actualizado_por_usuario_id, pr.actualizado_en
     FROM productos p
     LEFT JOIN politicas_reposicion pr ON pr.producto_id=p.id
     LEFT JOIN proveedores prov ON prov.id=pr.proveedor_preferido_id
     WHERE p.id=$1`,
    [id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Producto no encontrado.");
  return result.rows[0];
}

async function guardarPoliticaReposicion(client, {
  productoId,
  stockMinimo,
  stockObjetivo,
  proveedorPreferidoId = null,
  usuarioId,
  motivo,
  origenClave,
}) {
  const productoIdValido = idPositivo(productoId, "producto_id");
  let proveedor = null;
  if (proveedorPreferidoId != null) {
    const result = await client.query(
      `SELECT id, nombre, activo FROM proveedores WHERE id=$1 FOR KEY SHARE`,
      [idPositivo(proveedorPreferidoId, "proveedor_preferido_id")]
    );
    proveedor = result.rows[0];
    if (!proveedor) throw new ApiError(404, "Proveedor preferido no encontrado.");
    if (!proveedor.activo) throw new ApiError(409, "El proveedor preferido está inactivo.");
  }
  // Compras bloquea primero proveedor y después productos; conservar el mismo
  // orden evita un ciclo de espera al editar una política mientras se emite una OC.
  const [producto] = await bloquearProductos(client, [productoIdValido]);
  const anteriorResult = await client.query(
    `SELECT * FROM politicas_reposicion WHERE producto_id=$1 FOR UPDATE`,
    [producto.id]
  );
  const anterior = anteriorResult.rows[0] || null;
  await client.query(
    `INSERT INTO politicas_reposicion
       (producto_id, stock_minimo, stock_objetivo, proveedor_preferido_id,
        creado_por_usuario_id, actualizado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (producto_id) DO UPDATE
     SET stock_minimo=EXCLUDED.stock_minimo,
         stock_objetivo=EXCLUDED.stock_objetivo,
         proveedor_preferido_id=EXCLUDED.proveedor_preferido_id,
         actualizado_por_usuario_id=EXCLUDED.actualizado_por_usuario_id,
         actualizado_en=NOW()`,
    [producto.id, stockMinimo, stockObjetivo, proveedor ? proveedor.id : null, usuarioId]
  );
  await client.query(
    `INSERT INTO politicas_reposicion_historial
       (producto_id, stock_minimo_anterior, stock_objetivo_anterior,
        proveedor_anterior_id, stock_minimo_nuevo, stock_objetivo_nuevo,
        proveedor_nuevo_id, usuario_id, motivo, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      producto.id,
      anterior ? anterior.stock_minimo : null,
      anterior ? anterior.stock_objetivo : null,
      anterior ? anterior.proveedor_preferido_id : null,
      stockMinimo,
      stockObjetivo,
      proveedor ? proveedor.id : null,
      usuarioId,
      motivo,
      origenClave,
    ]
  );
  return cargarPoliticaReposicion(client, producto.id);
}

async function listarSugerenciasReposicion(db, {
  q = "",
  proveedorId = null,
  soloSugeridos = true,
  page = 1,
  limit = 100,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `WITH ${CTE_MERCANCIA_EN_TRANSITO}
     SELECT p.id AS producto_id, p.sku, p.titulo, p.isbn, p.editorial,
            p.costo, p.iva, p.activo,
            p.stock::int AS fisico, p.stock_reservado::int AS reservado,
            p.stock_consignado::int AS consignado,
            (p.stock+p.stock_consignado)::int AS propiedad_total,
            p.stock_disponible::int AS disponible,
            pr.stock_minimo::int, pr.stock_objetivo::int,
            pr.proveedor_preferido_id, prov.nombre AS proveedor_preferido,
            COALESCE(et.cantidad, 0)::int AS en_transito,
            (p.stock_disponible + COALESCE(et.cantidad, 0))::int AS disponible_proyectado,
            CASE
              WHEN p.activo AND pr.stock_objetivo > 0
                   AND p.stock_disponible + COALESCE(et.cantidad, 0) <= pr.stock_minimo
                   AND pr.stock_objetivo > p.stock_disponible + COALESCE(et.cantidad, 0)
              THEN pr.stock_objetivo - (p.stock_disponible + COALESCE(et.cantidad, 0))
              ELSE 0
            END::int AS cantidad_sugerida
     FROM politicas_reposicion pr
     JOIN productos p ON p.id=pr.producto_id
     LEFT JOIN proveedores prov ON prov.id=pr.proveedor_preferido_id
     LEFT JOIN en_transito et ON et.producto_id=p.id
     WHERE ($1::text='' OR p.sku ILIKE '%'||$1||'%' OR p.titulo ILIKE '%'||$1||'%'
            OR COALESCE(p.isbn, '') ILIKE '%'||$1||'%'
            OR COALESCE(p.editorial, '') ILIKE '%'||$1||'%')
       AND ($2::bigint IS NULL OR pr.proveedor_preferido_id=$2)
       AND (
         NOT $3::boolean
         OR (
           p.activo AND pr.stock_objetivo > 0
           AND p.stock_disponible + COALESCE(et.cantidad, 0) <= pr.stock_minimo
           AND pr.stock_objetivo > p.stock_disponible + COALESCE(et.cantidad, 0)
         )
       )
     ORDER BY
       CASE WHEN p.stock_disponible + COALESCE(et.cantidad, 0) <= pr.stock_minimo
                 AND pr.stock_objetivo > p.stock_disponible + COALESCE(et.cantidad, 0)
            THEN 0 ELSE 1 END,
       cantidad_sugerida DESC, p.titulo, p.id
     LIMIT $4 OFFSET $5`,
    [q, proveedorId, soloSugeridos, limit, offset]
  );
  return { sugerencias: result.rows, page, limit };
}

async function cargarConteoInventario(db, conteoId) {
  const id = idPositivo(conteoId, "conteo_inventario_id");
  const cabeceraResult = await db.query(
    `SELECT c.*, uc.nombre AS creado_por, ua.nombre AS aplicado_por,
            ux.nombre AS cancelado_por
     FROM conteos_inventario c
     JOIN usuarios uc ON uc.id=c.creado_por_usuario_id
     LEFT JOIN usuarios ua ON ua.id=c.aplicado_por_usuario_id
     LEFT JOIN usuarios ux ON ux.id=c.cancelado_por_usuario_id
     WHERE c.id=$1`,
    [id]
  );
  const cabecera = cabeceraResult.rows[0];
  if (!cabecera) throw new ApiError(404, "Conteo de inventario no encontrado.");
  const detalles = await db.query(
    `SELECT d.*, p.stock::int AS stock_fisico_actual,
            p.stock_reservado::int AS stock_reservado_actual,
            p.stock_consignado::int AS stock_consignado_actual,
            p.stock_disponible::int AS stock_disponible_actual,
            ult.id AS captura_actual_id, ult.cantidad_contada,
            ult.stock_fisico_base, ult.stock_reservado_base,
            ult.movimiento_base_id, ult.capturado_por_usuario_id,
            ult.creado_en AS capturado_en, u.nombre AS capturado_por,
            (ult.cantidad_contada - ult.stock_fisico_base)::int AS diferencia_capturada,
            mov.movimiento_actual_id,
            CASE WHEN ult.id IS NULL THEN FALSE
                 ELSE COALESCE(mov.movimiento_actual_id, 0) <> COALESCE(ult.movimiento_base_id, 0)
                      OR p.stock <> ult.stock_fisico_base
                      OR p.stock_reservado <> ult.stock_reservado_base
            END AS inventario_cambio_despues_captura
     FROM detalle_conteos_inventario d
     JOIN productos p ON p.id=d.producto_id
     LEFT JOIN LATERAL (
       SELECT c.* FROM capturas_conteo_inventario c
       WHERE c.detalle_conteo_inventario_id=d.id
       ORDER BY c.id DESC LIMIT 1
     ) ult ON TRUE
     LEFT JOIN usuarios u ON u.id=ult.capturado_por_usuario_id
     LEFT JOIN LATERAL (
       SELECT im.id AS movimiento_actual_id
       FROM inventario_movimientos im
       WHERE im.producto_id=d.producto_id
       ORDER BY im.id DESC LIMIT 1
     ) mov ON TRUE
     WHERE d.conteo_inventario_id=$1
     ORDER BY d.producto_titulo, d.producto_id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT t.*, u.nombre AS usuario
     FROM conteo_inventario_transiciones t
     JOIN usuarios u ON u.id=t.usuario_id
     WHERE t.conteo_inventario_id=$1 ORDER BY t.id`,
    [id]
  );
  return { ...cabecera, detalles: detalles.rows, transiciones: transiciones.rows };
}

async function listarConteosInventario(db, {
  estado = null,
  q = "",
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT c.id, c.folio, c.estado, c.notas, c.creado_en, c.actualizado_en,
            c.aplicado_en, c.cancelado_en, u.nombre AS creado_por,
            COUNT(d.id)::int AS partidas,
            COUNT(ult.id)::int AS capturadas,
            COALESCE(SUM(ABS(ult.cantidad_contada - ult.stock_fisico_base)), 0)::int
              AS diferencia_absoluta
     FROM conteos_inventario c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     JOIN detalle_conteos_inventario d ON d.conteo_inventario_id=c.id
     LEFT JOIN LATERAL (
       SELECT cap.id, cap.cantidad_contada, cap.stock_fisico_base
       FROM capturas_conteo_inventario cap
       WHERE cap.detalle_conteo_inventario_id=d.id
       ORDER BY cap.id DESC LIMIT 1
     ) ult ON TRUE
     WHERE ($1::text IS NULL OR c.estado=$1)
       AND ($2::text='' OR c.folio ILIKE '%'||$2||'%'
            OR COALESCE(c.notas, '') ILIKE '%'||$2||'%'
            OR EXISTS (
              SELECT 1 FROM detalle_conteos_inventario dx
              WHERE dx.conteo_inventario_id=c.id
                AND (dx.producto_sku ILIKE '%'||$2||'%'
                     OR dx.producto_titulo ILIKE '%'||$2||'%')
            ))
     GROUP BY c.id, u.nombre
     ORDER BY c.creado_en DESC, c.id DESC
     LIMIT $3 OFFSET $4`,
    [estado, q, limit, offset]
  );
  return { conteos: result.rows, page, limit };
}

async function crearConteoInventario(client, {
  productoIds,
  notas = null,
  usuarioId,
  origenClave,
}) {
  const ids = idsOrdenados(productoIds);
  const productos = await bloquearProductos(client, ids);
  const movimientos = await ultimosMovimientos(client, ids);
  const cabeceraResult = await client.query(
    `INSERT INTO conteos_inventario (notas, creado_por_usuario_id)
     VALUES ($1,$2) RETURNING *`,
    [notas, usuarioId]
  );
  const conteo = cabeceraResult.rows[0];
  for (const producto of productos) {
    await client.query(
      `INSERT INTO detalle_conteos_inventario
         (conteo_inventario_id, producto_id, producto_sku, producto_titulo,
          stock_fisico_al_abrir, stock_reservado_al_abrir, movimiento_al_abrir_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        conteo.id, producto.id, producto.sku, producto.titulo,
        producto.stock, producto.stock_reservado,
        movimientos.get(Number(producto.id)) || null,
      ]
    );
  }
  await client.query(
    `INSERT INTO conteo_inventario_transiciones
       (conteo_inventario_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'BORRADOR',$2,$3,$4)`,
    [conteo.id, usuarioId, "Conteo creado.", origenClave]
  );
  return cargarConteoInventario(client, conteo.id);
}

async function bloquearConteo(client, conteoId) {
  const result = await client.query(
    `SELECT * FROM conteos_inventario WHERE id=$1 FOR UPDATE`,
    [idPositivo(conteoId, "conteo_inventario_id")]
  );
  if (!result.rows[0]) throw new ApiError(404, "Conteo de inventario no encontrado.");
  return result.rows[0];
}

async function capturarConteoInventario(client, {
  conteoId,
  items,
  usuarioId,
  origenClave,
}) {
  const conteo = await bloquearConteo(client, conteoId);
  if (conteo.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un conteo en borrador acepta capturas.");
  }
  const ids = idsOrdenados(items.map((item) => item.detalle_conteo_id));
  if (ids.length !== items.length) throw new ApiError(400, "No repitas partidas en una captura.");
  const detallesResult = await client.query(
    `SELECT * FROM detalle_conteos_inventario
     WHERE conteo_inventario_id=$1 AND id=ANY($2::bigint[])
     ORDER BY producto_id FOR UPDATE`,
    [conteo.id, ids]
  );
  if (detallesResult.rowCount !== ids.length) {
    throw new ApiError(400, "Una o más partidas no pertenecen al conteo.");
  }
  const detallePorId = new Map(detallesResult.rows.map((row) => [Number(row.id), row]));
  const productos = await bloquearProductos(
    client,
    detallesResult.rows.map((row) => row.producto_id)
  );
  const productoPorId = new Map(productos.map((row) => [Number(row.id), row]));
  const movimientos = await ultimosMovimientos(client, productos.map((row) => row.id));
  for (const item of [...items].sort((a, b) => a.detalle_conteo_id - b.detalle_conteo_id)) {
    const detalle = detallePorId.get(item.detalle_conteo_id);
    const producto = productoPorId.get(Number(detalle.producto_id));
    await client.query(
      `INSERT INTO capturas_conteo_inventario
         (conteo_inventario_id, detalle_conteo_inventario_id, producto_id,
          cantidad_contada, stock_fisico_base, stock_reservado_base,
          movimiento_base_id, capturado_por_usuario_id, origen_clave)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        conteo.id, detalle.id, detalle.producto_id, item.cantidad_contada,
        producto.stock, producto.stock_reservado,
        movimientos.get(Number(producto.id)) || null,
        usuarioId, `${origenClave}:DETALLE:${detalle.id}`,
      ]
    );
  }
  await client.query(
    `UPDATE conteos_inventario SET actualizado_en=NOW() WHERE id=$1`,
    [conteo.id]
  );
  return cargarConteoInventario(client, conteo.id);
}

async function aplicarConteoInventario(client, {
  conteoId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const conteo = await bloquearConteo(client, conteoId);
  if (conteo.estado !== "BORRADOR") {
    throw new ApiError(409, conteo.estado === "APLICADO"
      ? "El conteo ya fue aplicado."
      : "El conteo está cancelado.");
  }
  const detallesResult = await client.query(
    `SELECT d.*, cap.id AS captura_id, cap.cantidad_contada,
            cap.stock_fisico_base, cap.stock_reservado_base, cap.movimiento_base_id
     FROM detalle_conteos_inventario d
     LEFT JOIN LATERAL (
       SELECT c.* FROM capturas_conteo_inventario c
       WHERE c.detalle_conteo_inventario_id=d.id
       ORDER BY c.id DESC LIMIT 1
     ) cap ON TRUE
     WHERE d.conteo_inventario_id=$1
     ORDER BY d.producto_id
     FOR UPDATE OF d`,
    [conteo.id]
  );
  const detalles = detallesResult.rows;
  const sinCaptura = detalles.find((row) => row.captura_id == null);
  if (sinCaptura) {
    throw new ApiError(409, `Falta capturar "${sinCaptura.producto_titulo}".`);
  }
  const productos = await bloquearProductos(client, detalles.map((row) => row.producto_id));
  const productoPorId = new Map(productos.map((row) => [Number(row.id), row]));
  const movimientos = await ultimosMovimientos(client, productos.map((row) => row.id));
  for (const detalle of detalles) {
    const producto = productoPorId.get(Number(detalle.producto_id));
    const actualMovimiento = movimientos.get(Number(producto.id)) || null;
    const baseMovimiento = detalle.movimiento_base_id == null ? null : Number(detalle.movimiento_base_id);
    if (
      actualMovimiento !== baseMovimiento
      || Number(producto.stock) !== Number(detalle.stock_fisico_base)
      || Number(producto.stock_reservado) !== Number(detalle.stock_reservado_base)
    ) {
      throw new ApiError(
        409,
        `El inventario de "${detalle.producto_titulo}" cambió después de capturarlo. Vuelve a guardar su cantidad antes de aplicar.`
      );
    }
    if (Number(detalle.cantidad_contada) < Number(producto.stock_reservado)) {
      throw new ApiError(
        409,
        `La cantidad contada de "${detalle.producto_titulo}" es menor que sus unidades reservadas.`
      );
    }
  }

  for (const detalle of detalles) {
    const producto = productoPorId.get(Number(detalle.producto_id));
    const diferencia = Number(detalle.cantidad_contada) - Number(producto.stock);
    if (diferencia !== 0) {
      await aplicarMovimiento(client, {
        producto,
        deltaFisico: diferencia,
        tipo: "CONTEO",
        usuarioId,
        motivo: `Conteo ${conteo.folio}: ${motivo}`.slice(0, 240),
        origenClave: `CONTEO:${conteo.id}:DETALLE:${detalle.id}`,
        conteoInventarioId: conteo.id,
        detalleConteoInventarioId: detalle.id,
      });
    }
    await client.query(
      `UPDATE detalle_conteos_inventario
       SET captura_aplicada_id=$2, diferencia_aplicada=$3,
           stock_fisico_aplicado=$4, stock_reservado_aplicado=$5
       WHERE id=$1`,
      [
        detalle.id, detalle.captura_id, diferencia,
        detalle.cantidad_contada, detalle.stock_reservado_base,
      ]
    );
  }
  await client.query(
    `INSERT INTO conteo_inventario_transiciones
       (conteo_inventario_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','APLICADO',$2,$3,$4)`,
    [conteo.id, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE conteos_inventario
     SET estado='APLICADO', aplicado_por_usuario_id=$2,
         aplicado_en=NOW(), actualizado_en=NOW()
     WHERE id=$1`,
    [conteo.id, usuarioId]
  );
  return cargarConteoInventario(client, conteo.id);
}

async function cancelarConteoInventario(client, {
  conteoId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const conteo = await bloquearConteo(client, conteoId);
  if (conteo.estado !== "BORRADOR") {
    throw new ApiError(409, conteo.estado === "APLICADO"
      ? "Un conteo aplicado no puede cancelarse."
      : "El conteo ya está cancelado.");
  }
  await client.query(
    `INSERT INTO conteo_inventario_transiciones
       (conteo_inventario_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','CANCELADO',$2,$3,$4)`,
    [conteo.id, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE conteos_inventario
     SET estado='CANCELADO', cancelado_por_usuario_id=$2,
         cancelado_en=NOW(), cancelacion_motivo=$3, actualizado_en=NOW()
     WHERE id=$1`,
    [conteo.id, usuarioId, motivo]
  );
  return cargarConteoInventario(client, conteo.id);
}

module.exports = {
  CTE_MERCANCIA_EN_TRANSITO,
  idPositivo,
  cargarPoliticaReposicion,
  guardarPoliticaReposicion,
  listarSugerenciasReposicion,
  cargarConteoInventario,
  listarConteosInventario,
  crearConteoInventario,
  capturarConteoInventario,
  aplicarConteoInventario,
  cancelarConteoInventario,
};
