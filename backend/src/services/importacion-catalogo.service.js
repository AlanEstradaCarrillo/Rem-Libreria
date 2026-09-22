const crypto = require("node:crypto");
const { ApiError } = require("../utils/errors");
const {
  textoLimpio,
  normalizarIsbn,
  contribuyentesCanonicos,
  materiasCanonicas,
  autorDerivado,
  relacionesPorProducto,
  reemplazarContribuyentes,
  reemplazarMaterias,
  catalogSnapshot,
  hashCatalogSnapshot,
} = require("./catalogo-bibliografico.service");

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;
const MAX_CSV_COLUMNS = 40;
const PREVIEW_TTL_HOURS = 24;
const PREVIEW_PAGE_SIZE = 50;

const REQUIRED_HEADERS = ["sku", "titulo", "precio"];
const CANONICAL_HEADERS = new Set([
  ...REQUIRED_HEADERS,
  "codigo_barras",
  "isbn",
  "subtitulo",
  "autores",
  "traductores",
  "ilustradores",
  "editores",
  "editorial",
  "categoria_slug",
  "edicion",
  "anio_publicacion",
  "idioma",
  "numero_paginas",
  "encuadernacion",
  "formato",
  "coleccion",
  "serie",
  "volumen",
  "materias",
  "costo",
  "iva",
  "descripcion_comercial",
]);
const FORBIDDEN_HEADERS = new Set([
  "stock",
  "stock_reservado",
  "stock_consignado",
  "stock_disponible",
  "publicado_web",
  "publicado_en",
  "imagenes",
  "imagen",
  "imagen_principal",
  "slug",
  "activo",
]);
const HEADER_ALIASES = new Map([
  ["codigo", "codigo_barras"],
  ["código_barras", "codigo_barras"],
  ["autor", "autores"],
  ["traductor", "traductores"],
  ["ilustrador", "ilustradores"],
  ["editor", "editores"],
  ["paginas", "numero_paginas"],
  ["páginas", "numero_paginas"],
]);
const CONTRIBUTOR_COLUMNS = new Map([
  ["autores", "AUTOR"],
  ["traductores", "TRADUCTOR"],
  ["ilustradores", "ILUSTRADOR"],
  ["editores", "EDITOR"],
]);

function csvError(message) {
  return new ApiError(400, `CSV inválido: ${message}`);
}

function detectDelimiter(content) {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === ",") commas += 1;
    else if (char === ";") semicolons += 1;
    else if (char === "\r" || char === "\n") break;
  }
  if (commas === 0 && semicolons === 0) {
    throw csvError("el encabezado debe separar columnas con coma o punto y coma.");
  }
  return semicolons > commas ? ";" : ",";
}

function parseCsv(content) {
  if (typeof content !== "string") throw new ApiError(415, "Se requiere un archivo CSV UTF-8.");
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength === 0) throw csvError("el archivo está vacío.");
  if (byteLength > MAX_CSV_BYTES) throw new ApiError(413, "El CSV excede el límite de 2 MiB.");
  if (content.includes("\0")) throw csvError("el archivo contiene bytes nulos.");
  if (content.includes("\uFFFD")) throw csvError("el archivo no contiene texto UTF-8 válido.");

  const delimiter = detectDelimiter(content.replace(/^\uFEFF/u, ""));
  const records = [];
  let cells = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  const finishField = () => {
    cells.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRecord = () => {
    finishField();
    if (!cells.every((value) => value.trim() === "")) {
      records.push({ numero_fila: recordLine, celdas: cells });
      if (records.length > MAX_CSV_ROWS + 1) {
        throw csvError(`el archivo excede ${MAX_CSV_ROWS} filas de datos.`);
      }
    }
    cells = [];
    recordLine = line + 1;
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
        if (char === "\n") line += 1;
        else if (char === "\r" && content[index + 1] !== "\n") line += 1;
      }
      continue;
    }

    if (afterQuote) {
      if (char === " " || char === "\t") continue;
      if (char === delimiter) {
        finishField();
        continue;
      }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && content[index + 1] === "\n") index += 1;
        finishRecord();
        line += 1;
        continue;
      }
      throw csvError(`hay texto inesperado después de cerrar comillas en la línea ${line}.`);
    }

    if (char === '"') {
      if (field.trim() !== "") throw csvError(`hay comillas inesperadas en la línea ${line}.`);
      field = "";
      quoted = true;
    } else if (char === delimiter) {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      finishRecord();
      line += 1;
    } else {
      field += char;
    }
  }
  if (quoted) throw csvError(`faltan comillas de cierre desde la línea ${recordLine}.`);
  if (cells.length || field !== "" || afterQuote) finishRecord();
  if (!records.length) throw csvError("no contiene encabezados.");

  const rawHeaders = records[0].celdas;
  if (rawHeaders.length > MAX_CSV_COLUMNS) {
    throw csvError(`el encabezado excede ${MAX_CSV_COLUMNS} columnas.`);
  }
  const headers = rawHeaders.map((value, index) => {
    const clean = value.replace(index === 0 ? /^\uFEFF/u : /$^/u, "").trim().toLowerCase();
    return HEADER_ALIASES.get(clean) || clean;
  });
  if (headers.some((header) => !header)) throw csvError("hay un encabezado vacío.");
  const duplicate = headers.find((header, index) => headers.indexOf(header) !== index);
  if (duplicate) throw csvError(`el encabezado "${duplicate}" está repetido.`);
  for (const header of headers) {
    if (FORBIDDEN_HEADERS.has(header)) {
      throw csvError(`la columna "${header}" no se puede importar; inventario y publicación se administran por separado.`);
    }
    if (!CANONICAL_HEADERS.has(header)) throw csvError(`la columna "${header}" no es reconocida.`);
  }
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) throw csvError(`falta el encabezado obligatorio "${required}".`);
  }

  const rows = records.slice(1).map((record) => {
    if (record.celdas.length !== headers.length) {
      throw csvError(
        `la línea ${record.numero_fila} tiene ${record.celdas.length} columnas; se esperaban ${headers.length}.`
      );
    }
    return {
      numero_fila: record.numero_fila,
      raw: Object.fromEntries(headers.map((header, index) => [header, record.celdas[index]])),
    };
  });
  if (!rows.length) throw csvError("no contiene filas de productos.");
  return { delimiter, headers, rows };
}

function rowIssue(campo, codigo, mensaje) {
  return { campo, codigo, mensaje };
}

function parseText(row, field, max, errors, { min = 1 } = {}) {
  const raw = row.raw[field];
  const value = textoLimpio(raw);
  if (!value) return undefined;
  if (value.length < min || value.length > max) {
    errors.push(rowIssue(field, "LONGITUD_INVALIDA", `${field} debe contener entre ${min} y ${max} caracteres.`));
    return undefined;
  }
  return value;
}

function parseNumber(row, field, errors, {
  min = 0,
  max = 999999,
  integer = false,
  scale = null,
} = {}) {
  const raw = textoLimpio(row.raw[field]);
  if (!raw) return undefined;
  if (!/^-?\d+(?:[.,]\d+)?$/u.test(raw)) {
    errors.push(rowIssue(field, "NUMERO_INVALIDO", `${field} debe ser un número.`));
    return undefined;
  }
  const decimalPart = raw.split(/[.,]/u)[1] || "";
  if (scale != null && decimalPart.length > scale) {
    errors.push(rowIssue(
      field,
      "DECIMALES_INVALIDOS",
      `${field} admite como máximo ${scale} decimales.`
    ));
    return undefined;
  }
  const value = Number(raw.replace(",", "."));
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    errors.push(rowIssue(field, "RANGO_INVALIDO", `${field} está fuera del rango permitido.`));
    return undefined;
  }
  return value;
}

function parseList(row, field, maxItem, errors) {
  const raw = textoLimpio(row.raw[field]);
  if (!raw) return undefined;
  const initialErrorCount = errors.length;
  const values = raw.split("|").map(textoLimpio).filter(Boolean);
  if (!values.length || values.length > 50) {
    errors.push(rowIssue(field, "LISTA_INVALIDA", `${field} debe contener entre 1 y 50 valores separados por |.`));
    return undefined;
  }
  const seen = new Set();
  for (const value of values) {
    if (value.length > maxItem) {
      errors.push(rowIssue(field, "LONGITUD_INVALIDA", `Cada valor de ${field} admite hasta ${maxItem} caracteres.`));
    }
    const key = value.toLocaleLowerCase("es-MX");
    if (seen.has(key)) errors.push(rowIssue(field, "VALOR_REPETIDO", `${value} está repetido en ${field}.`));
    seen.add(key);
  }
  return errors.length === initialErrorCount ? values : undefined;
}

function normalizeRow(row) {
  const errors = [];
  const warnings = [];
  const data = {};
  data.sku = parseText(row, "sku", 24, errors, { min: 3 });
  data.titulo = parseText(row, "titulo", 160, errors, { min: 2 });
  data.precio = parseNumber(row, "precio", errors, { scale: 2 });

  const textFields = [
    ["codigo_barras", 30],
    ["subtitulo", 240],
    ["editorial", 120],
    ["categoria_slug", 120],
    ["edicion", 80],
    ["idioma", 60],
    ["encuadernacion", 80],
    ["formato", 80],
    ["coleccion", 120],
    ["serie", 120],
    ["volumen", 40],
    ["descripcion_comercial", 10000],
  ];
  for (const [field, max] of textFields) {
    const value = parseText(row, field, max, errors);
    if (value !== undefined) data[field] = value;
  }
  if (data.categoria_slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(data.categoria_slug)) {
    errors.push(rowIssue("categoria_slug", "SLUG_INVALIDO", "categoria_slug sólo admite minúsculas, números y guiones."));
  }

  const isbnRaw = textoLimpio(row.raw.isbn);
  if (isbnRaw) {
    try {
      const isbn = normalizarIsbn(isbnRaw);
      data.isbn = isbn.isbn;
      data.isbn_normalizado = isbn.normalizado;
    } catch (error) {
      errors.push(rowIssue("isbn", "ISBN_INVALIDO", error.message));
    }
  }
  const year = parseNumber(row, "anio_publicacion", errors, { min: 1000, max: 9999, integer: true });
  if (year !== undefined) data.anio_publicacion = year;
  const pages = parseNumber(row, "numero_paginas", errors, { min: 1, max: 1000000, integer: true });
  if (pages !== undefined) data.numero_paginas = pages;
  const cost = parseNumber(row, "costo", errors, { scale: 2 });
  if (cost !== undefined) data.costo = cost;
  const tax = parseNumber(row, "iva", errors, { min: 0, max: 100, scale: 2 });
  if (tax !== undefined) data.iva = tax;

  data.contribuyentes_por_rol = {};
  for (const [column, role] of CONTRIBUTOR_COLUMNS) {
    const values = parseList(row, column, 160, errors);
    if (values !== undefined) data.contribuyentes_por_rol[role] = values;
  }
  if (!Object.keys(data.contribuyentes_por_rol).length) delete data.contribuyentes_por_rol;
  const subjects = parseList(row, "materias", 120, errors);
  if (subjects !== undefined) data.materias = subjects;

  if (data.sku === undefined) {
    errors.push(rowIssue("sku", "REQUERIDO", "sku es obligatorio en cada fila."));
  }

  return { ...row, data, errors, warnings };
}

function groupDuplicates(rows, keyFn, field, code, message) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) row.errors.push(rowIssue(field, code, message));
  }
}

function equalValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function displayChanges(current, desired) {
  const changes = [];
  for (const key of Object.keys(desired)) {
    if (key === "contribuyentes" || key === "materias") continue;
    if (!equalValue(current?.[key], desired[key])) {
      changes.push({ campo: key, anterior: current?.[key] ?? null, nuevo: desired[key] ?? null });
    }
  }
  if (!equalValue(current?.contribuyentes || [], desired.contribuyentes || [])) {
    changes.push({ campo: "contribuyentes", anterior: current?.contribuyentes || [], nuevo: desired.contribuyentes || [] });
  }
  if (!equalValue(current?.materias || [], desired.materias || [])) {
    changes.push({ campo: "materias", anterior: current?.materias || [], nuevo: desired.materias || [] });
  }
  return changes;
}

function desiredSnapshot(existingSnapshot, data, { categoryId = undefined } = {}) {
  const desired = existingSnapshot ? structuredClone(existingSnapshot) : {
    sku: data.sku,
    codigo_barras: null,
    isbn: null,
    isbn_normalizado: null,
    titulo: null,
    subtitulo: null,
    autor: null,
    editorial: null,
    categoria_id: null,
    precio: null,
    costo: 0,
    iva: 16,
    descripcion_comercial: null,
    edicion: null,
    anio_publicacion: null,
    idioma: null,
    numero_paginas: null,
    encuadernacion: null,
    formato: null,
    coleccion: null,
    serie: null,
    volumen: null,
    contribuyentes: [],
    materias: [],
  };
  const scalar = [
    "sku", "codigo_barras", "isbn", "isbn_normalizado", "titulo", "subtitulo",
    "editorial", "precio", "costo", "iva", "descripcion_comercial", "edicion",
    "anio_publicacion", "idioma", "numero_paginas", "encuadernacion", "formato",
    "coleccion", "serie", "volumen",
  ];
  for (const field of scalar) {
    if (data[field] !== undefined) desired[field] = data[field];
  }
  if (categoryId !== undefined) desired.categoria_id = categoryId;
  if (data.contribuyentes_por_rol) {
    const untouched = desired.contribuyentes.filter(
      (item) => !Object.prototype.hasOwnProperty.call(data.contribuyentes_por_rol, item.rol)
    );
    const replaced = Object.entries(data.contribuyentes_por_rol).flatMap(([role, names]) => (
      names.map((name, index) => ({ nombre: name, rol: role, orden: index }))
    ));
    desired.contribuyentes = contribuyentesCanonicos([...untouched, ...replaced]);
    if (Object.prototype.hasOwnProperty.call(data.contribuyentes_por_rol, "AUTOR")) {
      desired.autor = autorDerivado(desired.contribuyentes);
    }
  }
  if (data.materias) desired.materias = materiasCanonicas(data.materias);
  return desired;
}

async function buildPreview(db, content) {
  const parsed = parseCsv(content);
  const rows = parsed.rows.map(normalizeRow);
  groupDuplicates(rows, (row) => row.data.sku, "sku", "SKU_REPETIDO", "El SKU está repetido dentro del CSV.");
  groupDuplicates(
    rows,
    (row) => row.data.isbn_normalizado,
    "isbn",
    "ISBN_REPETIDO",
    "El ISBN está repetido dentro del CSV."
  );
  groupDuplicates(
    rows,
    (row) => row.data.codigo_barras,
    "codigo_barras",
    "CODIGO_REPETIDO",
    "El código de barras está repetido dentro del CSV."
  );

  const skus = [...new Set(rows.map((row) => row.data.sku).filter(Boolean))];
  const isbns = [...new Set(rows.map((row) => row.data.isbn_normalizado).filter(Boolean))];
  const barcodes = [...new Set(rows.map((row) => row.data.codigo_barras).filter(Boolean))];
  const categorySlugs = [...new Set(rows.map((row) => row.data.categoria_slug).filter(Boolean))];
  const subjectNames = [...new Set(rows.flatMap((row) => row.data.materias || [])
    .map((name) => name.toLocaleLowerCase("es-MX")))];
  // buildPreview corre dentro de la misma transacción que persiste el
  // snapshot. Un Client de pg sólo admite una consulta activa a la vez.
  const productsResult = await db.query(
    `SELECT * FROM productos WHERE sku=ANY($1::text[])`,
    [skus]
  );
  const identityResult = await db.query(
    `SELECT id, sku, codigo_barras, isbn_normalizado
     FROM productos
     WHERE isbn_normalizado=ANY($1::text[]) OR codigo_barras=ANY($2::text[])`,
    [isbns, barcodes]
  );
  const categoryResult = await db.query(
    `SELECT id, slug, nombre, activo FROM categorias WHERE slug=ANY($1::text[])`,
    [categorySlugs]
  );
  const subjectResult = await db.query(
    `SELECT id, nombre, lower(nombre) AS nombre_normalizado
     FROM materias WHERE lower(nombre)=ANY($1::text[])`,
    [subjectNames]
  );
  const products = new Map(productsResult.rows.map((row) => [row.sku, row]));
  const identitiesByIsbn = new Map(
    identityResult.rows.filter((row) => row.isbn_normalizado).map((row) => [row.isbn_normalizado, row])
  );
  const identitiesByBarcode = new Map(
    identityResult.rows.filter((row) => row.codigo_barras).map((row) => [row.codigo_barras, row])
  );
  const categories = new Map(categoryResult.rows.map((row) => [row.slug, row]));
  const knownSubjects = new Map(
    subjectResult.rows.map((row) => [row.nombre_normalizado, row.nombre])
  );
  const newSubjects = new Map();
  const relations = await relacionesPorProducto(db, productsResult.rows.map((row) => row.id));

  for (const row of rows) {
    if (row.data.materias) {
      row.data.materias = row.data.materias.map((name) => {
        const key = name.toLocaleLowerCase("es-MX");
        if (knownSubjects.has(key)) return knownSubjects.get(key);
        if (!newSubjects.has(key)) newSubjects.set(key, name);
        return newSubjects.get(key);
      });
    }
    const product = row.data.sku ? products.get(row.data.sku) : null;
    if (!product) {
      if (row.data.titulo === undefined) row.errors.push(rowIssue("titulo", "REQUERIDO", "titulo es obligatorio al crear."));
      if (row.data.precio === undefined) row.errors.push(rowIssue("precio", "REQUERIDO", "precio es obligatorio al crear."));
    }
    let categoryId;
    if (row.data.categoria_slug) {
      const category = categories.get(row.data.categoria_slug);
      if (!category) {
        row.errors.push(rowIssue("categoria_slug", "CATEGORIA_INEXISTENTE", "La categoría no existe."));
      } else if (!category.activo) {
        row.errors.push(rowIssue("categoria_slug", "CATEGORIA_INACTIVA", "La categoría está inactiva."));
      } else categoryId = Number(category.id);
    }

    const isbnOwner = row.data.isbn_normalizado && identitiesByIsbn.get(row.data.isbn_normalizado);
    if (isbnOwner && (!product || Number(isbnOwner.id) !== Number(product.id))) {
      row.errors.push(rowIssue("isbn", "ISBN_EN_OTRO_PRODUCTO", `El ISBN pertenece al SKU ${isbnOwner.sku}.`));
    }
    const barcodeOwner = row.data.codigo_barras && identitiesByBarcode.get(row.data.codigo_barras);
    if (barcodeOwner && (!product || Number(barcodeOwner.id) !== Number(product.id))) {
      row.errors.push(rowIssue("codigo_barras", "CODIGO_EN_OTRO_PRODUCTO", `El código pertenece al SKU ${barcodeOwner.sku}.`));
    }

    let current = null;
    let desired = null;
    try {
      current = product
        ? catalogSnapshot(product, relations.get(Number(product.id)))
        : null;
      desired = desiredSnapshot(current, row.data, { categoryId });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      row.errors.push(rowIssue(
        "ficha_bibliografica",
        "FICHA_INVALIDA",
        error.message
      ));
      desired = current;
    }
    row.producto = product || null;
    row.objetivo_hash = current ? hashCatalogSnapshot(current) : null;
    row.desired = desired;
    row.cambios = desired ? displayChanges(current, desired) : [];
    if (row.data.costo !== undefined && product && Number(product.costo) !== row.data.costo) {
      row.warnings.push(rowIssue("costo", "COSTO_ACTUALIZADO", "El costo vigente del producto cambiará."));
    }
    if (row.data.materias) {
      for (const name of row.data.materias) {
        if (!knownSubjects.has(name.toLocaleLowerCase("es-MX"))) {
          row.warnings.push(rowIssue("materias", "MATERIA_NUEVA", `Se creará la materia "${name}".`));
        }
      }
    }
    row.accion = row.errors.length
      ? "RECHAZAR"
      : product
        ? (row.cambios.length ? "ACTUALIZAR" : "SIN_CAMBIOS")
        : "CREAR";
  }
  return { ...parsed, rows };
}

function summaryForRows(rows) {
  const summary = { filas_total: rows.length, crear: 0, actualizar: 0, sin_cambios: 0, rechazadas: 0 };
  for (const row of rows) {
    if (row.accion === "CREAR") summary.crear += 1;
    else if (row.accion === "ACTUALIZAR") summary.actualizar += 1;
    else if (row.accion === "SIN_CAMBIOS") summary.sin_cambios += 1;
    else summary.rechazadas += 1;
  }
  return summary;
}

function publicRow(row) {
  const persisted = row.datos_normalizados || {};
  const data = persisted.valores || row.data || persisted;
  return {
    id: row.id,
    numero_fila: Number(row.numero_fila),
    accion: row.accion,
    sku: data.sku || null,
    isbn: data.isbn || null,
    titulo: data.titulo || null,
    errores: row.errores || row.errors || [],
    advertencias: row.advertencias || row.warnings || [],
    cambios: row.cambios || persisted.cambios || [],
  };
}

function rawHash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function publicImport(row) {
  return {
    id: Number(row.id),
    nombre_archivo: row.archivo_nombre,
    hash_sha256: String(row.contenido_sha256 || "").trim(),
    estado: row.estado,
    creado_en: row.creado_en,
    expira_en: row.expira_en,
    aplicado_en: row.aplicado_en,
  };
}

function summaryFromImport(row) {
  return {
    filas_total: Number(row.total_filas),
    crear: Number(row.filas_crear),
    actualizar: Number(row.filas_actualizar),
    sin_cambios: Number(row.filas_sin_cambios),
    rechazadas: Number(row.filas_rechazadas),
  };
}

function persistedRow(row) {
  return {
    numero_fila: row.numero_fila,
    datos_originales: row.raw,
    datos_normalizados: {
      valores: row.data,
      producto_deseado: row.desired,
      cambios: row.cambios,
    },
    accion: row.accion,
    producto_objetivo_id: row.producto ? Number(row.producto.id) : null,
    objetivo_hash: row.objetivo_hash,
    errores: row.errors,
    advertencias: row.warnings,
  };
}

async function persistPreview(client, {
  preview,
  usuarioId,
  archivoNombre,
  contenidoHash,
}) {
  const summary = summaryForRows(preview.rows);
  const inserted = await client.query(
    `INSERT INTO catalogo_importaciones
       (creado_por_usuario_id, archivo_nombre, contenido_sha256, columnas,
        total_filas, filas_crear, filas_actualizar, filas_sin_cambios, filas_rechazadas)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      usuarioId,
      archivoNombre,
      contenidoHash,
      JSON.stringify(preview.headers),
      summary.filas_total,
      summary.crear,
      summary.actualizar,
      summary.sin_cambios,
      summary.rechazadas,
    ]
  );
  const importRow = inserted.rows[0];
  const rows = preview.rows.map(persistedRow);
  const insertedRows = await client.query(
    `INSERT INTO catalogo_importacion_filas
       (importacion_id, numero_fila, datos_originales, datos_normalizados,
        accion_prevista, producto_objetivo_id, objetivo_hash, errores, advertencias)
     SELECT $1, fila.numero_fila, fila.datos_originales, fila.datos_normalizados,
            fila.accion, fila.producto_objetivo_id, fila.objetivo_hash,
            fila.errores, fila.advertencias
     FROM jsonb_to_recordset($2::jsonb) AS fila(
       numero_fila integer,
       datos_originales jsonb,
       datos_normalizados jsonb,
       accion varchar(20),
       producto_objetivo_id integer,
       objetivo_hash char(64),
       errores jsonb,
       advertencias jsonb
     )
     RETURNING id, numero_fila, datos_normalizados,
               accion_prevista AS accion, errores, advertencias`,
    [importRow.id, JSON.stringify(rows)]
  );
  insertedRows.rows.sort((a, b) => Number(a.numero_fila) - Number(b.numero_fila));
  return { importRow, summary, rows: insertedRows.rows };
}

async function loadImport(db, importId, usuarioId, { lock = false } = {}) {
  const result = await db.query(
    `SELECT * FROM catalogo_importaciones
     WHERE id=$1 AND creado_por_usuario_id=$2
     ${lock ? "FOR UPDATE" : ""}`,
    [importId, usuarioId]
  );
  if (!result.rows[0]) throw new ApiError(404, "Previsualización de catálogo no encontrada.");
  return result.rows[0];
}

async function listPreviewRows(db, {
  importId,
  usuarioId,
  action = null,
  page = 1,
  limit = PREVIEW_PAGE_SIZE,
}) {
  await loadImport(db, importId, usuarioId);
  const offset = (page - 1) * limit;
  const [count, rows] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::integer AS total
       FROM catalogo_importacion_filas
       WHERE importacion_id=$1
         AND ($2::varchar IS NULL OR accion_prevista=$2)`,
      [importId, action]
    ),
    db.query(
      `SELECT id, numero_fila, datos_normalizados,
              accion_prevista AS accion, errores, advertencias
       FROM catalogo_importacion_filas
       WHERE importacion_id=$1
         AND ($2::varchar IS NULL OR accion_prevista=$2)
       ORDER BY numero_fila, id
       LIMIT $3 OFFSET $4`,
      [importId, action, limit, offset]
    ),
  ]);
  return {
    page,
    limit,
    total: Number(count.rows[0].total),
    resultados: rows.rows.map(publicRow),
  };
}

const PRODUCT_WRITE_FIELDS = [
  "sku",
  "codigo_barras",
  "isbn",
  "titulo",
  "subtitulo",
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

async function currentProductSnapshot(client, productId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT * FROM productos WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [productId]
  );
  if (!result.rows[0]) return null;
  const relations = await relacionesPorProducto(client, [productId]);
  return catalogSnapshot(result.rows[0], relations.get(Number(productId)));
}

async function validateCategory(client, categoryId) {
  if (categoryId == null) return;
  const result = await client.query(
    `SELECT id FROM categorias WHERE id=$1 AND activo FOR SHARE`,
    [categoryId]
  );
  if (!result.rows[0]) {
    throw new ApiError(409, "Una categoría seleccionada ya no existe o está inactiva; genera otra previsualización.");
  }
}

async function writeProductSnapshot(client, desired, productId = null) {
  await validateCategory(client, desired.categoria_id);
  let id = productId;
  if (id == null) {
    const columns = PRODUCT_WRITE_FIELDS.join(", ");
    const placeholders = PRODUCT_WRITE_FIELDS.map((_, index) => `$${index + 1}`).join(", ");
    const values = PRODUCT_WRITE_FIELDS.map((field) => desired[field] ?? null);
    const inserted = await client.query(
      `INSERT INTO productos (${columns}, autor, stock, activo)
       VALUES (${placeholders}, NULL, 0, TRUE)
       RETURNING id`,
      values
    );
    id = Number(inserted.rows[0].id);
  } else {
    const values = PRODUCT_WRITE_FIELDS.map((field) => desired[field] ?? null);
    const assignments = PRODUCT_WRITE_FIELDS
      .map((field, index) => `${field}=$${index + 1}`)
      .join(", ");
    values.push(id);
    await client.query(
      `UPDATE productos
       SET ${assignments}, actualizado_en=NOW()
       WHERE id=$${values.length}`,
      values
    );
  }
  await reemplazarContribuyentes(client, id, desired.contribuyentes || []);
  await reemplazarMaterias(client, id, desired.materias || []);
  const written = await currentProductSnapshot(client, id);
  if (hashCatalogSnapshot(written) !== hashCatalogSnapshot(desired)) {
    throw new ApiError(409, "El catálogo cambió durante la importación; genera otra previsualización.");
  }
  return id;
}

async function applyPreview(client, { importRow, usuarioId }) {
  if (importRow.estado === "APLICADA") return importRow;
  if (new Date(importRow.expira_en).getTime() <= Date.now()) {
    throw new ApiError(409, "La previsualización de catálogo expiró; genera una nueva.");
  }
  const rows = await client.query(
    `SELECT * FROM catalogo_importacion_filas
     WHERE importacion_id=$1 ORDER BY numero_fila, id`,
    [importRow.id]
  );
  for (const row of rows.rows) {
    let result;
    let productId = null;
    if (row.accion_prevista === "RECHAZAR") {
      result = "RECHAZADO";
    } else if (row.accion_prevista === "CREAR") {
      const desired = row.datos_normalizados.producto_deseado;
      productId = await writeProductSnapshot(client, desired);
      result = "CREADO";
    } else {
      productId = Number(row.producto_objetivo_id);
      const current = await currentProductSnapshot(client, productId, { lock: true });
      const expectedHash = String(row.objetivo_hash || "").trim();
      if (!current || hashCatalogSnapshot(current) !== expectedHash) {
        throw new ApiError(
          409,
          `El producto de la fila ${row.numero_fila} cambió desde la previsualización; genera una nueva.`
        );
      }
      if (row.accion_prevista === "ACTUALIZAR") {
        productId = await writeProductSnapshot(
          client,
          row.datos_normalizados.producto_deseado,
          productId
        );
        result = "ACTUALIZADO";
      } else {
        result = "SIN_CAMBIOS";
      }
    }
    await client.query(
      `INSERT INTO catalogo_importacion_resultados
         (importacion_id, fila_id, resultado, producto_id, errores)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [
        importRow.id,
        row.id,
        result,
        productId,
        JSON.stringify(result === "RECHAZADO" ? row.errores : []),
      ]
    );
  }
  const applied = await client.query(
    `UPDATE catalogo_importaciones
     SET estado='APLICADA', aplicado_en=NOW(), aplicado_por_usuario_id=$2
     WHERE id=$1
     RETURNING *`,
    [importRow.id, usuarioId]
  );
  return applied.rows[0];
}

module.exports = {
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  MAX_CSV_COLUMNS,
  PREVIEW_TTL_HOURS,
  PREVIEW_PAGE_SIZE,
  parseCsv,
  buildPreview,
  summaryForRows,
  publicRow,
  publicImport,
  summaryFromImport,
  rawHash,
  desiredSnapshot,
  persistPreview,
  loadImport,
  listPreviewRows,
  applyPreview,
};
