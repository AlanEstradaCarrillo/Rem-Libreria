const crypto = require("node:crypto");
const { ApiError } = require("./errors");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hashRequest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function getIdempotencyKey(req) {
  const key = String(req.get("Idempotency-Key") || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
    throw new ApiError(400, "Encabezado Idempotency-Key requerido (8 a 100 caracteres seguros).");
  }
  return key;
}

async function lockOperationKey(client, actorClave, operacion, clave) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
    [`IDEMPOTENCIA:${actorClave}:${operacion}:${clave}`]
  );
}

async function claimPublicOperation(client, { actorClave, operacion, clave, solicitudHash }) {
  if (!/^PUBLICO:[0-9a-f]{64}$/.test(String(actorClave || ""))) {
    throw new ApiError(400, "Actor público inválido.");
  }
  await lockOperationKey(client, actorClave, operacion, clave);
  const inserted = await client.query(
    `INSERT INTO operaciones_idempotentes
       (usuario_id, actor_clave, operacion, clave, solicitud_hash)
     VALUES (NULL,$1,$2,$3,$4)
     ON CONFLICT (actor_clave, operacion, clave) DO NOTHING
     RETURNING actor_clave`,
    [actorClave, operacion, clave, solicitudHash]
  );
  if (inserted.rows[0]) return { replay: false, resourceId: null };

  const existing = await client.query(
    `SELECT solicitud_hash, recurso_id
     FROM operaciones_idempotentes
     WHERE actor_clave=$1 AND operacion=$2 AND clave=$3`,
    [actorClave, operacion, clave]
  );
  const row = existing.rows[0];
  if (!row || row.solicitud_hash !== solicitudHash) {
    throw new ApiError(409, "La clave idempotente ya fue usada con una solicitud diferente.");
  }
  if (!row.recurso_id) {
    throw new ApiError(409, "La operación idempotente todavía no tiene un resultado disponible.");
  }
  return { replay: true, resourceId: Number(row.recurso_id) };
}
async function claimOperation(client, { usuarioId = null, actorClave = null, operacion, clave, solicitudHash }) {
  if (usuarioId == null) {
    return claimPublicOperation(client, { actorClave, operacion, clave, solicitudHash });
  }
  await lockOperationKey(client, `USUARIO:${usuarioId}`, operacion, clave);
  const inserted = await client.query(
    `INSERT INTO operaciones_idempotentes (usuario_id, operacion, clave, solicitud_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (usuario_id, operacion, clave) DO NOTHING
     RETURNING usuario_id`,
    [usuarioId, operacion, clave, solicitudHash]
  );
  if (inserted.rows[0]) return { replay: false, resourceId: null };

  const existing = await client.query(
    `SELECT solicitud_hash, recurso_id
     FROM operaciones_idempotentes
     WHERE usuario_id=$1 AND operacion=$2 AND clave=$3`,
    [usuarioId, operacion, clave]
  );
  const row = existing.rows[0];
  if (!row || row.solicitud_hash !== solicitudHash) {
    throw new ApiError(409, "La clave idempotente ya fue usada con una solicitud diferente.");
  }
  if (!row.recurso_id) {
    throw new ApiError(409, "La operación idempotente todavía no tiene un resultado disponible.");
  }
  return { replay: true, resourceId: Number(row.recurso_id) };
}

async function completeOperation(client, {
  usuarioId = null, actorClave = null, operacion, clave, recursoTipo, recursoId,
}) {
  if (usuarioId == null) {
    await client.query(
      `UPDATE operaciones_idempotentes
       SET recurso_tipo=$4, recurso_id=$5, completado_en=NOW()
       WHERE actor_clave=$1 AND operacion=$2 AND clave=$3`,
      [actorClave, operacion, clave, recursoTipo, recursoId]
    );
    return;
  }
  await client.query(
    `UPDATE operaciones_idempotentes
     SET recurso_tipo=$4, recurso_id=$5, completado_en=NOW()
     WHERE usuario_id=$1 AND operacion=$2 AND clave=$3`,
    [usuarioId, operacion, clave, recursoTipo, recursoId]
  );
}

module.exports = { hashRequest, getIdempotencyKey, claimOperation, completeOperation };
