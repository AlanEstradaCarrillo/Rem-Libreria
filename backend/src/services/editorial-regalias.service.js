const { ApiError, round2 } = require("../utils/errors");
const { idEditorialPositivo } = require("./editorial-obras.service");

const TRANSICIONES_LIQUIDACION = new Map([
  ["BORRADOR", new Set(["EMITIDA", "CANCELADA"])],
  ["EMITIDA", new Set(["PAGADA", "CANCELADA"])],
  ["PAGADA", new Set()],
  ["CANCELADA", new Set()],
]);

async function cargarLiquidacionRegalia(db, liquidacionId, { bloquear = false } = {}) {
  const id = idEditorialPositivo(liquidacionId, "liquidacion_regalia_id");
  const cabecera = await db.query(
    `SELECT l.*, c.estado AS contrato_estado,
            o.titulo AS obra_titulo_actual,
            ce.nombre_legal AS colaborador_nombre_actual,
            uc.nombre AS creado_por, ue.nombre AS emitido_por,
            up.nombre AS pagado_por, ux.nombre AS cancelado_por
     FROM liquidaciones_regalias l
     JOIN contratos_editoriales c ON c.id=l.contrato_editorial_id
     JOIN obras_editoriales o ON o.id=l.obra_editorial_id
     JOIN colaboradores_editoriales ce ON ce.id=l.colaborador_editorial_id
     JOIN usuarios uc ON uc.id=l.creado_por_usuario_id
     LEFT JOIN usuarios ue ON ue.id=l.emitido_por_usuario_id
     LEFT JOIN usuarios up ON up.id=l.pagado_por_usuario_id
     LEFT JOIN usuarios ux ON ux.id=l.cancelado_por_usuario_id
     WHERE l.id=$1
     ${bloquear ? "FOR UPDATE OF l" : ""}`,
    [id]
  );
  if (!cabecera.rows[0]) throw new ApiError(404, "Liquidación de regalías no encontrada.");
  const detalle = await db.query(
    `SELECT * FROM detalle_liquidaciones_regalias
     WHERE liquidacion_regalia_id=$1 ORDER BY fecha_evento, id`,
    [id]
  );
  const transiciones = await db.query(
    `SELECT t.*, u.nombre AS usuario
     FROM liquidacion_regalia_transiciones t
     JOIN usuarios u ON u.id=t.usuario_id
     WHERE t.liquidacion_regalia_id=$1 ORDER BY t.id`,
    [id]
  );
  return {
    ...cabecera.rows[0],
    detalle: detalle.rows,
    transiciones: transiciones.rows,
  };
}

async function listarLiquidacionesRegalias(db, {
  estado = null,
  contratoId = null,
  obraId = null,
  colaboradorId = null,
  q = "",
  page = 1,
  limit = 30,
}) {
  const offset = (page - 1) * limit;
  const result = await db.query(
    `SELECT l.*
     FROM liquidaciones_regalias l
     WHERE ($1::text IS NULL OR l.estado=$1)
       AND ($2::bigint IS NULL OR l.contrato_editorial_id=$2)
       AND ($3::bigint IS NULL OR l.obra_editorial_id=$3)
       AND ($4::bigint IS NULL OR l.colaborador_editorial_id=$4)
       AND (
         $5::text=''
         OR l.folio ILIKE '%'||$5||'%'
         OR l.contrato_folio ILIKE '%'||$5||'%'
         OR l.obra_folio ILIKE '%'||$5||'%'
         OR l.obra_titulo ILIKE '%'||$5||'%'
         OR l.colaborador_nombre ILIKE '%'||$5||'%'
       )
     ORDER BY l.periodo_hasta DESC, l.periodo_desde DESC, l.version DESC, l.id DESC
     LIMIT $6 OFFSET $7`,
    [estado, contratoId, obraId, colaboradorId, q, limit, offset]
  );
  return { liquidaciones: result.rows, page, limit };
}

async function obtenerEstadoCuentaRegalias(db, { colaboradorId = null } = {}) {
  const id = colaboradorId == null
    ? null
    : idEditorialPositivo(colaboradorId, "colaborador_editorial_id");
  const result = await db.query(
    `SELECT c.id AS contrato_editorial_id, c.folio AS contrato_folio,
            c.estado AS contrato_estado, c.obra_editorial_id,
            c.obra_titulo, c.colaborador_editorial_id, c.colaborador_nombre,
            c.moneda, c.anticipo,
            COUNT(l.id) FILTER (WHERE l.estado <> 'CANCELADA')::int AS liquidaciones,
            COALESCE(SUM(l.regalia_bruta) FILTER (WHERE l.estado <> 'CANCELADA'),0)::numeric(14,2)
              AS regalia_bruta_acumulada,
            COALESCE(SUM(l.anticipo_aplicado) FILTER (WHERE l.estado <> 'CANCELADA'),0)::numeric(14,2)
              AS anticipo_aplicado,
            COALESCE(SUM(l.importe_pagable) FILTER (WHERE l.estado='PAGADA'),0)::numeric(14,2)
              AS importe_pagado,
            COALESCE(SUM(l.importe_pagable) FILTER (WHERE l.estado IN ('BORRADOR','EMITIDA')),0)::numeric(14,2)
              AS importe_pendiente,
            COALESCE(ult.anticipo_pendiente_despues, c.anticipo)::numeric(14,2)
              AS anticipo_pendiente,
            COALESCE(ult.saldo_editorial_nuevo,0)::numeric(14,2)
              AS saldo_a_favor_editorial,
            ult.periodo_hasta AS ultimo_periodo_hasta
     FROM contratos_editoriales c
     LEFT JOIN liquidaciones_regalias l ON l.contrato_editorial_id=c.id
     LEFT JOIN LATERAL (
       SELECT lx.anticipo_pendiente_despues, lx.saldo_editorial_nuevo,
              lx.periodo_hasta
       FROM liquidaciones_regalias lx
       WHERE lx.contrato_editorial_id=c.id AND lx.estado <> 'CANCELADA'
       ORDER BY lx.periodo_hasta DESC, lx.version DESC, lx.id DESC
       LIMIT 1
     ) ult ON TRUE
     WHERE ($1::bigint IS NULL OR c.colaborador_editorial_id=$1)
     GROUP BY c.id, ult.anticipo_pendiente_despues,
              ult.saldo_editorial_nuevo, ult.periodo_hasta
     ORDER BY c.colaborador_nombre, c.obra_titulo, c.id`,
    [id]
  );
  return { estados_cuenta: result.rows };
}

async function validarZonaHoraria(db, zonaHoraria) {
  const result = await db.query(
    `SELECT EXISTS(
       SELECT 1 FROM pg_timezone_names WHERE name=$1
     )::boolean AS valida`,
    [zonaHoraria]
  );
  if (!result.rows[0].valida) throw new ApiError(400, "Zona horaria inválida.");
}

async function obtenerEventosRegalia(client, {
  obraId,
  periodoDesde,
  periodoHasta,
  zonaHoraria,
}) {
  const result = await client.query(
    `SELECT e.tipo_evento, e.evento_clave, e.movimiento_id,
            e.fecha_evento, e.venta_id, e.detalle_venta_id,
            e.devolucion_id, e.detalle_devolucion_id,
            e.consignacion_operacion_id,
            e.detalle_consignacion_operacion_id,
            e.producto_id, e.producto_sku, e.producto_titulo,
            e.canal, e.signo, e.cantidad, e.precio_lista,
            e.descuento_unitario, e.precio_unitario,
            e.iva_porcentaje, e.importe
     FROM lineas_comerciales e
     JOIN LATERAL (
       SELECT h.obra_nueva_id
       FROM producto_obra_editorial_historial h
       WHERE h.producto_id=e.producto_id
         AND h.creado_en <= e.fecha_evento
       ORDER BY h.creado_en DESC, h.id DESC
       LIMIT 1
     ) vinculo ON vinculo.obra_nueva_id=$4
     WHERE e.fecha_evento >= ($1::date::timestamp AT TIME ZONE $3)
       AND e.fecha_evento < ($2::date::timestamp AT TIME ZONE $3)
     ORDER BY e.fecha_evento, e.evento_clave`,
    [periodoDesde, periodoHasta, zonaHoraria, obraId]
  );
  return result.rows;
}

function calcularDetalle(eventos, contrato) {
  const porcentaje = Number(contrato.porcentaje_regalia);
  return eventos.map((evento) => {
    const signo = Number(evento.signo);
    const cantidad = Number(evento.cantidad);
    const iva = Number(evento.iva_porcentaje);
    const factorIva = 1 + iva / 100;
    const importeConIva = round2(signo * Number(evento.importe));
    const baseVentaNeta = round2(signo * (Number(evento.importe) / factorIva));
    const basePrecioLista = round2(
      signo * (Number(evento.precio_lista) * cantidad / factorIva)
    );
    const baseRegalia = contrato.base_regalia === "PRECIO_LISTA"
      ? basePrecioLista
      : baseVentaNeta;
    return {
      ...evento,
      cantidad_neta: signo * cantidad,
      importe_con_iva: importeConIva,
      base_venta_neta: baseVentaNeta,
      base_precio_lista: basePrecioLista,
      base_regalia: baseRegalia,
      porcentaje_regalia: porcentaje,
      importe_regalia: round2(baseRegalia * porcentaje / 100),
    };
  });
}

async function generarLiquidacionRegalia(client, {
  contratoId,
  periodoDesde,
  periodoHasta,
  zonaHoraria,
  notas = null,
  usuarioId,
  origenClave,
}) {
  const contrato = (await client.query(
    `SELECT c.*, o.estado AS obra_estado, ce.activo AS colaborador_activo
     FROM contratos_editoriales c
     JOIN obras_editoriales o ON o.id=c.obra_editorial_id
     JOIN colaboradores_editoriales ce ON ce.id=c.colaborador_editorial_id
     WHERE c.id=$1 FOR UPDATE OF c`,
    [idEditorialPositivo(contratoId, "contrato_editorial_id")]
  )).rows[0];
  if (!contrato) throw new ApiError(404, "Contrato editorial no encontrado.");
  if (contrato.estado === "BORRADOR") {
    throw new ApiError(409, "Un contrato en borrador no admite liquidaciones.");
  }
  await validarZonaHoraria(client, zonaHoraria);
  const vigencia = await client.query(
    `SELECT (
       $1::date >= $3::date
       AND ($4::date IS NULL OR $2::date <= $4::date + 1)
     )::boolean AS valida`,
    [periodoDesde, periodoHasta, contrato.vigente_desde, contrato.vigente_hasta]
  );
  if (!vigencia.rows[0].valida) {
    throw new ApiError(409, "El periodo debe quedar dentro de la vigencia contractual.");
  }

  const superpuesta = await client.query(
    `SELECT id, folio FROM liquidaciones_regalias
     WHERE contrato_editorial_id=$1 AND estado <> 'CANCELADA'
       AND daterange(periodo_desde, periodo_hasta, '[)')
           && daterange($2::date, $3::date, '[)')
     LIMIT 1`,
    [contrato.id, periodoDesde, periodoHasta]
  );
  if (superpuesta.rows[0]) {
    throw new ApiError(409, `El periodo se superpone con ${superpuesta.rows[0].folio}.`);
  }

  const previaResult = await client.query(
    `SELECT * FROM liquidaciones_regalias
     WHERE contrato_editorial_id=$1 AND estado <> 'CANCELADA'
     ORDER BY periodo_hasta DESC, version DESC, id DESC
     LIMIT 1`,
    [contrato.id]
  );
  const previa = previaResult.rows[0] || null;
  if (previa) {
    const cronologia = await client.query(
      `SELECT ($1::date >= $2::date)::boolean AS valida`,
      [periodoDesde, previa.periodo_hasta]
    );
    if (!cronologia.rows[0].valida) {
      throw new ApiError(409, "Las liquidaciones deben generarse en orden cronológico.");
    }
  }

  const versiones = await client.query(
    `SELECT id, version, estado
     FROM liquidaciones_regalias
     WHERE contrato_editorial_id=$1 AND periodo_desde=$2 AND periodo_hasta=$3
     ORDER BY version DESC, id DESC`,
    [contrato.id, periodoDesde, periodoHasta]
  );
  const ultimaVersion = versiones.rows[0] || null;
  if (ultimaVersion && ultimaVersion.estado !== "CANCELADA") {
    throw new ApiError(409, "El periodo ya cuenta con una liquidación vigente.");
  }
  const version = ultimaVersion ? Number(ultimaVersion.version) + 1 : 1;

  const eventos = await obtenerEventosRegalia(client, {
    obraId: contrato.obra_editorial_id,
    periodoDesde,
    periodoHasta,
    zonaHoraria,
  });
  const detalle = calcularDetalle(eventos, contrato);
  const unidadesNetas = detalle.reduce((sum, row) => sum + row.cantidad_neta, 0);
  const baseTotal = round2(detalle.reduce((sum, row) => sum + row.base_regalia, 0));
  const regaliaBruta = round2(detalle.reduce((sum, row) => sum + row.importe_regalia, 0));
  const saldoAnterior = round2(previa ? Number(previa.saldo_editorial_nuevo) : 0);
  const saldoAplicado = round2(Math.min(saldoAnterior, Math.max(regaliaBruta, 0)));
  const saldoNuevo = round2(
    saldoAnterior - saldoAplicado + Math.max(-regaliaBruta, 0)
  );
  const anticipoAntes = round2(
    previa ? Number(previa.anticipo_pendiente_despues) : Number(contrato.anticipo)
  );
  const regaliaTrasSaldo = round2(regaliaBruta - saldoAplicado);
  const anticipoAplicado = round2(Math.min(anticipoAntes, Math.max(regaliaTrasSaldo, 0)));
  const anticipoDespues = round2(anticipoAntes - anticipoAplicado);
  const importePagable = round2(Math.max(regaliaTrasSaldo - anticipoAplicado, 0));

  const cabecera = await client.query(
    `INSERT INTO liquidaciones_regalias
       (contrato_editorial_id, version, reemplaza_liquidacion_id,
        periodo_desde, periodo_hasta, zona_horaria,
        contrato_folio, obra_editorial_id, obra_folio, obra_titulo,
        colaborador_editorial_id, colaborador_nombre,
        base_regalia, porcentaje_regalia, moneda,
        unidades_netas, base_regalia_total, regalia_bruta,
        saldo_editorial_anterior, saldo_editorial_aplicado, saldo_editorial_nuevo,
        anticipo_pendiente_antes, anticipo_aplicado, anticipo_pendiente_despues,
        importe_pagable, notas, creado_por_usuario_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING id`,
    [
      contrato.id, version, ultimaVersion?.id || null,
      periodoDesde, periodoHasta, zonaHoraria,
      contrato.folio, contrato.obra_editorial_id, contrato.obra_folio,
      contrato.obra_titulo, contrato.colaborador_editorial_id,
      contrato.colaborador_nombre, contrato.base_regalia,
      contrato.porcentaje_regalia, contrato.moneda,
      unidadesNetas, baseTotal, regaliaBruta,
      saldoAnterior, saldoAplicado, saldoNuevo,
      anticipoAntes, anticipoAplicado, anticipoDespues,
      importePagable, notas, usuarioId,
    ]
  );
  const liquidacionId = cabecera.rows[0].id;
  for (const row of detalle) {
    await client.query(
      `INSERT INTO detalle_liquidaciones_regalias
         (liquidacion_regalia_id, evento_clave, tipo_evento,
          movimiento_id, venta_id, detalle_venta_id,
          devolucion_id, detalle_devolucion_id,
          consignacion_operacion_id, detalle_consignacion_operacion_id,
          producto_id, producto_sku, producto_titulo, fecha_evento, canal,
          cantidad_neta, precio_lista, descuento_unitario, precio_unitario,
          iva_porcentaje, importe_con_iva, base_venta_neta, base_precio_lista,
          base_regalia, porcentaje_regalia, importe_regalia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26)`,
      [
        liquidacionId, row.evento_clave, row.tipo_evento,
        row.movimiento_id, row.venta_id, row.detalle_venta_id,
        row.devolucion_id, row.detalle_devolucion_id,
        row.consignacion_operacion_id, row.detalle_consignacion_operacion_id,
        row.producto_id, row.producto_sku, row.producto_titulo,
        row.fecha_evento, row.canal,
        row.cantidad_neta, row.precio_lista, row.descuento_unitario,
        row.precio_unitario, row.iva_porcentaje, row.importe_con_iva,
        row.base_venta_neta, row.base_precio_lista, row.base_regalia,
        row.porcentaje_regalia, row.importe_regalia,
      ]
    );
  }
  await client.query(
    `INSERT INTO liquidacion_regalia_transiciones
       (liquidacion_regalia_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, origen_clave)
     VALUES ($1,NULL,'BORRADOR',$2,$3,$4)`,
    [liquidacionId, usuarioId, "Liquidación calculada.", origenClave]
  );
  return cargarLiquidacionRegalia(client, liquidacionId);
}

async function transicionarLiquidacionRegalia(client, {
  liquidacionId,
  estadoNuevo,
  usuarioId,
  motivo,
  referencia = null,
  origenClave,
}) {
  const liquidacion = await cargarLiquidacionRegalia(client, liquidacionId, { bloquear: true });
  if (!TRANSICIONES_LIQUIDACION.get(liquidacion.estado)?.has(estadoNuevo)) {
    throw new ApiError(
      409,
      `No se permite pasar la liquidación de ${liquidacion.estado} a ${estadoNuevo}.`
    );
  }
  if (estadoNuevo === "PAGADA" && !String(referencia || "").trim()) {
    throw new ApiError(400, "La referencia de pago es obligatoria.");
  }
  if (estadoNuevo === "CANCELADA") {
    const posterior = await client.query(
      `SELECT folio FROM liquidaciones_regalias
       WHERE contrato_editorial_id=$1 AND estado <> 'CANCELADA'
         AND id<>$2 AND periodo_desde >= $3
       ORDER BY periodo_desde LIMIT 1`,
      [liquidacion.contrato_editorial_id, liquidacion.id, liquidacion.periodo_hasta]
    );
    if (posterior.rows[0]) {
      throw new ApiError(
        409,
        `Cancela primero la liquidación posterior ${posterior.rows[0].folio}.`
      );
    }
  }

  await client.query(
    `INSERT INTO liquidacion_regalia_transiciones
       (liquidacion_regalia_id, estado_anterior, estado_nuevo,
        usuario_id, motivo, referencia, origen_clave)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      liquidacion.id, liquidacion.estado, estadoNuevo, usuarioId, motivo,
      estadoNuevo === "PAGADA" ? referencia : null, origenClave,
    ]
  );
  if (estadoNuevo === "EMITIDA") {
    await client.query(
      `UPDATE liquidaciones_regalias
       SET estado='EMITIDA', emitido_por_usuario_id=$2, emitido_en=NOW()
       WHERE id=$1`,
      [liquidacion.id, usuarioId]
    );
  } else if (estadoNuevo === "PAGADA") {
    await client.query(
      `UPDATE liquidaciones_regalias
       SET estado='PAGADA', pagado_por_usuario_id=$2,
           pagado_en=NOW(), pago_referencia=$3
       WHERE id=$1`,
      [liquidacion.id, usuarioId, referencia]
    );
  } else {
    await client.query(
      `UPDATE liquidaciones_regalias
       SET estado='CANCELADA', cancelado_por_usuario_id=$2,
           cancelado_en=NOW(), cancelacion_motivo=$3
       WHERE id=$1`,
      [liquidacion.id, usuarioId, motivo]
    );
  }
  return cargarLiquidacionRegalia(client, liquidacion.id);
}

module.exports = {
  cargarLiquidacionRegalia,
  listarLiquidacionesRegalias,
  obtenerEstadoCuentaRegalias,
  generarLiquidacionRegalia,
  transicionarLiquidacionRegalia,
};
