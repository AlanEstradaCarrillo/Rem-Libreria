const crypto = require("node:crypto");
const { ApiError } = require("../utils/errors");

const ROLES_CONTRIBUYENTE = new Set(["AUTOR", "TRADUCTOR", "ILUSTRADOR", "EDITOR"]);
const CAMPOS_CATALOGO_HASH = [
  "sku",
  "codigo_barras",
  "isbn",
  "isbn_normalizado",
  "titulo",
  "subtitulo",
  "autor",
  "editorial",
  "categoria_id",
  "precio",
  "costo",
  "iva",
  "descripcion_comercial",
  "edicion",
  "anio_publicacion",
  "idioma",
  "numero_paginas",
  "encuadernacion",
  "formato",
  "coleccion",
  "serie",
  "volumen",
];

function textoLimpio(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/gu, " ");
  return text || null;
}

function normalizarIsbn(value) {
  const visible = textoLimpio(value);
  if (!visible) return { isbn: null, normalizado: null };
  if (visible.length > 17) {
    throw new ApiError(400, "ISBN inválido: la representación visible admite hasta 17 caracteres.");
  }
  const normalizado = visible.replace(/[\s-]+/gu, "").toUpperCase();
  if (!/^\d{9}[\dX]$/.test(normalizado) && !/^\d{13}$/.test(normalizado)) {
    throw new ApiError(400, "ISBN inválido: debe contener 10 o 13 caracteres válidos.");
  }

  if (normalizado.length === 10) {
    const total = [...normalizado].reduce((sum, char, index) => {
      const digit = char === "X" ? 10 : Number(char);
      return sum + digit * (10 - index);
    }, 0);
    if (total % 11 !== 0) throw new ApiError(400, "ISBN-10 inválido: el dígito verificador no coincide.");
  } else {
    const total = [...normalizado.slice(0, 12)].reduce(
      (sum, char, index) => sum + Number(char) * (index % 2 === 0 ? 1 : 3),
      0
    );
    const check = (10 - (total % 10)) % 10;
    if (check !== Number(normalizado[12])) {
      throw new ApiError(400, "ISBN-13 inválido: el dígito verificador no coincide.");
    }
  }
  return { isbn: visible, normalizado };
}

function contribuyentesCanonicos(values = []) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new ApiError(400, "La ficha admite como máximo 100 contribuyentes.");
  }
  const seen = new Set();
  const canonical = values.map((value, index) => {
    const nombre = textoLimpio(value.nombre);
    const rol = String(value.rol || "").trim().toUpperCase();
    const orden = value.orden == null ? index : Number(value.orden);
    if (!nombre || nombre.length > 160) {
      throw new ApiError(400, "Cada contribuyente requiere un nombre de hasta 160 caracteres.");
    }
    if (!ROLES_CONTRIBUYENTE.has(rol)) throw new ApiError(400, `Rol bibliográfico inválido: ${rol}.`);
    if (!Number.isInteger(orden) || orden < 0 || orden > 1000000) {
      throw new ApiError(400, "El orden de contribuyente debe ser un entero no negativo.");
    }
    const key = `${rol}:${nombre.toLocaleLowerCase("es-MX")}`;
    if (seen.has(key)) throw new ApiError(400, `Contribuyente repetido para el rol ${rol}: ${nombre}.`);
    seen.add(key);
    return { nombre, rol, orden };
  }).sort((a, b) => a.orden - b.orden || a.rol.localeCompare(b.rol) || a.nombre.localeCompare(b.nombre));
  if (String(autorDerivado(canonical) || "").length > 1000) {
    throw new ApiError(400, "El resumen de autores excede 1000 caracteres.");
  }
  return canonical;
}

function materiasCanonicas(values = []) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new ApiError(400, "La ficha admite como máximo 100 materias.");
  }
  const seen = new Set();
  return values.map((value) => {
    const nombre = textoLimpio(typeof value === "string" ? value : value.nombre);
    if (!nombre || nombre.length > 120) {
      throw new ApiError(400, "Cada materia requiere un nombre de hasta 120 caracteres.");
    }
    const key = nombre.toLocaleLowerCase("es-MX");
    if (seen.has(key)) throw new ApiError(400, `Materia repetida: ${nombre}.`);
    seen.add(key);
    return { nombre };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function autorDerivado(contribuyentes) {
  const autores = contribuyentes
    .filter((item) => item.rol === "AUTOR")
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"))
    .map((item) => item.nombre);
  return autores.length ? autores.join("; ") : null;
}

async function relacionesPorProducto(db, productIds) {
  const ids = [...new Set(productIds.map(Number).filter(Number.isInteger))];
  const result = new Map(ids.map((id) => [id, { contribuyentes: [], materias: [] }]));
  if (!ids.length) return result;
  // También se usa con un Client dentro de transacciones. Ejecutar en serie
  // evita consultas simultáneas sobre la misma conexión (no soportado por pg).
  const contributors = await db.query(
    `SELECT id, producto_id, nombre, rol, orden
     FROM producto_contribuyentes
     WHERE producto_id=ANY($1::int[])
     ORDER BY producto_id, orden, id`,
    [ids]
  );
  const subjects = await db.query(
    `SELECT pm.producto_id, m.id, m.nombre
     FROM producto_materias pm
     JOIN materias m ON m.id=pm.materia_id
     WHERE pm.producto_id=ANY($1::int[])
     ORDER BY pm.producto_id, lower(m.nombre), m.id`,
    [ids]
  );
  for (const row of contributors.rows) result.get(Number(row.producto_id)).contribuyentes.push(row);
  for (const row of subjects.rows) result.get(Number(row.producto_id)).materias.push({ id: row.id, nombre: row.nombre });
  return result;
}

async function enriquecerProductos(db, products) {
  if (!products.length) return products;
  const relations = await relacionesPorProducto(db, products.map((product) => product.id));
  return products.map((product) => ({
    ...product,
    ...(relations.get(Number(product.id)) || { contribuyentes: [], materias: [] }),
  }));
}

async function reemplazarContribuyentes(client, productId, values) {
  const canonical = contribuyentesCanonicos(values);
  await client.query(`DELETE FROM producto_contribuyentes WHERE producto_id=$1`, [productId]);
  for (const item of canonical) {
    await client.query(
      `INSERT INTO producto_contribuyentes (producto_id, nombre, rol, orden)
       VALUES ($1,$2,$3,$4)`,
      [productId, item.nombre, item.rol, item.orden]
    );
  }
  // Los triggers de producto_contribuyentes mantienen el resumen legado
  // productos.autor. No debe actualizarse de nuevo aquí: hacerlo dispararía
  // el trigger inverso y condensaría varios autores en un solo crédito.
  return canonical;
}

async function reemplazarRolesContribuyentes(client, productId, roles) {
  const entradas = Object.entries(roles || {});
  if (!entradas.length) return;
  for (const [role, names] of entradas) {
    const rol = String(role).toUpperCase();
    if (!ROLES_CONTRIBUYENTE.has(rol)) throw new ApiError(400, `Rol bibliográfico inválido: ${rol}.`);
    const canonical = contribuyentesCanonicos(
      names.map((name, index) => ({ nombre: name, rol, orden: index }))
    );
    await client.query(
      `DELETE FROM producto_contribuyentes WHERE producto_id=$1 AND rol=$2`,
      [productId, rol]
    );
    for (const item of canonical) {
      await client.query(
        `INSERT INTO producto_contribuyentes (producto_id, nombre, rol, orden)
         VALUES ($1,$2,$3,$4)`,
        [productId, item.nombre, item.rol, item.orden]
      );
    }
  }
}

async function reemplazarAutoresLegados(client, productId, autor) {
  const normalized = textoLimpio(autor);
  await client.query(
    `DELETE FROM producto_contribuyentes WHERE producto_id=$1 AND rol='AUTOR'`,
    [productId]
  );
  if (normalized) {
    await client.query(
      `INSERT INTO producto_contribuyentes (producto_id, nombre, rol, orden)
       VALUES ($1,$2,'AUTOR',0)`,
      [productId, normalized]
    );
  }
  return normalized;
}

async function reemplazarMaterias(client, productId, values) {
  const canonical = materiasCanonicas(values);
  const ids = [];
  for (const item of canonical) {
    const result = await client.query(
      `INSERT INTO materias (nombre)
       VALUES ($1)
       ON CONFLICT (lower(nombre)) DO UPDATE SET nombre=materias.nombre
       RETURNING id, nombre`,
      [item.nombre]
    );
    ids.push(result.rows[0]);
  }
  await client.query(`DELETE FROM producto_materias WHERE producto_id=$1`, [productId]);
  for (const subject of ids) {
    await client.query(
      `INSERT INTO producto_materias (producto_id, materia_id) VALUES ($1,$2)`,
      [productId, subject.id]
    );
  }
  return ids;
}

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

function catalogSnapshot(product, relations = { contribuyentes: [], materias: [] }) {
  if (!product) return null;
  const scalar = {};
  for (const field of CAMPOS_CATALOGO_HASH) scalar[field] = product[field] ?? null;
  for (const field of ["categoria_id", "anio_publicacion", "numero_paginas"]) {
    if (scalar[field] != null) scalar[field] = Number(scalar[field]);
  }
  for (const field of ["precio", "costo", "iva"]) {
    if (scalar[field] != null) scalar[field] = Number(scalar[field]);
  }
  return {
    ...scalar,
    contribuyentes: contribuyentesCanonicos(relations.contribuyentes || []),
    materias: materiasCanonicas(relations.materias || []),
  };
}

function hashCatalogSnapshot(snapshot) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(snapshot)))
    .digest("hex");
}

module.exports = {
  ROLES_CONTRIBUYENTE,
  CAMPOS_CATALOGO_HASH,
  textoLimpio,
  normalizarIsbn,
  contribuyentesCanonicos,
  materiasCanonicas,
  autorDerivado,
  relacionesPorProducto,
  enriquecerProductos,
  reemplazarContribuyentes,
  reemplazarRolesContribuyentes,
  reemplazarAutoresLegados,
  reemplazarMaterias,
  catalogSnapshot,
  hashCatalogSnapshot,
};
