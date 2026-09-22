const { ApiError } = require("../utils/errors");

const SEGMENTOS_PRECIO = new Set(["PUBLICO", "MAYOREO"]);

function idClientePositivo(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "cliente_id inválido.");
  }
  return id;
}

async function cargarClienteActivo(client, clienteId, { exigirTelefono = false } = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("cargarClienteActivo requiere un cliente PostgreSQL con query().");
  }
  const id = idClientePositivo(clienteId);
  const result = await client.query(
    `SELECT * FROM clientes WHERE id=$1 FOR KEY SHARE`,
    [id]
  );
  const cliente = result.rows[0];
  if (!cliente) throw new ApiError(404, "Cliente no encontrado.");
  if (!cliente.activo) throw new ApiError(409, "El cliente está inactivo.");
  if (!SEGMENTOS_PRECIO.has(cliente.segmento_precio)) {
    throw new ApiError(409, "El cliente no tiene un segmento de precio válido.");
  }
  if (exigirTelefono && !String(cliente.telefono || "").trim()) {
    throw new ApiError(409, "El cliente requiere un teléfono para generar la cotización.");
  }
  return cliente;
}

module.exports = { SEGMENTOS_PRECIO, idClientePositivo, cargarClienteActivo };
