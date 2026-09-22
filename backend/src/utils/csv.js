function valorTexto(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// Impide que Excel u otra hoja de cálculo interprete texto controlado por un
// usuario como fórmula al abrir una exportación.
function neutralizarFormula(value) {
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return valorTexto(value);
  }
  const text = valorTexto(value);
  return /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}

function escaparCsv(value) {
  const text = neutralizarFormula(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function crearCsv(columnas, filas) {
  const encabezado = columnas.map((columna) => escaparCsv(columna.etiqueta)).join(",");
  const cuerpo = filas.map((fila) => columnas.map((columna) => {
    const value = typeof columna.valor === "function"
      ? columna.valor(fila)
      : fila[columna.clave];
    return escaparCsv(value);
  }).join(","));
  return [encabezado, ...cuerpo].join("\r\n") + "\r\n";
}

module.exports = { crearCsv, neutralizarFormula };
