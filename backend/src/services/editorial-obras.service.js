const { ApiError } = require("../utils/errors");

const ESTADOS_OBRA = new Set([
  "PROPUESTA", "EVALUACION", "CONTRATADA", "EDICION",
  "DISENO", "IMPRESION", "PUBLICADA", "ARCHIVADA",
]);
const ROLES_COLABORADOR = new Set([
  "AUTOR", "TRADUCTOR", "ILUSTRADOR", "EDITOR", "CORRECTOR",
  "COORDINADOR", "DISENADOR",
]);
const TRANSICIONES_OBRA = new Map([
  ["PROPUESTA", new Set(["EVALUACION", "ARCHIVADA"])],
  ["EVALUACION", new Set(["PROPUESTA", "CONTRATADA", "ARCHIVADA"])],
  ["CONTRATADA", new Set(["EVALUACION", "EDICION", "ARCHIVADA"])],
  ["EDICION", new Set(["CONTRATADA", "DISENO", "ARCHIVADA"])],
  ["DISENO", new Set(["EDICION", "IMPRESION", "ARCHIVADA"])],
  ["IMPRESION", new Set(["DISENO", "PUBLICADA", "ARCHIVADA"])],
  ["PUBLICADA", new Set(["ARCHIVADA"])],
  ["ARCHIVADA", new Set()],
]);

function idEditorialPositivo(value, field = "id") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${field} inválido.`);
  }
  return id;
}

async function cargarUsuarioActivo(db, usuarioId, field = "usuario_id") {
  if (usuarioId == null) return null;
  const id = idEditorialPositivo(usuarioId, field);
  const result = await db.query(
    `SELECT u.id, u.nombre, r.nombre AS rol
     FROM usuarios u JOIN roles r ON r.id=u.rol_id
     WHERE u.id=$1 AND u.activo=TRUE`,
    [id]
  );
  if (!result.rows[0]) throw new ApiError(409, "El usuario responsable no existe o está inactivo.");
  return result.rows[0];
}

async function cargarColaboradorEditorial(db, colaboradorId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(colaboradorId, "colaborador_editorial_id");
  if (bloquear) {
    const bloqueo = await db.query(
      `SELECT id FROM colaboradores_editoriales WHERE id=$1 FOR UPDATE`,
      [id]
    );
    if (!bloqueo.rows[0]) throw new ApiError(404, "Colaborador editorial no encontrado.");
  }
  const result = await db.query(
    `SELECT c.*, u.nombre AS creado_por,
            COUNT(DISTINCT oc.obra_editorial_id)::int AS obras_vinculadas,
            COUNT(DISTINCT ce.id) FILTER (WHERE ce.estado <> 'TERMINADO')::int
              AS contratos_no_terminados
     FROM colaboradores_editoriales c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     LEFT JOIN obra_editorial_colaboradores oc ON oc.colaborador_editorial_id=c.id
     LEFT JOIN contratos_editoriales ce ON ce.colaborador_editorial_id=c.id
     WHERE c.id=$1
     GROUP BY c.id, u.nombre`,
    [id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Colaborador editorial no encontrado.");
  return result.rows[0];
}

async function listarColaboradoresEditoriales(db, {
  q = "",
  incluirInactivos = false,
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT c.*, u.nombre AS creado_por,
            COUNT(DISTINCT oc.obra_editorial_id)::int AS obras_vinculadas,
            COUNT(DISTINCT ce.id) FILTER (WHERE ce.estado <> 'TERMINADO')::int
              AS contratos_no_terminados
     FROM colaboradores_editoriales c
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     LEFT JOIN obra_editorial_colaboradores oc ON oc.colaborador_editorial_id=c.id
     LEFT JOIN contratos_editoriales ce ON ce.colaborador_editorial_id=c.id
     WHERE (c.activo OR $1::boolean)
       AND (
         $2::text=''
         OR c.nombre_legal ILIKE '%'||$2||'%'
         OR COALESCE(c.nombre_publico, '') ILIKE '%'||$2||'%'
         OR COALESCE(c.email, '') ILIKE '%'||$2||'%'
         OR COALESCE(c.identificador_fiscal, '') ILIKE '%'||$2||'%'
       )
     GROUP BY c.id, u.nombre
     ORDER BY c.nombre_legal, c.id
     LIMIT $3 OFFSET $4`,
    [incluirInactivos, q, limit, offset]
  );
  return { colaboradores: result.rows, page, limit };
}

async function crearColaboradorEditorial(client, {
  nombreLegal,
  nombrePublico = null,
  email = null,
  telefono = null,
  identificadorFiscal = null,
  notas = null,
  usuarioId,
}) {
  const result = await client.query(
    `INSERT INTO colaboradores_editoriales
       (nombre_legal, nombre_publico, email, telefono, identificador_fiscal,
        notas, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      nombreLegal, nombrePublico, email, telefono, identificadorFiscal,
      notas, usuarioId,
    ]
  );
  return cargarColaboradorEditorial(client, result.rows[0].id);
}

async function actualizarColaboradorEditorial(client, colaboradorId, cambios) {
  const actual = await cargarColaboradorEditorial(client, colaboradorId, { bloquear: true });
  if (cambios.activo === false && actual.activo) {
    const contratos = await client.query(
      `SELECT 1 FROM contratos_editoriales
       WHERE colaborador_editorial_id=$1 AND estado <> 'TERMINADO'
       LIMIT 1`,
      [actual.id]
    );
    if (contratos.rows[0]) {
      throw new ApiError(409, "No se puede desactivar a quien conserva contratos no terminados.");
    }
  }

  const columnas = {
    nombre_legal: "nombre_legal",
    nombre_publico: "nombre_publico",
    email: "email",
    telefono: "telefono",
    identificador_fiscal: "identificador_fiscal",
    notas: "notas",
    activo: "activo",
  };
  const sets = [];
  const values = [];
  for (const [field, value] of Object.entries(cambios)) {
    if (!columnas[field]) continue;
    values.push(value);
    sets.push(`${columnas[field]}=$${values.length}`);
  }
  if (sets.length === 0) throw new ApiError(400, "Nada que actualizar.");
  values.push(actual.id);
  await client.query(
    `UPDATE colaboradores_editoriales SET ${sets.join(", ")}
     WHERE id=$${values.length}`,
    values
  );
  return cargarColaboradorEditorial(client, actual.id);
}

async function cargarObraEditorial(db, obraId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(obraId, "obra_editorial_id");
  const cabeceraResult = await db.query(
    `SELECT o.*, uc.nombre AS creado_por, ue.nombre AS editor_responsable
     FROM obras_editoriales o
     JOIN usuarios uc ON uc.id=o.creado_por_usuario_id
     LEFT JOIN usuarios ue ON ue.id=o.editor_responsable_usuario_id
     WHERE o.id=$1
     ${bloquear ? "FOR UPDATE OF o" : ""}`,
    [id]
  );
  const obra = cabeceraResult.rows[0];
  if (!obra) throw new ApiError(404, "Obra editorial no encontrada.");

  // También se usa con un pg.Client transaccional. Ejecutar en secuencia evita
  // consultas simultáneas sobre la misma conexión y conserva el snapshot.
  const colaboradores = await db.query(
      `SELECT oc.*, c.nombre_legal, c.nombre_publico, c.email,
              c.activo AS colaborador_activo, u.nombre AS creado_por
       FROM obra_editorial_colaboradores oc
       JOIN colaboradores_editoriales c ON c.id=oc.colaborador_editorial_id
       JOIN usuarios u ON u.id=oc.creado_por_usuario_id
       WHERE oc.obra_editorial_id=$1
       ORDER BY oc.orden_credito, oc.id`,
      [id]
    );
  const ediciones = await db.query(
      `SELECT p.id, p.sku, p.codigo_barras, p.isbn, p.isbn_normalizado,
              p.titulo, p.subtitulo, p.edicion, p.anio_publicacion,
              p.formato, p.encuadernacion, p.precio, p.costo,
              p.stock, p.stock_reservado, p.stock_disponible,
              p.publicado_web, p.activo
       FROM productos p
       WHERE p.obra_editorial_id=$1
       ORDER BY p.anio_publicacion NULLS LAST, p.edicion NULLS LAST, p.id`,
      [id]
    );
  const transiciones = await db.query(
      `SELECT t.*, u.nombre AS usuario
       FROM obra_editorial_transiciones t
       JOIN usuarios u ON u.id=t.usuario_id
       WHERE t.obra_editorial_id=$1 ORDER BY t.id`,
      [id]
    );
  const historialEdiciones = await db.query(
      `SELECT h.*, p.sku AS producto_sku, p.titulo AS producto_titulo,
              u.nombre AS usuario
       FROM producto_obra_editorial_historial h
       JOIN productos p ON p.id=h.producto_id
       JOIN usuarios u ON u.id=h.usuario_id
       WHERE h.obra_anterior_id=$1 OR h.obra_nueva_id=$1
       ORDER BY h.id`,
      [id]
    );
  const contratos = await db.query(
      `SELECT c.id, c.folio, c.estado, c.tipo, c.colaborador_editorial_id,
              c.colaborador_nombre, c.porcentaje_regalia, c.moneda,
              c.vigente_desde, c.vigente_hasta
       FROM contratos_editoriales c
       WHERE c.obra_editorial_id=$1
       ORDER BY c.creado_en DESC, c.id DESC`,
      [id]
    );

  return {
    ...obra,
    colaboradores: colaboradores.rows,
    ediciones: ediciones.rows,
    transiciones: transiciones.rows,
    historial_ediciones: historialEdiciones.rows,
    contratos: contratos.rows,
  };
}

async function listarObrasEditoriales(db, {
  estado = null,
  q = "",
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT o.id, o.folio, o.titulo, o.subtitulo, o.idioma, o.estado,
            o.fecha_recepcion, o.fecha_objetivo_publicacion,
            o.creado_en, o.actualizado_en, ue.nombre AS editor_responsable,
            COUNT(DISTINCT oc.id)::int AS colaboradores,
            COUNT(DISTINCT p.id)::int AS ediciones,
            COUNT(DISTINCT c.id) FILTER (WHERE c.estado <> 'TERMINADO')::int
              AS contratos_no_terminados
     FROM obras_editoriales o
     LEFT JOIN usuarios ue ON ue.id=o.editor_responsable_usuario_id
     LEFT JOIN obra_editorial_colaboradores oc ON oc.obra_editorial_id=o.id
     LEFT JOIN productos p ON p.obra_editorial_id=o.id
     LEFT JOIN contratos_editoriales c ON c.obra_editorial_id=o.id
     WHERE ($1::text IS NULL OR o.estado=$1)
       AND (
         $2::text=''
         OR o.folio ILIKE '%'||$2||'%'
         OR o.titulo ILIKE '%'||$2||'%'
         OR COALESCE(o.subtitulo, '') ILIKE '%'||$2||'%'
         OR EXISTS (
           SELECT 1
           FROM obra_editorial_colaboradores ocx
           JOIN colaboradores_editoriales cx ON cx.id=ocx.colaborador_editorial_id
           WHERE ocx.obra_editorial_id=o.id
             AND (
               cx.nombre_legal ILIKE '%'||$2||'%'
               OR COALESCE(cx.nombre_publico, '') ILIKE '%'||$2||'%'
             )
         )
       )
     GROUP BY o.id, ue.nombre
     ORDER BY o.actualizado_en DESC, o.id DESC
     LIMIT $3 OFFSET $4`,
    [estado, q, limit, offset]
  );
  return { obras: result.rows, page, limit };
}

async function crearObraEditorial(client, {
  titulo,
  subtitulo = null,
  sinopsis = null,
  idioma = "Español",
  fechaRecepcion,
  fechaObjetivoPublicacion = null,
  editorResponsableUsuarioId = null,
  notas = null,
  usuarioId,
  origenClave,
}) {
  await cargarUsuarioActivo(client, editorResponsableUsuarioId, "editor_responsable_usuario_id");
  const result = await client.query(
    `INSERT INTO obras_editoriales
       (titulo, subtitulo, sinopsis, idioma, fecha_recepcion,
        fecha_objetivo_publicacion, editor_responsable_usuario_id,
        notas, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      titulo, subtitulo, sinopsis, idioma, fechaRecepcion,
      fechaObjetivoPublicacion, editorResponsableUsuarioId, notas, usuarioId,
    ]
  );
  const obraId = result.rows[0].id;
  await client.query(
    `INSERT INTO obra_editorial_transiciones
       (obra_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'PROPUESTA',$2,$3,$4)`,
    [obraId, usuarioId, "Obra editorial creada.", origenClave]
  );
  return cargarObraEditorial(client, obraId);
}

async function actualizarObraEditorial(client, obraId, cambios) {
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "Una obra archivada no admite cambios.");
  }
  if (Object.hasOwn(cambios, "editor_responsable_usuario_id")) {
    await cargarUsuarioActivo(
      client,
      cambios.editor_responsable_usuario_id,
      "editor_responsable_usuario_id"
    );
  }
  const columnas = {
    titulo: "titulo",
    subtitulo: "subtitulo",
    sinopsis: "sinopsis",
    idioma: "idioma",
    fecha_recepcion: "fecha_recepcion",
    fecha_objetivo_publicacion: "fecha_objetivo_publicacion",
    editor_responsable_usuario_id: "editor_responsable_usuario_id",
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
  values.push(obra.id);
  await client.query(
    `UPDATE obras_editoriales SET ${sets.join(", ")}
     WHERE id=$${values.length}`,
    values
  );
  return cargarObraEditorial(client, obra.id);
}

async function transicionarObraEditorial(client, {
  obraId,
  estadoNuevo,
  usuarioId,
  motivo,
  origenClave,
}) {
  if (!ESTADOS_OBRA.has(estadoNuevo)) throw new ApiError(400, "Estado editorial inválido.");
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (!TRANSICIONES_OBRA.get(obra.estado)?.has(estadoNuevo)) {
    throw new ApiError(409, `No se permite pasar de ${obra.estado} a ${estadoNuevo}.`);
  }

  if (estadoNuevo === "EVALUACION") {
    const equipo = await client.query(
      `SELECT 1 FROM obra_editorial_colaboradores
       WHERE obra_editorial_id=$1 LIMIT 1`,
      [obra.id]
    );
    if (!equipo.rows[0]) {
      throw new ApiError(409, "Asocia al menos un colaborador antes de evaluar la obra.");
    }
  }
  if (estadoNuevo === "CONTRATADA") {
    const contrato = await client.query(
      `SELECT 1 FROM contratos_editoriales
       WHERE obra_editorial_id=$1 AND estado='VIGENTE'
       LIMIT 1`,
      [obra.id]
    );
    if (!contrato.rows[0]) {
      throw new ApiError(409, "La obra requiere al menos un contrato vigente.");
    }
  }
  if (["IMPRESION", "PUBLICADA"].includes(estadoNuevo)) {
    const edicion = await client.query(
      `SELECT 1 FROM productos WHERE obra_editorial_id=$1 LIMIT 1`,
      [obra.id]
    );
    if (!edicion.rows[0]) {
      throw new ApiError(409, "La obra requiere al menos una edición de producto vinculada.");
    }
  }

  await client.query(
    `INSERT INTO obra_editorial_transiciones
       (obra_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [obra.id, obra.estado, estadoNuevo, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE obras_editoriales SET estado=$2 WHERE id=$1`,
    [obra.id, estadoNuevo]
  );
  return cargarObraEditorial(client, obra.id);
}

async function vincularColaboradorObra(client, {
  obraId,
  colaboradorId,
  rol,
  nombreCredito = null,
  ordenCredito = 0,
  creditoPublico = true,
  notas = null,
  usuarioId,
}) {
  if (!ROLES_COLABORADOR.has(rol)) throw new ApiError(400, "Rol editorial inválido.");
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "Una obra archivada no admite cambios de equipo.");
  }
  const colaborador = await cargarColaboradorEditorial(client, colaboradorId, { bloquear: true });
  if (!colaborador.activo) throw new ApiError(409, "El colaborador editorial está inactivo.");
  const result = await client.query(
    `INSERT INTO obra_editorial_colaboradores
       (obra_editorial_id, colaborador_editorial_id, rol, nombre_credito,
        orden_credito, credito_publico, notas, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      obra.id, colaborador.id, rol, nombreCredito, ordenCredito,
      creditoPublico, notas, usuarioId,
    ]
  );
  return { vinculoId: result.rows[0].id, obra: await cargarObraEditorial(client, obra.id) };
}

async function actualizarVinculoColaborador(client, { obraId, vinculoId, cambios }) {
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "Una obra archivada no admite cambios de equipo.");
  }
  const id = idEditorialPositivo(vinculoId, "vinculo_id");
  const actual = await client.query(
    `SELECT * FROM obra_editorial_colaboradores
     WHERE id=$1 AND obra_editorial_id=$2 FOR UPDATE`,
    [id, obra.id]
  );
  if (!actual.rows[0]) throw new ApiError(404, "Vínculo editorial no encontrado.");
  if (cambios.rol && !ROLES_COLABORADOR.has(cambios.rol)) {
    throw new ApiError(400, "Rol editorial inválido.");
  }
  const columnas = {
    rol: "rol",
    nombre_credito: "nombre_credito",
    orden_credito: "orden_credito",
    credito_publico: "credito_publico",
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
  values.push(id, obra.id);
  await client.query(
    `UPDATE obra_editorial_colaboradores SET ${sets.join(", ")}
     WHERE id=$${values.length - 1} AND obra_editorial_id=$${values.length}`,
    values
  );
  return cargarObraEditorial(client, obra.id);
}

async function retirarColaboradorObra(client, { obraId, vinculoId }) {
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "Una obra archivada no admite cambios de equipo.");
  }
  const id = idEditorialPositivo(vinculoId, "vinculo_id");
  const vinculo = await client.query(
    `SELECT oc.*
     FROM obra_editorial_colaboradores oc
     WHERE oc.id=$1 AND oc.obra_editorial_id=$2
     FOR UPDATE`,
    [id, obra.id]
  );
  if (!vinculo.rows[0]) throw new ApiError(404, "Vínculo editorial no encontrado.");
  const contratos = await client.query(
    `SELECT 1 FROM contratos_editoriales
     WHERE obra_editorial_id=$1 AND colaborador_editorial_id=$2
       AND estado <> 'TERMINADO'
     LIMIT 1`,
    [obra.id, vinculo.rows[0].colaborador_editorial_id]
  );
  if (contratos.rows[0]) {
    throw new ApiError(409, "El colaborador conserva un contrato no terminado con la obra.");
  }
  const result = await client.query(
    `DELETE FROM obra_editorial_colaboradores
     WHERE id=$1 AND obra_editorial_id=$2 RETURNING id`,
    [id, obra.id]
  );
  if (!result.rows[0]) throw new ApiError(404, "Vínculo editorial no encontrado.");
  return cargarObraEditorial(client, obra.id);
}

async function vincularEdicionObra(client, {
  obraId,
  productoId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "Una obra archivada no admite nuevas ediciones.");
  }
  const id = idEditorialPositivo(productoId, "producto_id");
  const productoResult = await client.query(
    `SELECT id, obra_editorial_id FROM productos WHERE id=$1 FOR UPDATE`,
    [id]
  );
  const producto = productoResult.rows[0];
  if (!producto) throw new ApiError(404, "Producto no encontrado.");
  if (producto.obra_editorial_id != null) {
    throw new ApiError(
      409,
      Number(producto.obra_editorial_id) === Number(obra.id)
        ? "El producto ya está vinculado a esta obra."
        : "El producto ya pertenece a otra obra editorial."
    );
  }
  const historial = await client.query(
    `INSERT INTO producto_obra_editorial_historial
       (producto_id, obra_anterior_id, obra_nueva_id, usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,$2,$3,$4,$5)
     RETURNING id`,
    [producto.id, obra.id, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE productos SET obra_editorial_id=$2 WHERE id=$1`,
    [producto.id, obra.id]
  );
  return { historialId: historial.rows[0].id, obra: await cargarObraEditorial(client, obra.id) };
}

async function desvincularEdicionObra(client, {
  obraId,
  productoId,
  usuarioId,
  motivo,
  origenClave,
}) {
  const obra = await cargarObraEditorial(client, obraId, { bloquear: true });
  if (["PUBLICADA", "ARCHIVADA"].includes(obra.estado)) {
    throw new ApiError(409, "No se puede retirar una edición de una obra publicada o archivada.");
  }
  const id = idEditorialPositivo(productoId, "producto_id");
  const productoResult = await client.query(
    `SELECT id, obra_editorial_id FROM productos WHERE id=$1 FOR UPDATE`,
    [id]
  );
  const producto = productoResult.rows[0];
  if (!producto) throw new ApiError(404, "Producto no encontrado.");
  if (Number(producto.obra_editorial_id) !== Number(obra.id)) {
    throw new ApiError(409, "El producto no pertenece a esta obra editorial.");
  }
  const historial = await client.query(
    `INSERT INTO producto_obra_editorial_historial
       (producto_id, obra_anterior_id, obra_nueva_id, usuario_id, motivo, origen_clave)
     VALUES ($1,$2,NULL,$3,$4,$5)
     RETURNING id`,
    [producto.id, obra.id, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE productos SET obra_editorial_id=NULL WHERE id=$1`,
    [producto.id]
  );
  return { historialId: historial.rows[0].id, obra: await cargarObraEditorial(client, obra.id) };
}

module.exports = {
  ESTADOS_OBRA,
  ROLES_COLABORADOR,
  idEditorialPositivo,
  cargarColaboradorEditorial,
  listarColaboradoresEditoriales,
  crearColaboradorEditorial,
  actualizarColaboradorEditorial,
  cargarObraEditorial,
  listarObrasEditoriales,
  crearObraEditorial,
  actualizarObraEditorial,
  transicionarObraEditorial,
  vincularColaboradorObra,
  actualizarVinculoColaborador,
  retirarColaboradorObra,
  vincularEdicionObra,
  desvincularEdicionObra,
};
