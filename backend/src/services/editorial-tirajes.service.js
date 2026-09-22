const { ApiError, round2 } = require("../utils/errors");
const { bloquearProductos, aplicarMovimiento } = require("./inventario.service");
const { idEditorialPositivo } = require("./editorial-obras.service");

const ESTADOS_OBRA_PARA_TIRAJE = new Set([
  "CONTRATADA", "EDICION", "DISENO", "IMPRESION", "PUBLICADA",
]);
const ESTADOS_OBRA_PARA_CONFIRMAR = new Set(["IMPRESION", "PUBLICADA"]);

async function cargarTirajeEditorial(db, tirajeId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(tirajeId, "tiraje_editorial_id");
  const cabecera = await db.query(
    `SELECT t.*, o.estado AS obra_estado,
            p.activo AS producto_activo, p.stock AS stock_actual,
            p.stock_reservado AS stock_reservado_actual,
            p.stock_disponible AS stock_disponible_actual,
            p.costo AS costo_producto_actual,
            uc.nombre AS creado_por, uf.nombre AS confirmado_por,
            ux.nombre AS cancelado_por
     FROM tirajes_editoriales t
     JOIN obras_editoriales o ON o.id=t.obra_editorial_id
     JOIN productos p ON p.id=t.producto_id
     JOIN usuarios uc ON uc.id=t.creado_por_usuario_id
     LEFT JOIN usuarios uf ON uf.id=t.confirmado_por_usuario_id
     LEFT JOIN usuarios ux ON ux.id=t.cancelado_por_usuario_id
     WHERE t.id=$1
     ${bloquear ? "FOR UPDATE OF t" : ""}`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Tiraje editorial no encontrado.");
  const costos = await db.query(
    `SELECT c.*, u.nombre AS creado_por
     FROM tiraje_editorial_costos c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     WHERE c.tiraje_editorial_id=$1 ORDER BY c.id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT tr.*, u.nombre AS usuario
     FROM tiraje_editorial_transiciones tr
     JOIN usuarios u ON u.id=tr.usuario_id
     WHERE tr.tiraje_editorial_id=$1 ORDER BY tr.id`,
    [id]
  );
  const movimientos = await db.query(
    `SELECT * FROM inventario_movimientos
     WHERE tiraje_editorial_id=$1 ORDER BY id`,
    [id]
  );
  const costoCapturado = costos.rows.reduce((sum, row) => sum + Number(row.monto), 0);
  return {
    ...cabecera.rows[0],
    costo_capturado: round2(costoCapturado),
    costo_unitario_estimado: cabecera.rows[0].cantidad > 0
      ? round2(costoCapturado / Number(cabecera.rows[0].cantidad))
      : 0,
    costos: costos.rows,
    transiciones: transiciones.rows,
    movimientos_inventario: movimientos.rows,
  };
}

async function listarTirajesEditoriales(db, {
  estado = null,
  obraId = null,
  productoId = null,
  q = "",
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT t.*, COALESCE(SUM(c.monto),0)::numeric(14,2) AS costo_capturado,
            COUNT(c.id)::int AS conceptos_costo
     FROM tirajes_editoriales t
     LEFT JOIN tiraje_editorial_costos c ON c.tiraje_editorial_id=t.id
     WHERE ($1::text IS NULL OR t.estado=$1)
       AND ($2::bigint IS NULL OR t.obra_editorial_id=$2)
       AND ($3::int IS NULL OR t.producto_id=$3)
       AND (
         $4::text=''
         OR t.folio ILIKE '%'||$4||'%'
         OR t.obra_folio ILIKE '%'||$4||'%'
         OR t.obra_titulo ILIKE '%'||$4||'%'
         OR t.producto_sku ILIKE '%'||$4||'%'
         OR t.producto_titulo ILIKE '%'||$4||'%'
         OR COALESCE(t.producto_isbn, '') ILIKE '%'||$4||'%'
       )
     GROUP BY t.id
     ORDER BY t.fecha_programada DESC, t.id DESC
     LIMIT $5 OFFSET $6`,
    [estado, obraId, productoId, q, limit, offset]
  );
  return { tirajes: result.rows, page, limit };
}

async function datosProveedorCosto(client, proveedorId) {
  if (proveedorId == null) return { id: null, nombre: null };
  const id = idEditorialPositivo(proveedorId, "proveedor_id");
  const result = await client.query(
    `SELECT id, nombre, activo FROM proveedores WHERE id=$1 FOR KEY SHARE`,
    [id]
  );
  const proveedor = result.rows[0];
  if (!proveedor) throw new ApiError(404, "Proveedor no encontrado.");
  if (!proveedor.activo) throw new ApiError(409, "El proveedor está inactivo.");
  return { id: proveedor.id, nombre: proveedor.nombre };
}

async function insertarCosto(client, {
  tirajeId,
  tipo,
  concepto,
  proveedorId = null,
  referencia = null,
  monto,
  usuarioId,
}) {
  const proveedor = await datosProveedorCosto(client, proveedorId);
  const result = await client.query(
    `INSERT INTO tiraje_editorial_costos
       (tiraje_editorial_id, tipo, concepto, proveedor_id,
        proveedor_nombre, referencia, monto, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      tirajeId, tipo, concepto, proveedor.id,
      proveedor.nombre, referencia, monto, usuarioId,
    ]
  );
  return result.rows[0].id;
}

async function crearTirajeEditorial(client, {
  obraId,
  productoId,
  cantidad,
  fechaProgramada,
  moneda = "MXN",
  notas = null,
  costos,
  usuarioId,
  origenClave,
}) {
  const obra = (await client.query(
    `SELECT id, folio, titulo, estado
     FROM obras_editoriales WHERE id=$1 FOR UPDATE`,
    [idEditorialPositivo(obraId, "obra_editorial_id")]
  )).rows[0];
  if (!obra) throw new ApiError(404, "Obra editorial no encontrada.");
  if (!ESTADOS_OBRA_PARA_TIRAJE.has(obra.estado)) {
    throw new ApiError(409, "La obra aún no está en una etapa que admita tirajes.");
  }
  const [producto] = await bloquearProductos(client, [productoId]);
  if (Number(producto.obra_editorial_id) !== Number(obra.id)) {
    throw new ApiError(409, "El producto no es una edición vinculada a la obra.");
  }
  if (!producto.activo) throw new ApiError(409, "La edición de producto está inactiva.");

  const cabecera = await client.query(
    `INSERT INTO tirajes_editoriales
       (obra_editorial_id, producto_id, obra_folio, obra_titulo,
        producto_sku, producto_titulo, producto_isbn, cantidad,
        fecha_programada, moneda, notas, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [
      obra.id, producto.id, obra.folio, obra.titulo,
      producto.sku, producto.titulo, producto.isbn, cantidad,
      fechaProgramada, moneda, notas, usuarioId,
    ]
  );
  const tirajeId = cabecera.rows[0].id;
  for (const costo of costos) {
    await insertarCosto(client, {
      tirajeId,
      tipo: costo.tipo,
      concepto: costo.concepto,
      proveedorId: costo.proveedor_id ?? null,
      referencia: costo.referencia ?? null,
      monto: costo.monto,
      usuarioId,
    });
  }
  await client.query(
    `INSERT INTO tiraje_editorial_transiciones
       (tiraje_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'BORRADOR',$2,$3,$4)`,
    [tirajeId, usuarioId, "Tiraje editorial creado.", origenClave]
  );
  return cargarTirajeEditorial(client, tirajeId);
}

async function actualizarTirajeEditorial(client, tirajeId, cambios) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un tiraje en borrador admite cambios.");
  }
  const columnas = {
    cantidad: "cantidad",
    fecha_programada: "fecha_programada",
    moneda: "moneda",
    notas: "notas",
  };
  const sets = [];
  const values = [];
  for (const [field, value] of Object.entries(cambios)) {
    if (!columnas[field]) continue;
    values.push(value);
    sets.push(`${columnas[field]}=$${values.length}`);
  }
  if (sets.length === 0) throw new ApiError(400, "Nada que actualizar.");
  values.push(tiraje.id);
  await client.query(
    `UPDATE tirajes_editoriales SET ${sets.join(", ")}
     WHERE id=$${values.length}`,
    values
  );
  return cargarTirajeEditorial(client, tiraje.id);
}

async function agregarCostoTiraje(client, {
  tirajeId,
  costo,
  usuarioId,
}) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un tiraje en borrador admite costos.");
  }
  await insertarCosto(client, {
    tirajeId: tiraje.id,
    tipo: costo.tipo,
    concepto: costo.concepto,
    proveedorId: costo.proveedor_id ?? null,
    referencia: costo.referencia ?? null,
    monto: costo.monto,
    usuarioId,
  });
  return cargarTirajeEditorial(client, tiraje.id);
}

async function actualizarCostoTiraje(client, {
  tirajeId,
  costoId,
  cambios,
}) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un tiraje en borrador admite costos.");
  }
  const id = idEditorialPositivo(costoId, "costo_tiraje_id");
  const costo = await client.query(
    `SELECT * FROM tiraje_editorial_costos
     WHERE id=$1 AND tiraje_editorial_id=$2 FOR UPDATE`,
    [id, tiraje.id]
  );
  if (!costo.rows[0]) throw new ApiError(404, "Costo de tiraje no encontrado.");

  let proveedor = null;
  if (Object.hasOwn(cambios, "proveedor_id")) {
    proveedor = await datosProveedorCosto(client, cambios.proveedor_id);
  }
  const columnas = {
    tipo: "tipo",
    concepto: "concepto",
    referencia: "referencia",
    monto: "monto",
  };
  const sets = [];
  const values = [];
  for (const [field, value] of Object.entries(cambios)) {
    if (!columnas[field]) continue;
    values.push(value);
    sets.push(`${columnas[field]}=$${values.length}`);
  }
  if (proveedor) {
    values.push(proveedor.id);
    sets.push(`proveedor_id=$${values.length}`);
    values.push(proveedor.nombre);
    sets.push(`proveedor_nombre=$${values.length}`);
  }
  if (sets.length === 0) throw new ApiError(400, "Nada que actualizar.");
  values.push(id, tiraje.id);
  await client.query(
    `UPDATE tiraje_editorial_costos SET ${sets.join(", ")}
     WHERE id=$${values.length - 1} AND tiraje_editorial_id=$${values.length}`,
    values
  );
  return cargarTirajeEditorial(client, tiraje.id);
}

async function eliminarCostoTiraje(client, { tirajeId, costoId }) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un tiraje en borrador admite costos.");
  }
  const result = await client.query(
    `DELETE FROM tiraje_editorial_costos
     WHERE id=$1 AND tiraje_editorial_id=$2 RETURNING id`,
    [idEditorialPositivo(costoId, "costo_tiraje_id"), tiraje.id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Costo de tiraje no encontrado.");
  return cargarTirajeEditorial(client, tiraje.id);
}

async function confirmarTirajeEditorial(client, {
  tirajeId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, tiraje.estado === "CONFIRMADO"
      ? "El tiraje ya fue confirmado."
      : "El tiraje está cancelado.");
  }
  const obra = (await client.query(
    `SELECT id, estado FROM obras_editoriales WHERE id=$1 FOR KEY SHARE`,
    [tiraje.obra_editorial_id]
  )).rows[0];
  if (!obra || !ESTADOS_OBRA_PARA_CONFIRMAR.has(obra.estado)) {
    throw new ApiError(409, "La obra debe estar en impresión o publicada para confirmar el tiraje.");
  }
  const [producto] = await bloquearProductos(client, [tiraje.producto_id]);
  if (!producto.activo) throw new ApiError(409, "La edición de producto está inactiva.");
  if (Number(producto.obra_editorial_id) !== Number(tiraje.obra_editorial_id)) {
    throw new ApiError(409, "La edición ya no pertenece a la obra del tiraje.");
  }
  const costo = await client.query(
    `SELECT COALESCE(ROUND(SUM(monto),2),0)::numeric(14,2) AS total,
            COUNT(*)::int AS conceptos
     FROM tiraje_editorial_costos WHERE tiraje_editorial_id=$1`,
    [tiraje.id]
  );
  const costoTotal = Number(costo.rows[0].total);
  if (costo.rows[0].conceptos === 0 || costoTotal <= 0) {
    throw new ApiError(409, "Registra al menos un costo de producción antes de confirmar.");
  }
  const costoUnitario = round2(costoTotal / Number(tiraje.cantidad));
  const stockAnterior = Number(producto.stock);
  const costoAnterior = Number(producto.costo);

  await client.query(
    `INSERT INTO tiraje_editorial_transiciones
       (tiraje_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','CONFIRMADO',$2,$3,$4)`,
    [tiraje.id, usuarioId, motivo, origenClave]
  );
  const aplicado = await aplicarMovimiento(client, {
    producto,
    deltaFisico: Number(tiraje.cantidad),
    tipo: "TIRAJE_EDITORIAL",
    usuarioId,
    motivo: `Tiraje ${tiraje.folio}: ${motivo}`.slice(0, 240),
    origenClave: `TIRAJE:${tiraje.id}:INVENTARIO`,
    tirajeEditorialId: tiraje.id,
  });
  await client.query(
    `UPDATE productos SET costo=$2, actualizado_en=NOW() WHERE id=$1`,
    [producto.id, costoUnitario]
  );
  await client.query(
    `UPDATE tirajes_editoriales
     SET estado='CONFIRMADO', costo_total_confirmado=$2,
         costo_unitario_confirmado=$3, costo_producto_anterior=$4,
         costo_producto_nuevo=$3, stock_anterior=$5, stock_resultante=$6,
         confirmado_por_usuario_id=$7, confirmado_en=NOW()
     WHERE id=$1`,
    [
      tiraje.id, costoTotal, costoUnitario, costoAnterior,
      stockAnterior, Number(aplicado.producto.stock), usuarioId,
    ]
  );
  return cargarTirajeEditorial(client, tiraje.id);
}

async function cancelarTirajeEditorial(client, {
  tirajeId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const tiraje = await cargarTirajeEditorial(client, tirajeId, { bloquear: true });
  if (tiraje.estado !== "BORRADOR") {
    throw new ApiError(409, tiraje.estado === "CONFIRMADO"
      ? "Un tiraje confirmado no puede cancelarse."
      : "El tiraje ya está cancelado.");
  }
  await client.query(
    `INSERT INTO tiraje_editorial_transiciones
       (tiraje_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,'BORRADOR','CANCELADO',$2,$3,$4)`,
    [tiraje.id, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE tirajes_editoriales
     SET estado='CANCELADO', cancelado_por_usuario_id=$2,
         cancelado_en=NOW(), cancelacion_motivo=$3
     WHERE id=$1`,
    [tiraje.id, usuarioId, motivo]
  );
  return cargarTirajeEditorial(client, tiraje.id);
}

module.exports = {
  cargarTirajeEditorial,
  listarTirajesEditoriales,
  crearTirajeEditorial,
  actualizarTirajeEditorial,
  agregarCostoTiraje,
  actualizarCostoTiraje,
  eliminarCostoTiraje,
  confirmarTirajeEditorial,
  cancelarTirajeEditorial,
};
