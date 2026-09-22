const { ApiError } = require("../utils/errors");
const { idEditorialPositivo } = require("./editorial-obras.service");

const ESTADOS_CONTRATO = new Set(["BORRADOR", "VIGENTE", "SUSPENDIDO", "TERMINADO"]);
const TRANSICIONES_CONTRATO = new Map([
  ["BORRADOR", new Set(["VIGENTE", "TERMINADO"])],
  ["VIGENTE", new Set(["SUSPENDIDO", "TERMINADO"])],
  ["SUSPENDIDO", new Set(["VIGENTE", "TERMINADO"])],
  ["TERMINADO", new Set()],
]);

async function cargarContratoEditorial(db, contratoId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(contratoId, "contrato_editorial_id");
  const result = await db.query(
    `SELECT c.*, o.titulo AS obra_titulo_actual, o.estado AS obra_estado,
            ce.nombre_legal AS colaborador_nombre_actual,
            ce.nombre_publico AS colaborador_nombre_publico,
            ce.activo AS colaborador_activo,
            u.nombre AS creado_por
     FROM contratos_editoriales c
     JOIN obras_editoriales o ON o.id=c.obra_editorial_id
     JOIN colaboradores_editoriales ce ON ce.id=c.colaborador_editorial_id
     JOIN usuarios u ON u.id=c.creado_por_usuario_id
     WHERE c.id=$1
     ${bloquear ? "FOR UPDATE OF c" : ""}`,
    [id]
  );
  const contrato = result.rows[0];
  if (!contrato) throw new ApiError(404, "Contrato editorial no encontrado.");
  const transiciones = await db.query(
    `SELECT t.*, u.nombre AS usuario
     FROM contrato_editorial_transiciones t
     JOIN usuarios u ON u.id=t.usuario_id
     WHERE t.contrato_editorial_id=$1 ORDER BY t.id`,
    [id]
  );
  return { ...contrato, transiciones: transiciones.rows };
}

async function listarContratosEditoriales(db, {
  estado = null,
  obraId = null,
  colaboradorId = null,
  q = "",
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT c.*, o.estado AS obra_estado,
            ce.nombre_legal AS colaborador_nombre_actual
     FROM contratos_editoriales c
     JOIN obras_editoriales o ON o.id=c.obra_editorial_id
     JOIN colaboradores_editoriales ce ON ce.id=c.colaborador_editorial_id
     WHERE ($1::text IS NULL OR c.estado=$1)
       AND ($2::bigint IS NULL OR c.obra_editorial_id=$2)
       AND ($3::bigint IS NULL OR c.colaborador_editorial_id=$3)
       AND (
         $4::text=''
         OR c.folio ILIKE '%'||$4||'%'
         OR c.obra_folio ILIKE '%'||$4||'%'
         OR c.obra_titulo ILIKE '%'||$4||'%'
         OR c.colaborador_nombre ILIKE '%'||$4||'%'
         OR c.derechos ILIKE '%'||$4||'%'
       )
     ORDER BY c.actualizado_en DESC, c.id DESC
     LIMIT $5 OFFSET $6`,
    [estado, obraId, colaboradorId, q, limit, offset]
  );
  return { contratos: result.rows, page, limit };
}

async function crearContratoEditorial(client, {
  obraId,
  colaboradorId,
  tipo,
  derechos,
  territorio = "México",
  idiomaDerechos = "Todos",
  exclusividad = false,
  vigenteDesde,
  vigenteHasta = null,
  baseRegalia = "VENTA_NETA",
  porcentajeRegalia,
  anticipo = 0,
  moneda = "MXN",
  periodicidadLiquidacion = "SEMESTRAL",
  notas = null,
  usuarioId,
  origenClave,
}) {
  const obra = (await client.query(
    `SELECT id, folio, titulo, estado
     FROM obras_editoriales WHERE id=$1 FOR UPDATE`,
    [idEditorialPositivo(obraId, "obra_editorial_id")]
  )).rows[0];
  if (!obra) throw new ApiError(404, "Obra editorial no encontrada.");
  if (obra.estado === "ARCHIVADA") {
    throw new ApiError(409, "No se pueden crear contratos para una obra archivada.");
  }
  const colaborador = (await client.query(
    `SELECT id, nombre_legal, activo
     FROM colaboradores_editoriales WHERE id=$1 FOR KEY SHARE`,
    [idEditorialPositivo(colaboradorId, "colaborador_editorial_id")]
  )).rows[0];
  if (!colaborador) throw new ApiError(404, "Colaborador editorial no encontrado.");
  if (!colaborador.activo) throw new ApiError(409, "El colaborador editorial está inactivo.");
  const vinculo = await client.query(
    `SELECT 1 FROM obra_editorial_colaboradores
     WHERE obra_editorial_id=$1 AND colaborador_editorial_id=$2
     LIMIT 1`,
    [obra.id, colaborador.id]
  );
  if (!vinculo.rows[0]) {
    throw new ApiError(409, "El colaborador debe pertenecer al equipo de la obra.");
  }

  const result = await client.query(
    `INSERT INTO contratos_editoriales
       (obra_editorial_id, colaborador_editorial_id,
        obra_folio, obra_titulo, colaborador_nombre,
        tipo, derechos, territorio, idioma_derechos, exclusividad,
        vigente_desde, vigente_hasta, base_regalia, porcentaje_regalia,
        anticipo, moneda, periodicidad_liquidacion, notas,
        creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      obra.id, colaborador.id, obra.folio, obra.titulo, colaborador.nombre_legal,
      tipo, derechos, territorio, idiomaDerechos, exclusividad,
      vigenteDesde, vigenteHasta, baseRegalia, porcentajeRegalia,
      anticipo, moneda, periodicidadLiquidacion, notas, usuarioId,
    ]
  );
  const contratoId = result.rows[0].id;
  await client.query(
    `INSERT INTO contrato_editorial_transiciones
       (contrato_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'BORRADOR',$2,$3,$4)`,
    [contratoId, usuarioId, "Contrato editorial creado.", origenClave]
  );
  return cargarContratoEditorial(client, contratoId);
}

async function actualizarContratoEditorial(client, contratoId, cambios) {
  const contrato = await cargarContratoEditorial(client, contratoId, { bloquear: true });
  if (contrato.estado !== "BORRADOR") {
    throw new ApiError(409, "Sólo un contrato en borrador admite cambios de términos.");
  }
  const columnas = {
    tipo: "tipo",
    derechos: "derechos",
    territorio: "territorio",
    idioma_derechos: "idioma_derechos",
    exclusividad: "exclusividad",
    vigente_desde: "vigente_desde",
    vigente_hasta: "vigente_hasta",
    base_regalia: "base_regalia",
    porcentaje_regalia: "porcentaje_regalia",
    anticipo: "anticipo",
    moneda: "moneda",
    periodicidad_liquidacion: "periodicidad_liquidacion",
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
  values.push(contrato.id);
  await client.query(
    `UPDATE contratos_editoriales SET ${sets.join(", ")}
     WHERE id=$${values.length}`,
    values
  );
  return cargarContratoEditorial(client, contrato.id);
}

async function transicionarContratoEditorial(client, {
  contratoId,
  estadoNuevo,
  usuarioId,
  motivo,
  origenClave,
}) {
  if (!ESTADOS_CONTRATO.has(estadoNuevo)) throw new ApiError(400, "Estado de contrato inválido.");
  const contrato = await cargarContratoEditorial(client, contratoId, { bloquear: true });
  if (!TRANSICIONES_CONTRATO.get(contrato.estado)?.has(estadoNuevo)) {
    throw new ApiError(
      409,
      `No se permite pasar el contrato de ${contrato.estado} a ${estadoNuevo}.`
    );
  }
  if (estadoNuevo === "VIGENTE") {
    if (contrato.obra_estado === "ARCHIVADA") {
      throw new ApiError(409, "No se puede activar un contrato de una obra archivada.");
    }
    if (!contrato.colaborador_activo) {
      throw new ApiError(409, "No se puede activar el contrato de un colaborador inactivo.");
    }
    if (contrato.vigente_hasta && new Date(contrato.vigente_hasta) < new Date()) {
      throw new ApiError(409, "La vigencia del contrato ya terminó.");
    }
  }
  await client.query(
    `INSERT INTO contrato_editorial_transiciones
       (contrato_editorial_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [contrato.id, contrato.estado, estadoNuevo, usuarioId, motivo, origenClave]
  );
  await client.query(
    `UPDATE contratos_editoriales SET estado=$2 WHERE id=$1`,
    [contrato.id, estadoNuevo]
  );
  return cargarContratoEditorial(client, contrato.id);
}

module.exports = {
  ESTADOS_CONTRATO,
  cargarContratoEditorial,
  listarContratosEditoriales,
  crearContratoEditorial,
  actualizarContratoEditorial,
  transicionarContratoEditorial,
};
