// frontend/app.js — cliente seguro de la API omnicanal del POS.
"use strict";

const API = location.protocol === "file:" ? "http://localhost:4000/api" : "/api";
const TOKEN_SESION_KEY = "libreria-rem.pos.token";
const CAJA_SESION_KEY_PREFIX = "libreria-rem.pos.caja";
const COBRO_PENDIENTE_KEY_PREFIX = "libreria-rem.pos.cobro-pendiente";
const MOVIMIENTO_CAJA_KEY_PREFIX = "libreria-rem.pos.movimiento-caja-pendiente";
const CORTE_PENDIENTE_KEY_PREFIX = "libreria-rem.pos.corte-pendiente";
const MAX_PRODUCTOS_CARRITO = 100;
const MAX_CANTIDAD_PRODUCTO = 999;
const MAX_MONTO = 9_999_999_999.99;
const COBRO_TIMEOUT_MS = 30_000;
const METODOS_PAGO = new Set(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]);
let TOKEN = null;
let usuario = null;
let versionSesion = 0;
let cajas = [];
let cajaSeleccionadaId = null;
let cajaEstado = null;
let cajaCargaVersion = 0;
let movimientoCajaEnCurso = false;
let intentoMovimientoCaja = null;
let corteEnCurso = false;
let intentoCorte = null;
let carrito = [];
let busquedaPosVersion = 0;
let metodoPago = "EFECTIVO";
let cobroEnCurso = false;
let intentoCobro = null;
let ventaActiva = null;
let postventaEnCurso = false;
let intentoPostventa = null;
let pedidos = [];
let pedidoActivo = null;
let pedidosPagina = 1;
let pedidosHaySiguiente = false;
let pedidosCargaEnCurso = false;
let pedidoAccionEnCurso = false;
let intentoPedidoAccion = null;
let cobroPedidoEnCurso = false;
let intentoCobroPedido = null;
let productoInventarioActivo = null;
let ajusteEnCurso = false;
let intentoAjuste = null;
let productoKardexActivo = null;
let kardexCursor = null;
let kardexEnCurso = false;
let inventarioSeccion = "existencias";
let sugerenciasReposicion = [];
let reposicionSeleccionados = new Set();
let reposicionCargaEnCurso = false;
let politicaReposicionActiva = null;
let politicaReposicionEnCurso = false;
let intentoPoliticaReposicion = null;
let conteosInventario = [];
let conteosPagina = 1;
let conteosHaySiguiente = false;
let conteosCargaEnCurso = false;
let nuevoConteoProductos = [];
let nuevoConteoProductoTimer = null;
let nuevoConteoProductoVersion = 0;
let creacionConteoEnCurso = false;
let intentoCreacionConteo = null;
let conteoInventarioActivo = null;
let conteoCapturasSucias = new Set();
let capturaConteoEnCurso = false;
let intentoCapturaConteo = null;
let aplicacionConteoEnCurso = false;
let intentoAplicacionConteo = null;
let cancelacionConteoEnCurso = false;
let intentoCancelacionConteo = null;
let cotizacionPos = null;
let cotizacionPosFirma = "";
let cotizacionPosError = "";
let cotizacionPosVersion = 0;
let cotizacionPosEnCurso = false;
let catalogoSeccion = "productos";
let categoriasCatalogo = [];
let productosCatalogo = [];
let productosCatalogoOpciones = [];
let reglasCatalogo = [];
let productoCatalogoActivo = null;
let categoriaCatalogoActiva = null;
let reglaCatalogoActiva = null;
let catalogoProductosVersion = 0;
let catalogoProductoTimer = null;
let importacionProductosActiva = null;
let importacionProductosResumen = null;
let importacionProductosFilas = null;
let importacionProductosPagina = 1;
let importacionProductosFiltro = "TODAS";
let importacionProductosEnCurso = false;
let importacionProductosVersion = 0;
let intentoConfirmacionImportacion = null;
let comprasSeccion = "ordenes";
let ordenesCompra = [];
let comprasPagina = 1;
let comprasHaySiguiente = false;
let comprasCargaEnCurso = false;
let proveedoresCompra = [];
let proveedoresOpcionesCompra = [];
let proveedoresPagina = 1;
let proveedoresHaySiguiente = false;
let proveedoresCargaEnCurso = false;
let proveedorCompraActivo = null;
let ordenCompraActiva = null;
let ordenCompraLineas = [];
let ordenProductoTimer = null;
let ordenProductoVersion = 0;
let emisionCompraEnCurso = false;
let intentoEmisionCompra = null;
let recepcionCompraEnCurso = false;
let intentoRecepcionCompra = null;
let devolucionProveedorEnCurso = false;
let intentoDevolucionProveedor = null;
let cancelacionCompraEnCurso = false;
let intentoCancelacionCompra = null;
let reportesSeccion = "ventas";
let reportesFiltrosCargados = false;
let reportesFiltrosPromesa = null;
let reportesCargaEnCurso = false;
let reportesExportacionEnCurso = false;
let reportesVersion = 0;
let reportesPaginas = { ventas: 1, inventario: 1, compras: 1, pedidos: 1, caja: 1 };
let reportesHaySiguiente = { ventas: false, inventario: false, compras: false, pedidos: false, caja: false };
let clientesCotizacionesSeccion = "clientes";
let clientesDirectorio = [];
let clientesOpciones = [];
let clientesPagina = 1;
let clientesHaySiguiente = false;
let clientesCargaEnCurso = false;
let clienteActivo = null;
let clienteModoConsulta = false;
let clienteVentaId = null;
let cotizaciones = [];
let cotizacionesPagina = 1;
let cotizacionesHaySiguiente = false;
let cotizacionesCargaEnCurso = false;
let cotizacionActiva = null;
let altaCotizacionEnCurso = false;
let intentoAltaCotizacion = null;
let cotizacionAccionEnCurso = false;
let intentoCotizacionAccion = null;
let editorialSeccion = "obras";
let obrasEditoriales = [];
let obrasEditorialesOpciones = [];
let obrasEditorialesPagina = 1;
let obrasEditorialesHaySiguiente = false;
let obrasEditorialesCargaEnCurso = false;
let obraEditorialActiva = null;
let colaboradoresEditoriales = [];
let colaboradoresEditorialesOpciones = [];
let colaboradoresEditorialesPagina = 1;
let colaboradoresEditorialesHaySiguiente = false;
let colaboradoresEditorialesCargaEnCurso = false;
let colaboradorEditorialActivo = null;
let contratosEditoriales = [];
let contratosEditorialesOpciones = [];
let contratosEditorialesPagina = 1;
let contratosEditorialesHaySiguiente = false;
let contratosEditorialesCargaEnCurso = false;
let contratoEditorialActivo = null;
let tirajesEditoriales = [];
let tirajesEditorialesPagina = 1;
let tirajesEditorialesHaySiguiente = false;
let tirajesEditorialesCargaEnCurso = false;
let tirajeEditorialActivo = null;
let liquidacionesRegalias = [];
let estadosCuentaRegalias = [];
let regaliasEditorialesPagina = 1;
let regaliasEditorialesHaySiguiente = false;
let regaliasEditorialesCargaEnCurso = false;
let liquidacionRegaliaActiva = null;
let consignacionesEditoriales = [];
let consignacionesEditorialesPagina = 1;
let consignacionesEditorialesHaySiguiente = false;
let consignacionesEditorialesCargaEnCurso = false;
let consignacionEditorialActiva = null;
let consignacionEditorialLineas = [];
let editorialOperacionEnCurso = false;
let intentoEditorialOperacion = null;
let accionEditorialActiva = null;

const $ = (id) => document.getElementById(id);
const texto = (valor, defecto = "") => valor == null ? defecto : String(valor);
const numero = (valor, defecto = 0) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : defecto;
};
const fmt = (n) => "$" + numero(n).toFixed(2);
const aCentavos = (valor) => Math.round(numero(valor) * 100);

function leerMonto(valor) {
  const entrada = texto(valor).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(entrada)) {
    return { valido: false, mensaje: "Escribe un monto válido con máximo dos decimales." };
  }
  const monto = Number(entrada);
  if (!Number.isFinite(monto) || monto < 0 || monto > MAX_MONTO) {
    return { valido: false, mensaje: "El monto está fuera del rango permitido." };
  }
  return { valido: true, valor: aCentavos(monto) / 100, centavos: aCentavos(monto) };
}
const hora = (iso) => {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? "—"
    : fecha.toLocaleString("es-MX", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
};

function nodo(etiqueta, clase, contenido) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (contenido !== undefined) el.textContent = texto(contenido);
  return el;
}

function celda(contenido, clase) {
  return nodo("td", clase, contenido);
}

function filaVacia(tbody, columnas, mensaje) {
  const tr = document.createElement("tr");
  const td = celda(mensaje, "tabla-vacia");
  td.colSpan = columnas;
  tr.appendChild(td);
  tbody.replaceChildren(tr);
}

function toast(msg, tipo) {
  const t = nodo("div", "toast " + (tipo || ""), msg);
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function nuevaClaveIdempotencia() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function claveCobroPendiente(usuarioId = usuario && usuario.id) {
  const id = numero(usuarioId, 0);
  return id ? `${COBRO_PENDIENTE_KEY_PREFIX}.${id}` : null;
}

function guardarIntentoCobro() {
  const clave = claveCobroPendiente();
  if (!clave || !intentoCobro) return;
  try { sessionStorage.setItem(clave, JSON.stringify(intentoCobro)); } catch (_) { /* almacenamiento no disponible */ }
}

function borrarIntentoCobroPersistido() {
  const clave = claveCobroPendiente();
  if (!clave) return;
  try { sessionStorage.removeItem(clave); } catch (_) { /* almacenamiento no disponible */ }
}

function claveMovimientoCajaPendiente() {
  const id = numero(usuario && usuario.id, 0);
  return id ? `${MOVIMIENTO_CAJA_KEY_PREFIX}.${id}` : null;
}

function guardarIntentoMovimientoCaja() {
  const clave = claveMovimientoCajaPendiente();
  if (!clave || !intentoMovimientoCaja) return;
  try { sessionStorage.setItem(clave, JSON.stringify(intentoMovimientoCaja)); } catch (_) { /* almacenamiento no disponible */ }
}

function borrarIntentoMovimientoCajaPersistido() {
  const clave = claveMovimientoCajaPendiente();
  if (!clave) return;
  try { sessionStorage.removeItem(clave); } catch (_) { /* almacenamiento no disponible */ }
}

function restaurarIntentoMovimientoCaja() {
  const clave = claveMovimientoCajaPendiente();
  if (!clave) return false;
  let valor;
  try { valor = JSON.parse(sessionStorage.getItem(clave) || "null"); } catch (_) { valor = null; }
  const body = valor && valor.body;
  const monto = body && leerMonto(body.monto);
  if (!valor || !["ingreso", "retiro"].includes(valor.tipo)
      || !/^[A-Za-z0-9._:-]{8,100}$/.test(texto(valor.clave))
      || !Number.isInteger(numero(valor.caja_id)) || numero(valor.caja_id) <= 0
      || !body || !Number.isInteger(numero(body.sesion_id)) || numero(body.sesion_id) <= 0
      || !monto.valido || monto.centavos <= 0
      || typeof body.concepto !== "string" || body.concepto.trim().length < 3
      || body.concepto.length > 160) {
    if (valor) borrarIntentoMovimientoCajaPersistido();
    return false;
  }
  intentoMovimientoCaja = valor;
  $(`inp-${valor.tipo}`).value = texto(body.monto);
  $(`inp-${valor.tipo}-concepto`).value = body.concepto;
  return true;
}

function claveCortePendiente() {
  const id = numero(usuario && usuario.id, 0);
  return id ? `${CORTE_PENDIENTE_KEY_PREFIX}.${id}` : null;
}

function guardarIntentoCorte() {
  const clave = claveCortePendiente();
  if (!clave || !intentoCorte) return;
  try { sessionStorage.setItem(clave, JSON.stringify(intentoCorte)); } catch (_) { /* almacenamiento no disponible */ }
}

function borrarIntentoCortePersistido() {
  const clave = claveCortePendiente();
  if (!clave) return;
  try { sessionStorage.removeItem(clave); } catch (_) { /* almacenamiento no disponible */ }
}

function restaurarIntentoCorte() {
  const clave = claveCortePendiente();
  if (!clave) return false;
  let valor;
  try { valor = JSON.parse(sessionStorage.getItem(clave) || "null"); } catch (_) { valor = null; }
  const body = valor && valor.body;
  const contado = body && leerMonto(body.efectivo_contado);
  if (!valor || !/^[A-Za-z0-9._:-]{8,100}$/.test(texto(valor.clave))
      || !Number.isInteger(numero(valor.caja_id)) || numero(valor.caja_id) <= 0
      || !body || !Number.isInteger(numero(body.sesion_id)) || numero(body.sesion_id) <= 0
      || !contado.valido) {
    if (valor) borrarIntentoCortePersistido();
    return false;
  }
  intentoCorte = valor;
  $("inp-contado").value = texto(body.efectivo_contado);
  return true;
}

function intentoCobroGuardadoValido(valor) {
  if (!valor || !/^[A-Za-z0-9._:-]{8,100}$/.test(texto(valor.clave))) return false;
  const body = valor.body;
  if (!body || !Number.isInteger(numero(body.sesion_id)) || numero(body.sesion_id) <= 0
      || !METODOS_PAGO.has(texto(body.metodo_pago))) return false;
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_PRODUCTOS_CARRITO) return false;
  if (body.items.some((item) => !Number.isInteger(numero(item.producto_id))
      || numero(item.producto_id) <= 0 || !Number.isInteger(numero(item.cantidad))
      || numero(item.cantidad) <= 0 || numero(item.cantidad) > MAX_CANTIDAD_PRODUCTO)) return false;
  const total = leerMonto(valor.total);
  if (!total.valido) return false;
  if (body.metodo_pago === "EFECTIVO") {
    const recibido = leerMonto(body.recibido);
    if (!recibido.valido || recibido.centavos < total.centavos) return false;
  }
  return true;
}

function restaurarIntentoCobro() {
  const claveAlmacen = claveCobroPendiente();
  if (!claveAlmacen) return false;
  let guardado;
  try { guardado = JSON.parse(sessionStorage.getItem(claveAlmacen) || "null"); } catch (_) { guardado = null; }
  if (!intentoCobroGuardadoValido(guardado)) {
    if (guardado) borrarIntentoCobroPersistido();
    return false;
  }

  intentoCobro = guardado;
  clienteVentaId = numero(guardado.clienteVentaId, 0) || null;
  const instantanea = Array.isArray(guardado.carrito) ? guardado.carrito : [];
  carrito = guardado.body.items.map((item) => {
    const anterior = instantanea.find((linea) => numero(linea.producto_id) === numero(item.producto_id));
    return {
      producto_id: numero(item.producto_id),
      titulo: texto(anterior && anterior.titulo, `Producto ${item.producto_id}`),
      precio: numero(anterior && anterior.precio),
      stock: Math.max(numero(item.cantidad), numero(anterior && anterior.stock)),
      cantidad: numero(item.cantidad),
      isbn: texto(anterior && anterior.isbn),
    };
  });
  cotizacionPos = guardado.cotizacion || null;
  cotizacionPosFirma = cotizacionPos ? firmaCarrito() : "";
  cotizacionPosError = "";
  cotizacionPosEnCurso = false;
  return true;
}

function guardarTokenSesion(token) {
  try { sessionStorage.setItem(TOKEN_SESION_KEY, token); } catch (_) { /* almacenamiento no disponible */ }
}

function leerTokenSesion() {
  try { return sessionStorage.getItem(TOKEN_SESION_KEY); } catch (_) { return null; }
}

function borrarTokenSesion() {
  try { sessionStorage.removeItem(TOKEN_SESION_KEY); } catch (_) { /* almacenamiento no disponible */ }
}

function claveCajaSeleccionada() {
  const usuarioId = numero(usuario && usuario.id, 0);
  return usuarioId ? `${CAJA_SESION_KEY_PREFIX}.${usuarioId}` : null;
}

function leerCajaSeleccionada() {
  const clave = claveCajaSeleccionada();
  if (!clave) return 0;
  try { return numero(sessionStorage.getItem(clave), 0); } catch (_) { return 0; }
}

function guardarCajaSeleccionada(cajaId) {
  const clave = claveCajaSeleccionada();
  if (!clave || !numero(cajaId, 0)) return;
  try { sessionStorage.setItem(clave, texto(cajaId)); } catch (_) { /* almacenamiento no disponible */ }
}

function asegurarVersionSesion(version) {
  if (version === versionSesion) return;
  const error = new Error("unauthorized");
  error.status = 401;
  throw error;
}

async function api(path, { method = "GET", body, headers = {}, signal } = {}) {
  const version = versionSesion;
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta sin JSON */ }
  asegurarVersionSesion(version);
  if (res.status === 401 && TOKEN) {
    logout("Sesión expirada. Inicia sesión nuevamente.");
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Error " + res.status);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiCsv(path, contenido) {
  const version = versionSesion;
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}),
    },
    body: contenido,
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta sin JSON */ }
  asegurarVersionSesion(version);
  asegurarVersionSesion(version);
  if (res.status === 401 && TOKEN) {
    logout("Sesión expirada. Inicia sesión nuevamente.");
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Error " + res.status);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiArchivo(path) {
  const version = versionSesion;
  const res = await fetch(API + path, {
    headers: TOKEN ? { Authorization: "Bearer " + TOKEN } : {},
  });
  asegurarVersionSesion(version);
  if (res.status === 401 && TOKEN) {
    logout("Sesión expirada. Inicia sesión nuevamente.");
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    let mensaje = "Error " + res.status;
    try {
      const data = await res.json();
      mensaje = data && data.error ? data.error : mensaje;
    } catch (_) { /* respuesta sin JSON */ }
    const err = new Error(mensaje);
    err.status = res.status;
    throw err;
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const blob = await res.blob();
  asegurarVersionSesion(version);
  return {
    blob,
    nombre: match ? match[1] : "reporte-libreria-rem.csv",
  };
}

function extraerLista(respuesta, propiedad) {
  if (Array.isArray(respuesta)) return respuesta;
  if (respuesta && Array.isArray(respuesta[propiedad])) return respuesta[propiedad];
  if (respuesta && Array.isArray(respuesta.resultados)) return respuesta.resultados;
  return [];
}

function esSupervisor() {
  return Boolean(usuario && ["ADMIN", "SUPERVISOR"].includes(usuario.rol));
}

function esAdmin() {
  return Boolean(usuario && usuario.rol === "ADMIN");
}

function idSesionActual() {
  return numero(cajaEstado && (cajaEstado.sesion_id || (cajaEstado.sesion && cajaEstado.sesion.id)), 0);
}

function puedeOperarCaja() {
  return Boolean(cajaEstado && cajaEstado.abierta && cajaEstado.puede_operar !== false
    && idSesionActual() && !corteEnCurso && !intentoCorte);
}

function nombreCaja(caja) {
  return texto(caja && (caja.nombre || caja.codigo), "Caja " + texto(caja && caja.id));
}

function cajaSeleccionada() {
  return cajas.find((c) => numero(c.id) === numero(cajaSeleccionadaId)) || null;
}

/* ============================================================
   AUTENTICACIÓN
============================================================ */
function mostrarLogin(mensaje) {
  $("screen-login").classList.remove("hidden");
  $("screen-app").classList.add("hidden");
  $("login-error").textContent = mensaje || "";
}

function logout(msg) {
  versionSesion++;
  cajaCargaVersion++;
  busquedaPosVersion++;
  borrarTokenSesion();
  TOKEN = null;
  usuario = null;
  $("login-pass").value = "";
  cajas = [];
  cajaSeleccionadaId = null;
  cajaEstado = null;
  movimientoCajaEnCurso = false;
  intentoMovimientoCaja = null;
  corteEnCurso = false;
  intentoCorte = null;
  carrito = [];
  $("inp-buscar").value = "";
  $("resultados").replaceChildren();
  intentoCobro = null;
  intentoPostventa = null;
  pedidos = [];
  pedidoActivo = null;
  pedidosPagina = 1;
  pedidosHaySiguiente = false;
  pedidosCargaEnCurso = false;
  pedidoAccionEnCurso = false;
  intentoPedidoAccion = null;
  cobroPedidoEnCurso = false;
  intentoCobroPedido = null;
  productoInventarioActivo = null;
  intentoAjuste = null;
  productoKardexActivo = null;
  kardexCursor = null;
  inventarioSeccion = "existencias";
  sugerenciasReposicion = [];
  reposicionSeleccionados = new Set();
  reposicionCargaEnCurso = false;
  politicaReposicionActiva = null;
  politicaReposicionEnCurso = false;
  intentoPoliticaReposicion = null;
  conteosInventario = [];
  conteosPagina = 1;
  conteosHaySiguiente = false;
  conteosCargaEnCurso = false;
  nuevoConteoProductos = [];
  clearTimeout(nuevoConteoProductoTimer);
  nuevoConteoProductoVersion++;
  creacionConteoEnCurso = false;
  intentoCreacionConteo = null;
  conteoInventarioActivo = null;
  conteoCapturasSucias = new Set();
  capturaConteoEnCurso = false;
  intentoCapturaConteo = null;
  aplicacionConteoEnCurso = false;
  intentoAplicacionConteo = null;
  cancelacionConteoEnCurso = false;
  intentoCancelacionConteo = null;
  cotizacionPos = null;
  cotizacionPosFirma = "";
  cotizacionPosError = "";
  cotizacionPosVersion++;
  cotizacionPosEnCurso = false;
  categoriasCatalogo = [];
  productosCatalogo = [];
  productosCatalogoOpciones = [];
  reglasCatalogo = [];
  productoCatalogoActivo = null;
  categoriaCatalogoActiva = null;
  reglaCatalogoActiva = null;
  importacionProductosActiva = null;
  importacionProductosResumen = null;
  importacionProductosFilas = null;
  importacionProductosPagina = 1;
  importacionProductosFiltro = "TODAS";
  importacionProductosEnCurso = false;
  importacionProductosVersion++;
  intentoConfirmacionImportacion = null;
  comprasSeccion = "ordenes";
  ordenesCompra = [];
  comprasPagina = 1;
  comprasHaySiguiente = false;
  comprasCargaEnCurso = false;
  proveedoresCompra = [];
  proveedoresOpcionesCompra = [];
  proveedoresPagina = 1;
  proveedoresHaySiguiente = false;
  proveedoresCargaEnCurso = false;
  proveedorCompraActivo = null;
  ordenCompraActiva = null;
  ordenCompraLineas = [];
  ordenProductoVersion++;
  clearTimeout(ordenProductoTimer);
  emisionCompraEnCurso = false;
  intentoEmisionCompra = null;
  recepcionCompraEnCurso = false;
  intentoRecepcionCompra = null;
  devolucionProveedorEnCurso = false;
  intentoDevolucionProveedor = null;
  cancelacionCompraEnCurso = false;
  intentoCancelacionCompra = null;
  reportesSeccion = "ventas";
  reportesFiltrosCargados = false;
  reportesFiltrosPromesa = null;
  reportesCargaEnCurso = false;
  reportesExportacionEnCurso = false;
  reportesVersion++;
  reportesPaginas = { ventas: 1, inventario: 1, compras: 1, pedidos: 1, caja: 1 };
  reportesHaySiguiente = { ventas: false, inventario: false, compras: false, pedidos: false, caja: false };
  clientesCotizacionesSeccion = "clientes";
  clientesDirectorio = [];
  clientesOpciones = [];
  clientesPagina = 1;
  clientesHaySiguiente = false;
  clientesCargaEnCurso = false;
  clienteActivo = null;
  clienteModoConsulta = false;
  clienteVentaId = null;
  cotizaciones = [];
  cotizacionesPagina = 1;
  cotizacionesHaySiguiente = false;
  cotizacionesCargaEnCurso = false;
  cotizacionActiva = null;
  altaCotizacionEnCurso = false;
  intentoAltaCotizacion = null;
  cotizacionAccionEnCurso = false;
  intentoCotizacionAccion = null;
  editorialSeccion = "obras";
  obrasEditoriales = [];
  obrasEditorialesOpciones = [];
  obrasEditorialesPagina = 1;
  obrasEditorialesHaySiguiente = false;
  obrasEditorialesCargaEnCurso = false;
  obraEditorialActiva = null;
  colaboradoresEditoriales = [];
  colaboradoresEditorialesOpciones = [];
  colaboradoresEditorialesPagina = 1;
  colaboradoresEditorialesHaySiguiente = false;
  colaboradoresEditorialesCargaEnCurso = false;
  colaboradorEditorialActivo = null;
  contratosEditoriales = [];
  contratosEditorialesOpciones = [];
  contratosEditorialesPagina = 1;
  contratosEditorialesHaySiguiente = false;
  contratosEditorialesCargaEnCurso = false;
  contratoEditorialActivo = null;
  tirajesEditoriales = [];
  tirajesEditorialesPagina = 1;
  tirajesEditorialesHaySiguiente = false;
  tirajesEditorialesCargaEnCurso = false;
  tirajeEditorialActivo = null;
  liquidacionesRegalias = [];
  estadosCuentaRegalias = [];
  regaliasEditorialesPagina = 1;
  regaliasEditorialesHaySiguiente = false;
  regaliasEditorialesCargaEnCurso = false;
  liquidacionRegaliaActiva = null;
  consignacionesEditoriales = [];
  consignacionesEditorialesPagina = 1;
  consignacionesEditorialesHaySiguiente = false;
  consignacionesEditorialesCargaEnCurso = false;
  consignacionEditorialActiva = null;
  consignacionEditorialLineas = [];
  editorialOperacionEnCurso = false;
  intentoEditorialOperacion = null;
  accionEditorialActiva = null;
  limpiarReportes();
  document.querySelectorAll(".modal.open").forEach((m) => m.classList.remove("open"));
  mostrarLogin(msg);
}

$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const boton = e.currentTarget.querySelector('button[type="submit"]');
  if (boton.disabled) return;
  boton.disabled = true;
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: { email: $("login-email").value.trim(), password: $("login-pass").value },
    });
    versionSesion++;
    TOKEN = data.token;
    usuario = data.usuario;
    guardarTokenSesion(TOKEN);
    $("login-pass").value = "";
    await entrarApp();
  } catch (err) {
    if (err.message !== "unauthorized") $("login-error").textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

$("btn-logout").addEventListener("click", () => logout());

async function entrarApp() {
  $("screen-login").classList.add("hidden");
  $("screen-app").classList.remove("hidden");
  $("user-name").textContent = texto(usuario.nombre);
  $("user-rol").textContent = texto(usuario.rol);
  configurarPermisosVisuales();
  cambiarClientesCotizacionesSeccion("clientes", { cargar: false });
  const cobroRestaurado = restaurarIntentoCobro();
  const movimientoRestaurado = restaurarIntentoMovimientoCaja();
  const corteRestaurado = restaurarIntentoCorte();
  pintarCarrito();
  cambiarTab("venta");
  try {
    await cargarCajas();
  } catch (e) {
    toast(e.message, "err");
    pintarCajaCerrada("No fue posible consultar las cajas.");
  }
  await cargarOpcionesClientes().catch((error) => toast(error.message, "err"));
  if (cobroRestaurado) {
    toast("Hay un cobro pendiente de confirmar. Usa Cobrar para recuperar el resultado sin duplicarlo.", "err");
  }
  if (movimientoRestaurado) {
    toast("Se recuperará el movimiento de caja pendiente con la misma clave, sin duplicarlo.", "err");
    registrarMovimientoCaja(intentoMovimientoCaja.tipo);
  }
  if (corteRestaurado) {
    toast("Se recuperará el corte pendiente con la misma clave, sin cerrar dos veces.", "err");
    confirmarCorteCaja();
  }
  $("inp-buscar").focus();
}

async function restaurarSesion() {
  const token = leerTokenSesion();
  if (!token) return;
  const boton = $("form-login").querySelector('button[type="submit"]');
  boton.disabled = true;
  versionSesion++;
  TOKEN = token;
  try {
    usuario = await api("/auth/me");
    await entrarApp();
  } catch (error) {
    if (error.message !== "unauthorized") {
      versionSesion++;
      TOKEN = null;
      usuario = null;
      mostrarLogin("No fue posible validar la sesión. Comprueba la conexión e inténtalo de nuevo.");
    }
  } finally {
    boton.disabled = false;
  }
}

function configurarPermisosVisuales() {
  $("grupo-movimientos").classList.toggle("hidden", !esSupervisor());
  document.querySelectorAll(".admin-only").forEach((elemento) => {
    elemento.classList.toggle("hidden", !esSupervisor());
  });
  document.querySelectorAll(".solo-admin").forEach((elemento) => {
    elemento.classList.toggle("hidden", !esAdmin());
  });
}

/* ============================================================
   NAVEGACIÓN
============================================================ */
function cambiarTab(nombre) {
  if (["compras", "editorial", "reportes"].includes(nombre) && !esSupervisor()) nombre = "venta";
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === nombre));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + nombre));
  if (nombre === "inventario") cargarInventarioActivo();
  if (nombre === "catalogo") cargarCatalogoActivo();
  if (nombre === "compras") cargarComprasActivo();
  if (nombre === "editorial") cargarEditorialActivo();
  if (nombre === "pedidos") cargarPedidos();
  if (nombre === "clientes-cotizaciones") cargarClientesCotizacionesActivo();
  if (nombre === "caja") cargarCaja();
  if (nombre === "ventas") cargarVentas();
  if (nombre === "reportes") cargarReporteActivo();
}

document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => cambiarTab(b.dataset.tab))
);

/* ============================================================
   CAJAS Y SESIÓN EXPLÍCITA
============================================================ */
async function cargarCajas() {
  const respuesta = await api("/caja/cajas");
  cajas = extraerLista(respuesta, "cajas")
    .filter((c) => c && numero(c.id) > 0 && c.activo !== false);
  const select = $("sel-caja");
  const anterior = numero(cajaSeleccionadaId, 0) || leerCajaSeleccionada();
  select.replaceChildren();

  if (!cajas.length) {
    const option = nodo("option", "", "Sin cajas disponibles");
    option.value = "";
    select.appendChild(option);
    select.disabled = true;
    cajaSeleccionadaId = null;
    pintarCajaCerrada("No hay cajas disponibles.");
    return;
  }

  for (const caja of cajas) {
    const option = nodo("option", "", nombreCaja(caja));
    option.value = texto(caja.id);
    select.appendChild(option);
  }
  const sesionPropia = cajas.find((c) =>
    numero(c.sesion_id, 0) > 0
    && numero(c.sesion_usuario_id, 0) === numero(usuario && usuario.id, 0)
  );
  const cajaDelCobro = intentoCobro && cajas.find((c) =>
    numero(c.sesion_id, 0) === numero(intentoCobro.body && intentoCobro.body.sesion_id, 0)
  );
  const cajaDelMovimiento = intentoMovimientoCaja && cajas.find((c) =>
    numero(c.id, 0) === numero(intentoMovimientoCaja.caja_id, 0)
  );
  const cajaDelCorte = intentoCorte && cajas.find((c) =>
    numero(c.id, 0) === numero(intentoCorte.caja_id, 0)
  );
  const elegida = numero(cajaDelCobro && cajaDelCobro.id, 0)
    || numero(cajaDelCorte && cajaDelCorte.id, 0)
    || numero(cajaDelMovimiento && cajaDelMovimiento.id, 0)
    || (cajas.some((c) => numero(c.id) === anterior) ? anterior : 0)
    || numero(sesionPropia && sesionPropia.id, 0) || numero(cajas[0].id);
  cajaSeleccionadaId = elegida;
  guardarCajaSeleccionada(elegida);
  select.value = texto(elegida);
  select.disabled = false;
  await cargarCaja();
}

$("sel-caja").addEventListener("change", async (e) => {
  if (cobroEnCurso || intentoCobro || $("modal-cobro").classList.contains("open")
      || postventaEnCurso || cobroPedidoEnCurso || intentoCobroPedido
      || movimientoCajaEnCurso || intentoMovimientoCaja || corteEnCurso || intentoCorte) {
    e.currentTarget.value = cajaSeleccionadaId ? texto(cajaSeleccionadaId) : "";
    return;
  }
  cajaSeleccionadaId = numero(e.target.value, 0) || null;
  guardarCajaSeleccionada(cajaSeleccionadaId);
  cajaEstado = null;
  actualizarControlesCaja();
  try { await cargarCaja(); } catch (err) { toast(err.message, "err"); }
});

async function cargarCaja() {
  if (!cajaSeleccionadaId) {
    cajaCargaVersion++;
    pintarCajaCerrada("Selecciona una caja.");
    return;
  }
  const cajaId = numero(cajaSeleccionadaId);
  const version = ++cajaCargaVersion;
  const estado = await api("/caja/estado?caja_id=" + encodeURIComponent(cajaId));
  if (version !== cajaCargaVersion || cajaId !== numero(cajaSeleccionadaId)) return;
  cajaEstado = estado;
  pintarCaja();
}

function pintarCaja() {
  const chip = $("caja-chip");
  const caja = cajaSeleccionada();
  if (!cajaEstado || !cajaEstado.abierta) {
    pintarCajaCerrada(nombreCaja(caja) + " cerrada");
    return;
  }

  chip.textContent = "🟢 " + nombreCaja(caja) + " abierta · Esperado " + fmt(cajaEstado.esperado);
  chip.className = "chip chip-ok";
  $("panel-cerrada").classList.add("hidden");
  $("panel-resumen").classList.remove("hidden");

  const aviso = $("caja-aviso");
  if (cajaEstado.puede_operar === false) {
    chip.textContent = "🟢 " + nombreCaja(caja) + " abierta por "
      + texto(cajaEstado.sesion && cajaEstado.sesion.operador, "otro operador");
    aviso.textContent = texto(cajaEstado.motivo_no_operable, "Esta sesión está abierta, pero tu usuario no puede operarla.");
    aviso.classList.remove("hidden");
    $("resumen-caja").replaceChildren(
      nodo("p", "subtle", "Los totales y movimientos solo están disponibles para el operador de esta caja o un supervisor.")
    );
    filaVacia($("mov-body"), 6, "Movimientos reservados al operador de la caja.");
    actualizarControlesCaja();
    return;
  } else {
    aviso.textContent = "";
    aviso.classList.add("hidden");
  }

  const resumen = $("resumen-caja");
  resumen.replaceChildren();
  const datos = [
    ["Fondo inicial", fmt(cajaEstado.sesion && cajaEstado.sesion.fondo_inicial)],
    ["Ventas efectivo", fmt(cajaEstado.ventas_efectivo)],
    ["Ventas tarjeta", fmt(cajaEstado.ventas_tarjeta)],
    ["Ventas transferencia", fmt(cajaEstado.ventas_transf)],
    ["Devoluciones efectivo", fmt(cajaEstado.devoluciones_efectivo)],
    ["Devoluciones tarjeta", fmt(cajaEstado.devoluciones_tarjeta)],
    ["Devoluciones transferencia", fmt(cajaEstado.devoluciones_transf)],
    ["Ingresos", fmt(cajaEstado.ingresos)],
    ["Retiros", fmt(cajaEstado.retiros)],
    ["N.º ventas", numero(cajaEstado.n_ventas)],
    ["Efectivo esperado", fmt(cajaEstado.esperado)],
  ];
  for (const [etiqueta, valor] of datos) {
    const bloque = nodo("div", "r");
    bloque.append(nodo("span", "", etiqueta), nodo("b", "", valor));
    resumen.appendChild(bloque);
  }
  pintarMovimientos(cajaEstado.movimientos || []);
  actualizarControlesCaja();
}

function pintarCajaCerrada(mensaje) {
  cajaEstado = cajaEstado && !cajaEstado.abierta ? cajaEstado : { abierta: false };
  const chip = $("caja-chip");
  chip.textContent = "🔴 " + texto(mensaje, "Caja cerrada");
  chip.className = "chip chip-warn";
  $("panel-cerrada").classList.remove("hidden");
  $("panel-resumen").classList.add("hidden");
  const ultimo = $("ultimo-corte");
  ultimo.replaceChildren();
  const corte = cajaEstado.ultimo_corte;
  ultimo.classList.toggle("hidden", !corte);
  if (corte) {
    ultimo.appendChild(nodo("h3", "", "Último corte de esta caja"));
    const datos = [
      ["Cerrada", hora(corte.fecha_cierre)],
      ["Responsable", texto(corte.responsable, "—")],
      ["Fondo inicial", fmt(corte.fondo_inicial)],
      ["N.º ventas", numero(corte.n_ventas)],
      ["Ventas efectivo", fmt(corte.ventas_efectivo)],
      ["Ventas tarjeta", fmt(corte.ventas_tarjeta)],
      ["Ventas transferencia", fmt(corte.ventas_transf)],
      ["Devoluciones efectivo", fmt(corte.devoluciones_efectivo)],
      ["Devoluciones tarjeta", fmt(corte.devoluciones_tarjeta)],
      ["Devoluciones transferencia", fmt(corte.devoluciones_transf)],
      ["Ingresos", fmt(corte.ingresos)],
      ["Retiros", fmt(corte.retiros)],
      ["Efectivo esperado", fmt(corte.efectivo_esperado)],
      ["Efectivo contado", fmt(corte.efectivo_contado)],
      ["Diferencia", fmt(corte.diferencia)],
    ];
    const resumen = nodo("div", "resumen");
    for (const [etiqueta, valor] of datos) {
      const bloque = nodo("div", "r");
      bloque.append(nodo("span", "", etiqueta), nodo("b", "", valor));
      resumen.appendChild(bloque);
    }
    ultimo.appendChild(resumen);
  }
  filaVacia($("mov-body"), 6, "Abre la caja para registrar movimientos.");
  actualizarControlesCaja();
}

function pintarMovimientos(movimientos) {
  const tbody = $("mov-body");
  tbody.replaceChildren();
  for (const movimiento of movimientos) {
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(movimiento.creado_en)),
      celda(texto(movimiento.tipo, "—")),
      celda(texto(movimiento.concepto, "")),
      celda(texto(movimiento.usuario, "—")),
      celda(texto(movimiento.metodo_pago, "—")),
      celda(fmt(movimiento.monto))
    );
    tbody.appendChild(tr);
  }
  if (!movimientos.length) filaVacia(tbody, 6, "Sin movimientos.");
}

function actualizarControlesCaja() {
  const operable = puedeOperarCaja();
  const cobroPendienteOperable = Boolean(intentoCobro && operable
    && numero(intentoCobro.body && intentoCobro.body.sesion_id) === idSesionActual());
  $("btn-cobrar").disabled = cobroEnCurso || (intentoCobro
    ? !cobroPendienteOperable
    : (!carrito.length || !operable || cotizacionPosEnCurso || !cotizacionPosVigente()))
    || corteEnCurso || Boolean(intentoCorte);
  $("btn-cobrar").textContent = intentoCobro ? "Recuperar cobro" : "Cobrar";
  $("btn-apertura").disabled = !cajaSeleccionadaId || Boolean(cajaEstado && cajaEstado.abierta)
    || movimientoCajaEnCurso || Boolean(intentoMovimientoCaja)
    || corteEnCurso || Boolean(intentoCorte);
  const pendiente = intentoMovimientoCaja;
  const mismaCajaPendiente = pendiente && numero(pendiente.caja_id) === numero(cajaSeleccionadaId);
  for (const tipo of ["ingreso", "retiro"]) {
    const boton = $(`btn-${tipo}`);
    boton.disabled = !esSupervisor() || movimientoCajaEnCurso
      || corteEnCurso || Boolean(intentoCorte)
      || (pendiente ? !mismaCajaPendiente || pendiente.tipo !== tipo : !operable);
    boton.textContent = pendiente && pendiente.tipo === tipo
      ? `Recuperar ${tipo}` : `Registrar ${tipo}`;
    $(`inp-${tipo}`).disabled = Boolean(pendiente) || movimientoCajaEnCurso;
    $(`inp-${tipo}-concepto`).disabled = Boolean(pendiente) || movimientoCajaEnCurso;
  }
  const avisoMovimiento = $("movimiento-caja-aviso");
  avisoMovimiento.textContent = pendiente
    ? `Hay un ${pendiente.tipo} pendiente de confirmar. Recupéralo antes de registrar otro movimiento.` : "";
  avisoMovimiento.classList.toggle("hidden", !pendiente);
  const cortePendienteCaja = intentoCorte
    && numero(intentoCorte.caja_id) === numero(cajaSeleccionadaId);
  $("btn-corte").disabled = corteEnCurso || movimientoCajaEnCurso || Boolean(pendiente)
    || (intentoCorte ? !cortePendienteCaja : !operable);
  $("btn-corte").textContent = intentoCorte ? "Recuperar corte" : "Realizar corte y cerrar caja";
  $("inp-contado").disabled = corteEnCurso || Boolean(intentoCorte);
  $("aviso-corte-pendiente").classList.toggle("hidden", !intentoCorte);
  $("btn-recuperar-corte").disabled = !cortePendienteCaja || corteEnCurso;
  $("sel-caja").disabled = !cajas.length || cobroEnCurso || Boolean(intentoCobro)
    || $("modal-cobro").classList.contains("open") || postventaEnCurso
    || cobroPedidoEnCurso || Boolean(intentoCobroPedido)
    || movimientoCajaEnCurso || Boolean(pendiente) || corteEnCurso || Boolean(intentoCorte);
  $("sel-venta-cliente").disabled = cobroEnCurso || Boolean(intentoCobro)
    || altaCotizacionEnCurso || Boolean(intentoAltaCotizacion)
    || $("modal-cobro").classList.contains("open")
    || $("modal-cotizacion-alta").classList.contains("open");
  $("btn-refrescar-clientes-pos").disabled = $("sel-venta-cliente").disabled;
  $("btn-guardar-cotizacion").disabled = !carrito.length || !clienteVentaId
    || !clienteSeleccionadoVenta() || !texto(clienteSeleccionadoVenta().telefono).trim()
    || cobroEnCurso || Boolean(intentoCobro) || cotizacionPosEnCurso
    || !cotizacionPosVigente() || altaCotizacionEnCurso || Boolean(intentoAltaCotizacion);
  if ($("modal-pedido").classList.contains("open")) actualizarControlesPedido();
}

async function conBotonOcupado(boton, textoOcupado, trabajo) {
  if (boton.dataset.ocupado === "1") return;
  const original = boton.textContent;
  const deshabilitadoOriginal = boton.disabled;
  boton.dataset.ocupado = "1";
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try { await trabajo(); } finally {
    delete boton.dataset.ocupado;
    boton.textContent = original;
    boton.disabled = deshabilitadoOriginal;
    actualizarControlesCaja();
  }
}

$("btn-apertura").addEventListener("click", async () => {
  await conBotonOcupado($("btn-apertura"), "Abriendo…", async () => {
    const fondoTexto = $("inp-fondo").value.trim();
    const fondoInicial = Number(fondoTexto);
    if (!fondoTexto || !Number.isFinite(fondoInicial) || fondoInicial < 0
      || fondoInicial > 9999999999.99
      || Math.abs((fondoInicial * 100) - Math.round(fondoInicial * 100)) >= 1e-8) {
      toast("Captura un fondo inicial válido con máximo dos decimales.", "err");
      $("inp-fondo").focus();
      return;
    }
    try {
      await api("/caja/apertura", {
        method: "POST",
        body: { caja_id: numero(cajaSeleccionadaId), fondo_inicial: fondoInicial },
      });
      toast("Caja abierta.", "ok");
      await cargarCaja();
    } catch (e) {
      toast(e.message, "err");
      await cargarCaja().catch(() => {});
    }
  });
});

async function registrarMovimientoCaja(tipo) {
  if (movimientoCajaEnCurso) return;
  if (!esSupervisor()) return toast("Tu rol no permite registrar movimientos manuales.", "err");
  if (intentoMovimientoCaja && intentoMovimientoCaja.tipo !== tipo) {
    return toast("Recupera primero el movimiento pendiente.", "err");
  }
  if (!intentoMovimientoCaja) {
    if (!puedeOperarCaja()) return toast("No puedes operar esta sesión de caja.", "err");
    const monto = leerMonto($(`inp-${tipo}`).value);
    const concepto = $(`inp-${tipo}-concepto`).value.trim();
    if (!monto.valido || monto.centavos <= 0) {
      return toast(monto.valido ? "El monto debe ser mayor que cero." : monto.mensaje, "err");
    }
    if (concepto.length < 3 || concepto.length > 160) {
      return toast("El concepto debe tener entre 3 y 160 caracteres.", "err");
    }
    intentoMovimientoCaja = {
      tipo, caja_id: numero(cajaSeleccionadaId), clave: nuevaClaveIdempotencia(),
      body: { sesion_id: idSesionActual(), monto: monto.valor, concepto },
    };
    guardarIntentoMovimientoCaja();
  }
  movimientoCajaEnCurso = true;
  actualizarControlesCaja();
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), COBRO_TIMEOUT_MS);
  try {
    const movimiento = await api(`/caja/${tipo}`, {
      method: "POST", body: intentoMovimientoCaja.body,
      headers: { "Idempotency-Key": intentoMovimientoCaja.clave },
      signal: controlador.signal,
    });
    if (!movimiento || !numero(movimiento.id)) {
      throw new Error("El servidor no confirmó el movimiento; recupéralo con la misma clave.");
    }
    borrarIntentoMovimientoCajaPersistido();
    intentoMovimientoCaja = null;
    $(`inp-${tipo}`).value = "";
    $(`inp-${tipo}-concepto`).value = "";
    toast(`${tipo === "ingreso" ? "Ingreso" : "Retiro"} registrado.`, "ok");
    await cargarCaja().catch(() => toast("El movimiento se registró; actualiza la caja para ver el saldo.", "err"));
  } catch (error) {
    if (intentoMovimientoCaja && error.status && error.status < 500 && error.status !== 401) {
      borrarIntentoMovimientoCajaPersistido();
      intentoMovimientoCaja = null;
    } else if (intentoMovimientoCaja) {
      guardarIntentoMovimientoCaja();
    }
    const mensaje = error.name === "AbortError"
      ? "La respuesta tardó demasiado y no se pudo confirmar el resultado."
      : texto(error.message, "No fue posible registrar el movimiento.");
    toast(intentoMovimientoCaja ? `${mensaje} Recupéralo antes de registrar otro.` : mensaje, "err");
    if (!intentoMovimientoCaja && TOKEN) await cargarCaja().catch(() => {});
  } finally {
    clearTimeout(temporizador);
    movimientoCajaEnCurso = false;
    actualizarControlesCaja();
  }
}

for (const tipo of ["ingreso", "retiro"]) {
  $(`btn-${tipo}`).addEventListener("click", () => registrarMovimientoCaja(tipo));
}

async function confirmarCorteCaja() {
  if (corteEnCurso || !intentoCorte) return;
  corteEnCurso = true;
  actualizarControlesCaja();
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), COBRO_TIMEOUT_MS);
  try {
    const corte = await api("/caja/corte", {
      method: "POST", body: intentoCorte.body,
      headers: { "Idempotency-Key": intentoCorte.clave },
      signal: controlador.signal,
    });
    if (!corte || !numero(corte.id)
        || numero(corte.sesion_id) !== numero(intentoCorte.body.sesion_id)
        || !Number.isFinite(Number(corte.efectivo_esperado))
        || !Number.isFinite(Number(corte.efectivo_contado))
        || !Number.isFinite(Number(corte.diferencia))) {
      throw new Error("El servidor no confirmó el corte completo; recupéralo con la misma clave.");
    }
    borrarIntentoCortePersistido();
    intentoCorte = null;
    const diferencia = numero(corte.diferencia);
    $("resultado-corte").textContent = "Corte realizado. Esperado " + fmt(corte.efectivo_esperado)
      + " · Contado " + fmt(corte.efectivo_contado) + " · "
      + (diferencia === 0 ? "Sin diferencia ✓" : "Diferencia " + fmt(diferencia));
    toast("Corte de caja registrado.", "ok");
    await cargarCaja().catch(() => toast("El corte se guardó; actualiza la caja para consultar el resultado.", "err"));
  } catch (error) {
    if (intentoCorte && error.status && error.status < 500 && error.status !== 401) {
      borrarIntentoCortePersistido();
      intentoCorte = null;
    } else if (intentoCorte) {
      guardarIntentoCorte();
    }
    const mensaje = error.name === "AbortError"
      ? "La respuesta tardó demasiado y no se pudo confirmar el corte."
      : texto(error.message, "No fue posible cerrar la caja.");
    toast(intentoCorte ? `${mensaje} Recupéralo con la misma clave.` : mensaje, "err");
    if (!intentoCorte && TOKEN) await cargarCaja().catch(() => {});
  } finally {
    clearTimeout(temporizador);
    corteEnCurso = false;
    actualizarControlesCaja();
  }
}

$("btn-corte").addEventListener("click", async () => {
  if (corteEnCurso) return;
  if (intentoCorte) return confirmarCorteCaja();
  if (intentoMovimientoCaja || movimientoCajaEnCurso) {
    return toast("Recupera primero el movimiento de caja pendiente.", "err");
  }
  if (!puedeOperarCaja()) return toast("No puedes operar esta sesión de caja.", "err");
  const contado = leerMonto($("inp-contado").value);
  if (!contado.valido) return toast(contado.mensaje, "err");
  if (!confirm("¿Realizar corte y cerrar esta caja? Esta acción no se puede deshacer.")) return;
  intentoCorte = {
    caja_id: numero(cajaSeleccionadaId), clave: nuevaClaveIdempotencia(),
    body: { sesion_id: idSesionActual(), efectivo_contado: contado.valor },
  };
  guardarIntentoCorte();
  await confirmarCorteCaja();
});

$("btn-recuperar-corte").addEventListener("click", () => confirmarCorteCaja());

/* ============================================================
   BÚSQUEDA Y CARRITO
============================================================ */
$("inp-buscar").addEventListener("input", () => { busquedaPosVersion++; });

$("inp-buscar").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const version = ++busquedaPosVersion;
  const q = e.target.value.trim();
  if (!q) {
    $("resultados").replaceChildren();
    return;
  }
  try {
    let p = null;
    try {
      p = await api("/productos/buscar?codigo=" + encodeURIComponent(q));
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (version !== busquedaPosVersion) return;
    if (p) {
      agregarAlCarrito(p);
      e.target.value = "";
      $("resultados").replaceChildren();
      return;
    }
    const res = await api("/productos?q=" + encodeURIComponent(q));
    if (version !== busquedaPosVersion) return;
    pintarResultados(extraerLista(res, "productos"));
  } catch (err) {
    if (version === busquedaPosVersion && err.message !== "unauthorized") toast(err.message, "err");
  }
});

function pintarResultados(items) {
  const box = $("resultados");
  box.replaceChildren();
  if (!items.length) {
    box.appendChild(nodo("p", "resultado-vacio", "Sin resultados."));
    return;
  }
  for (const p of items) {
    const activo = p && p.activo !== false;
    const card = nodo("div", "result-card");
    const info = document.createElement("div");
    info.append(
      nodo("div", "t", texto(p.titulo, "Sin título")),
      nodo("div", "m", texto(p.autor) + (p.isbn ? " · ISBN " + texto(p.isbn) : "") + " · " + fmt(p.precio))
    );
    const acciones = nodo("div", "result-actions");
    const stock = disponibleProducto(p);
    const stockEl = nodo(
      "span",
      !activo || stock === 0 ? "stock-cero" : stock < 5 ? "stock-bajo" : "",
      activo ? "Disponible: " + stock : "Producto inactivo"
    );
    const boton = nodo("button", "btn btn-outline", "Agregar");
    boton.type = "button";
    boton.disabled = !activo || stock === 0;
    boton.addEventListener("click", () => agregarAlCarrito(p));
    acciones.append(stockEl, boton);
    card.append(info, acciones);
    box.appendChild(card);
  }
}

function carritoBloqueado() {
  if (intentoCobro) {
    toast("Hay un cobro pendiente. Reabre Cobrar y reintenta antes de modificar el carrito.", "err");
    return true;
  }
  if ($("modal-cobro").classList.contains("open")) {
    toast("Cierra el cobro antes de modificar el carrito.", "err");
    return true;
  }
  if ($("modal-cotizacion-alta").classList.contains("open") || intentoAltaCotizacion) {
    toast("Cierra o termina la cotización antes de modificar el carrito.", "err");
    return true;
  }
  return false;
}

function agregarAlCarrito(p) {
  if (carritoBloqueado()) return;
  if (!p || p.activo === false) return toast("Este producto está inactivo.", "err");
  const stock = disponibleProducto(p);
  if (stock <= 0) return toast("Sin stock de " + texto(p.titulo), "err");
  const productoId = numero(p.id);
  if (!Number.isInteger(productoId) || productoId <= 0) return toast("Producto inválido.", "err");
  const linea = carrito.find((l) => l.producto_id === productoId);
  if (linea) {
    linea.stock = stock;
    if (linea.cantidad >= MAX_CANTIDAD_PRODUCTO) {
      return toast("La cantidad máxima por producto es 999.", "err");
    }
    if (linea.cantidad + 1 > stock) {
      pintarCarrito();
      return toast("Stock insuficiente.", "err");
    }
    linea.cantidad++;
  } else {
    if (carrito.length >= MAX_PRODUCTOS_CARRITO) {
      return toast("El carrito admite como máximo 100 productos distintos.", "err");
    }
    carrito.push({
      producto_id: productoId,
      titulo: texto(p.titulo, "Sin título"),
      precio: numero(p.precio),
      stock, cantidad: 1, isbn: texto(p.isbn),
    });
  }
  pintarCarrito();
}

function firmaCarrito() {
  return JSON.stringify({
    cliente_id: clienteVentaId || null,
    items: carrito.map((linea) => ({
      producto_id: numero(linea.producto_id),
      cantidad: numero(linea.cantidad),
    })),
  });
}

function cotizacionPosVigente() {
  return Boolean(
    carrito.length && !cotizacionPosEnCurso && cotizacionPos
    && cotizacionPosFirma === firmaCarrito()
    && Array.isArray(cotizacionPos.lineas)
    && cotizacionPos.lineas.every((linea) => linea.disponible_suficiente !== false
      && (linea.disponible == null || numero(linea.disponible) >= numero(linea.cantidad)))
  );
}

function totalCotizado() {
  return cotizacionPosVigente() ? numero(cotizacionPos.total) : 0;
}

async function solicitarCotizacionPos() {
  const firma = firmaCarrito();
  const version = ++cotizacionPosVersion;
  cotizacionPos = null;
  cotizacionPosFirma = "";
  cotizacionPosError = "";
  if (!carrito.length) {
    cotizacionPosEnCurso = false;
    pintarCarrito({ recotizar: false });
    return false;
  }

  cotizacionPosEnCurso = true;
  pintarCarrito({ recotizar: false });
  try {
    const respuesta = await api("/precios/cotizar", {
      method: "POST",
      body: {
        canal: "POS",
        ...(clienteVentaId ? { cliente_id: clienteVentaId } : {}),
        items: carrito.map((linea) => ({
          producto_id: numero(linea.producto_id),
          cantidad: numero(linea.cantidad),
        })),
      },
    });
    if (version !== cotizacionPosVersion || firma !== firmaCarrito()) return false;
    const lineas = Array.isArray(respuesta && respuesta.lineas) ? respuesta.lineas : [];
    const porProducto = new Map(lineas.map((linea) => [numero(linea.producto_id), linea]));
    const coincide = lineas.length === carrito.length && carrito.every((linea) => {
      const cotizada = porProducto.get(numero(linea.producto_id));
      return cotizada && numero(cotizada.cantidad) === numero(linea.cantidad);
    });
    if (!coincide) throw new Error("La respuesta de precios no corresponde al carrito actual.");
    for (const linea of carrito) {
      const cotizada = porProducto.get(numero(linea.producto_id));
      if (cotizada && cotizada.disponible != null) {
        linea.stock = Math.max(0, numero(cotizada.disponible));
      }
    }
    const insuficiente = carrito.find((linea) => {
      const cotizada = porProducto.get(numero(linea.producto_id));
      return cotizada && (cotizada.disponible_suficiente === false
        || (cotizada.disponible != null && numero(cotizada.disponible) < numero(linea.cantidad)));
    });
    if (insuficiente) {
      throw new Error(
        "Stock insuficiente de \"" + insuficiente.titulo + "\" (disponible: "
        + insuficiente.stock + "). Ajusta la cantidad."
      );
    }
    cotizacionPos = respuesta;
    cotizacionPosFirma = firma;
    return true;
  } catch (e) {
    if (version === cotizacionPosVersion && firma === firmaCarrito()) cotizacionPosError = e.message;
    return false;
  } finally {
    if (version === cotizacionPosVersion && firma === firmaCarrito()) {
      cotizacionPosEnCurso = false;
      pintarCarrito({ recotizar: false });
    }
  }
}

function pintarCarrito({ recotizar = true } = {}) {
  const tbody = $("carrito-body");
  tbody.replaceChildren();
  if (!carrito.length) {
    filaVacia(tbody, 7, "Escanea o busca un libro para empezar.");
  } else {
    const cotizacionVisible = cotizacionPosVigente()
      ? cotizacionPos
      : intentoCobro && intentoCobro.cotizacion;
    const precios = cotizacionVisible && Array.isArray(cotizacionVisible.lineas)
      ? new Map(cotizacionVisible.lineas.map((linea) => [numero(linea.producto_id), linea]))
      : new Map();
    carrito.forEach((linea, indice) => {
      const precio = precios.get(numero(linea.producto_id));
      const tr = document.createElement("tr");
      const cantidad = document.createElement("td");
      const menos = nodo("button", "qty-btn", "−");
      menos.type = "button";
      menos.addEventListener("click", () => {
        if (carritoBloqueado()) return;
        if (linea.cantidad > 1) linea.cantidad--; else carrito.splice(indice, 1);
        pintarCarrito();
      });
      const valor = nodo("b", "qty-value", linea.cantidad);
      const mas = nodo("button", "qty-btn", "+");
      mas.type = "button";
      mas.disabled = linea.cantidad >= Math.min(linea.stock, MAX_CANTIDAD_PRODUCTO);
      mas.addEventListener("click", () => {
        if (carritoBloqueado()) return;
        if (linea.cantidad >= MAX_CANTIDAD_PRODUCTO) {
          return toast("La cantidad máxima por producto es 999.", "err");
        }
        if (linea.cantidad + 1 > linea.stock) return toast("Stock máximo alcanzado.", "err");
        linea.cantidad++;
        pintarCarrito();
      });
      cantidad.append(menos, valor, mas);
      const quitarCelda = document.createElement("td");
      const quitar = nodo("button", "qty-btn", "🗑");
      quitar.type = "button";
      quitar.title = "Quitar";
      quitar.addEventListener("click", () => {
        if (carritoBloqueado()) return;
        carrito.splice(indice, 1);
        pintarCarrito();
      });
      quitarCelda.appendChild(quitar);
      tr.append(
        celda(linea.titulo),
        celda(precio ? fmt(precio.precio_lista) : "…"),
        celda(
          precio && numero(precio.descuento_unitario) > 0 ? "−" + fmt(precio.descuento_unitario) : precio ? "—" : "…",
          precio && numero(precio.descuento_unitario) > 0 ? "precio-descuento" : ""
        ),
        celda(precio ? fmt(precio.precio_unitario) : "…", "precio-final"),
        cantidad,
        celda(precio ? fmt(precio.importe) : "…"),
        quitarCelda
      );
      tbody.appendChild(tr);
    });
  }
  const estado = $("carrito-cotizacion");
  $("btn-reintentar-cotizacion").classList.toggle("hidden", !cotizacionPosError || cotizacionPosEnCurso);
  if (!carrito.length) {
    estado.textContent = "Agrega productos para cotizar.";
    estado.className = "cotizacion-estado";
  } else if (intentoCobro) {
    estado.textContent = "Cobro pendiente de confirmación; el carrito está protegido contra cambios.";
    estado.className = "cotizacion-estado cotizacion-cargando";
  } else if (cotizacionPosEnCurso) {
    estado.textContent = "Consultando precios vigentes…";
    estado.className = "cotizacion-estado cotizacion-cargando";
  } else if (cotizacionPosError) {
    estado.textContent = "No se pudo cotizar: " + cotizacionPosError;
    estado.className = "cotizacion-estado cotizacion-error";
  } else if (cotizacionPosVigente()) {
    estado.textContent = cotizacionPos.segmento_cliente === "MAYOREO"
      ? "Precio de mayoreo confirmado por el servidor."
      : "Precio público confirmado por el servidor.";
    estado.className = "cotizacion-estado cotizacion-ok";
  } else {
    estado.textContent = "Cotización pendiente.";
    estado.className = "cotizacion-estado cotizacion-cargando";
  }
  const resumenPendiente = intentoCobro && intentoCobro.cotizacion;
  $("carrito-subtotal").textContent = fmt(resumenPendiente
    ? resumenPendiente.subtotal : cotizacionPosVigente() ? cotizacionPos.subtotal : 0);
  $("carrito-iva").textContent = fmt(resumenPendiente
    ? resumenPendiente.iva : cotizacionPosVigente() ? cotizacionPos.iva : 0);
  $("carrito-descuento").textContent = fmt(resumenPendiente
    ? resumenPendiente.descuento : cotizacionPosVigente() ? cotizacionPos.descuento : 0);
  $("carrito-total").textContent = fmt(intentoCobro ? intentoCobro.total : totalCotizado());
  actualizarControlesCaja();
  if (recotizar && !intentoCobro) void solicitarCotizacionPos();
}

$("btn-reintentar-cotizacion").addEventListener("click", () => {
  void solicitarCotizacionPos();
});

$("btn-cancelar-venta").addEventListener("click", () => {
  if (!carrito.length || carritoBloqueado()) return;
  if (confirm("¿Vaciar el carrito?")) { carrito = []; pintarCarrito(); }
});

/* ============================================================
   MODALES Y COBRO IDEMPOTENTE
============================================================ */
function abrirModal(id) { $(id).classList.add("open"); }

function cerrarModal(el, forzar = false) {
  if (!forzar && (
    (el.id === "modal-cobro" && cobroEnCurso)
    || (el.id === "modal-venta" && postventaEnCurso)
    || (el.id === "modal-ajuste-inventario" && ajusteEnCurso)
    || (el.id === "modal-politica-reposicion"
      && (politicaReposicionEnCurso || intentoPoliticaReposicion))
    || (el.id === "modal-nuevo-conteo"
      && (creacionConteoEnCurso || intentoCreacionConteo))
    || (el.id === "modal-conteo" && (
      capturaConteoEnCurso || intentoCapturaConteo
      || aplicacionConteoEnCurso || intentoAplicacionConteo
      || cancelacionConteoEnCurso || intentoCancelacionConteo
    ))
    || (el.id === "modal-pedido" && (pedidoAccionEnCurso || cobroPedidoEnCurso))
    || (el.id === "modal-orden-compra" && (
      emisionCompraEnCurso || intentoEmisionCompra
      || recepcionCompraEnCurso || intentoRecepcionCompra
      || devolucionProveedorEnCurso || intentoDevolucionProveedor
      || cancelacionCompraEnCurso || intentoCancelacionCompra
    ))
    || (el.id === "modal-recepcion-compra" && (recepcionCompraEnCurso || intentoRecepcionCompra))
    || (el.id === "modal-devolucion-proveedor"
      && (devolucionProveedorEnCurso || intentoDevolucionProveedor))
    || (el.id === "modal-cancelacion-compra"
      && (cancelacionCompraEnCurso || intentoCancelacionCompra))
    || (el.id === "modal-importacion-productos" && importacionProductosEnCurso)
    || (el.id === "modal-cliente" && clienteGuardadoEnCurso)
    || (el.id === "modal-cotizacion-alta"
      && (altaCotizacionEnCurso || intentoAltaCotizacion))
    || (el.id === "modal-cotizacion"
      && (cotizacionAccionEnCurso || intentoCotizacionAccion))
    || (el.classList.contains("modal-editorial-protegido")
      && (editorialOperacionEnCurso || intentoEditorialOperacion))
  )) return;
  el.classList.remove("open");
  if (el.id === "modal-cobro") actualizarControlesCaja();
}

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) cerrarModal(modal); });
  modal.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => cerrarModal(modal))
  );
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const modalesAbiertos = [...document.querySelectorAll(".modal.open")];
  const modalSuperior = modalesAbiertos.at(-1);
  if (modalSuperior) cerrarModal(modalSuperior);
});

$("btn-cobrar").addEventListener("click", async () => {
  if (intentoCobro) {
    if (!puedeOperarCaja() || numero(intentoCobro.body.sesion_id) !== idSesionActual()) {
      return toast("Selecciona la sesión de caja original para recuperar este cobro.", "err");
    }
  } else {
    if (!carrito.length) return toast("El carrito está vacío.", "err");
    if (!puedeOperarCaja()) return toast("Selecciona una caja abierta que puedas operar.", "err");
    await solicitarCotizacionPos();
    if (!cotizacionPosVigente()) {
      return toast(cotizacionPosError || "No hay una cotización vigente para cobrar.", "err");
    }
  }
  const total = intentoCobro ? numero(intentoCobro.total) : totalCotizado();
  $("cobro-total").textContent = fmt(total);
  $("cobro-error").textContent = "";

  if (intentoCobro) {
    metodoPago = intentoCobro.body.metodo_pago;
    $("inp-recibido").value = intentoCobro.body.recibido == null ? "" : numero(intentoCobro.body.recibido).toFixed(2);
    $("cobro-error").textContent = "Este cobro quedó pendiente de confirmación. Reintenta para consultar el mismo resultado sin duplicarlo.";
  } else {
    metodoPago = "EFECTIVO";
    $("inp-recibido").value = "";
  }
  $("lbl-cambio").textContent = "$0.00";
  pintarMetodosPago();
  pintarEfectivoRapido(total);
  actualizarBloqueoCobro();
  calcularCambio();
  abrirModal("modal-cobro");
  actualizarControlesCaja();
});

function pintarMetodosPago() {
  document.querySelectorAll(".seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.metodo === metodoPago)
  );
  $("pago-efectivo").classList.toggle("hidden", metodoPago !== "EFECTIVO");
  $("pago-no-efectivo").classList.toggle("hidden", metodoPago === "EFECTIVO");
  $("nota-pago-no-efectivo").textContent = metodoPago === "TARJETA"
    ? "Confirma primero la aprobación en la terminal bancaria; la aplicación sólo registrará el método de pago."
    : metodoPago === "TRANSFERENCIA"
      ? "Verifica primero que la transferencia se haya recibido; la aplicación sólo registrará el método de pago."
      : "";
}

function pintarEfectivoRapido(total) {
  const box = $("quick-cash");
  box.replaceChildren();
  [total, 100, 200, 500].forEach((valor, indice) => {
    const boton = nodo("button", "", indice === 0 ? "Exacto" : fmt(valor));
    boton.type = "button";
    boton.dataset.v = texto(valor);
    boton.addEventListener("click", () => {
      $("inp-recibido").value = numero(valor).toFixed(2);
      calcularCambio();
      actualizarBloqueoCobro();
    });
    box.appendChild(boton);
  });
}

document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
  if (intentoCobro || cobroEnCurso) return;
  metodoPago = b.dataset.metodo;
  pintarMetodosPago();
  calcularCambio();
  actualizarBloqueoCobro();
}));

function calcularCambio() {
  const total = intentoCobro ? numero(intentoCobro.total) : totalCotizado();
  if (metodoPago !== "EFECTIVO") {
    $("lbl-cambio").textContent = fmt(0);
    $("lbl-cambio").style.color = "var(--ok)";
    return;
  }
  const recibido = leerMonto($("inp-recibido").value);
  if (!recibido.valido) {
    $("lbl-cambio").textContent = "Monto inválido";
    $("lbl-cambio").style.color = "var(--rojo)";
    return;
  }
  const diferenciaCentavos = recibido.centavos - aCentavos(total);
  $("lbl-cambio").textContent = fmt(Math.max(0, diferenciaCentavos) / 100);
  $("lbl-cambio").style.color = diferenciaCentavos < 0 ? "var(--rojo)" : "var(--ok)";
}

$("inp-recibido").addEventListener("input", () => {
  calcularCambio();
  actualizarBloqueoCobro();
});

function actualizarBloqueoCobro() {
  const datosCongelados = Boolean(intentoCobro);
  const total = datosCongelados ? numero(intentoCobro.total) : totalCotizado();
  const recibido = leerMonto($("inp-recibido").value);
  const pagoValido = datosCongelados || metodoPago !== "EFECTIVO"
    || (recibido.valido && recibido.centavos >= aCentavos(total));
  $("btn-confirmar-pago").disabled = cobroEnCurso || !pagoValido;
  $("btn-confirmar-pago").textContent = cobroEnCurso ? "Procesando…" : datosCongelados ? "Reintentar cobro" : "Confirmar pago";
  $("inp-recibido").disabled = cobroEnCurso || datosCongelados;
  document.querySelectorAll(".seg-btn, #quick-cash button").forEach((b) => {
    b.disabled = cobroEnCurso || datosCongelados;
  });
  actualizarControlesCaja();
}

function ventaResultadoValido(venta) {
  return Boolean(venta && Number.isInteger(numero(venta.id)) && numero(venta.id) > 0
    && texto(venta.folio).trim() && METODOS_PAGO.has(texto(venta.metodo_pago))
    && leerMonto(venta.total).valido && Array.isArray(venta.detalle) && venta.detalle.length);
}

function rechazoCobroDefinitivo(error) {
  if (![400, 403, 404, 409, 422].includes(numero(error && error.status, 0))) return false;
  return !(error.status === 409
    && /todavía no tiene un resultado disponible/i.test(texto(error.message)));
}

$("btn-confirmar-pago").addEventListener("click", async () => {
  if (cobroEnCurso) return;
  $("cobro-error").textContent = "";
  cobroEnCurso = true;
  actualizarBloqueoCobro();
  try {
    if (!intentoCobro) {
      if (!puedeOperarCaja()) {
        $("cobro-error").textContent = "La caja ya no está disponible para operar.";
        return;
      }
      await solicitarCotizacionPos();
      if (!cotizacionPosVigente()) {
        $("cobro-error").textContent = cotizacionPosError || "No hay una cotización vigente para cobrar.";
        return;
      }
      const total = totalCotizado();
      $("cobro-total").textContent = fmt(total);
      pintarEfectivoRapido(total);
      calcularCambio();
      actualizarBloqueoCobro();
      const body = {
        sesion_id: idSesionActual(),
        metodo_pago: metodoPago,
        items: carrito.map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
      };
      if (clienteVentaId) body.cliente_id = clienteVentaId;
      if (metodoPago === "EFECTIVO") {
        const recibido = leerMonto($("inp-recibido").value);
        if (!recibido.valido) {
          $("cobro-error").textContent = recibido.mensaje;
          return;
        }
        if (recibido.centavos < aCentavos(total)) {
          $("cobro-error").textContent = "Monto recibido insuficiente.";
          return;
        }
        body.recibido = recibido.valor;
      }
      intentoCobro = {
        clave: nuevaClaveIdempotencia(),
        body,
        total,
        carrito: carrito.map((linea) => ({ ...linea })),
        cotizacion: cotizacionPos,
        clienteVentaId,
        creadoEn: new Date().toISOString(),
      };
      guardarIntentoCobro();
    }
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), COBRO_TIMEOUT_MS);
    let venta;
    try {
      venta = await api("/ventas", {
        method: "POST",
        body: intentoCobro.body,
        headers: { "Idempotency-Key": intentoCobro.clave },
        signal: controlador.signal,
      });
    } finally {
      clearTimeout(temporizador);
    }
    if (!ventaResultadoValido(venta)) {
      throw new Error("El servidor respondió sin una venta completa; reintenta para recuperar el resultado.");
    }
    borrarIntentoCobroPersistido();
    intentoCobro = null;
    cerrarModal($("modal-cobro"), true);
    carrito = [];
    seleccionarClienteVenta(null);
    pintarCarrito();
    mostrarTicket(venta);
    const refrescos = await Promise.allSettled([cargarCaja(), cargarVentas()]);
    if (refrescos.some((resultado) => resultado.status === "rejected")) {
      toast("La venta se registró, pero una vista no pudo actualizarse. Usa Actualizar.", "err");
    }
    toast("Venta " + texto(venta.folio) + " registrada.", "ok");
  } catch (e) {
    const mensaje = e && e.name === "AbortError"
      ? "La respuesta tardó demasiado y el resultado no pudo confirmarse."
      : texto(e && e.message, "No fue posible confirmar el cobro.");
    if (intentoCobro && rechazoCobroDefinitivo(e)) {
      borrarIntentoCobroPersistido();
      intentoCobro = null;
      invalidarCotizacionPos();
      pintarCarrito();
    } else if (intentoCobro) guardarIntentoCobro();
    $("cobro-error").textContent = intentoCobro
      ? mensaje + " La clave del cobro se conservó; vuelve a intentarlo."
      : mensaje;
    if (!intentoCobro && TOKEN) await cargarCaja().catch(() => {});
  } finally {
    cobroEnCurso = false;
    actualizarBloqueoCobro();
  }
});

/* ============================================================
   TICKET SEGURO
============================================================ */
function lineaTicket(izquierda, derecha, fuerte = false) {
  const div = nodo("div", "lin");
  div.append(nodo(fuerte ? "b" : "span", "", izquierda), nodo(fuerte ? "b" : "span", "", derecha));
  return div;
}

function mostrarTicket(v) {
  $("ticket-titulo").textContent = "Ticket " + texto(v.folio);
  const body = $("ticket-body");
  body.replaceChildren();
  const cabecera = nodo("div", "c");
  cabecera.append(
    nodo("b", "", "Librería REM"), document.createElement("br"),
    document.createTextNode("Folio: " + texto(v.folio)), document.createElement("br"),
    document.createTextNode(hora(v.creado_en)), document.createElement("br"),
    document.createTextNode("Caja: " + texto(v.caja_nombre, "Caja " + texto(v.caja_id))),
    document.createElement("br"),
    document.createTextNode("Cajero: " + texto(v.cajero, "—")), document.createElement("br"),
    document.createTextNode("Cliente: " + texto(v.cliente, "PÚBLICO GENERAL"))
  );
  body.append(cabecera, document.createElement("hr"));
  let descuentoTicket = 0;
  for (const detalle of (v.detalle || [])) {
    const cantidad = numero(detalle.cantidad);
    const precioLista = numero(detalle.precio_lista, numero(detalle.precio_unitario));
    const descuentoUnitario = numero(
      detalle.descuento_unitario,
      Math.max(0, precioLista - numero(detalle.precio_unitario))
    );
    const precioFinal = numero(detalle.precio_unitario);
    descuentoTicket += descuentoUnitario * cantidad;
    body.appendChild(nodo("div", "", texto(detalle.titulo, "Producto")));
    if (descuentoUnitario > 0) {
      body.append(
        lineaTicket("  " + cantidad + " × lista " + fmt(precioLista), fmt(precioLista * cantidad)),
        lineaTicket("  Descuento", "−" + fmt(descuentoUnitario * cantidad)),
        lineaTicket("  " + cantidad + " × final " + fmt(precioFinal), fmt(detalle.importe))
      );
    } else {
      body.appendChild(lineaTicket("  " + cantidad + " × " + fmt(precioFinal), fmt(detalle.importe)));
    }
  }
  body.append(document.createElement("hr"));
  if (descuentoTicket > 0) body.appendChild(lineaTicket("Descuento total", "−" + fmt(descuentoTicket)));
  body.append(
    lineaTicket("Subtotal", fmt(v.subtotal)),
    lineaTicket("IVA", fmt(v.iva)),
    lineaTicket("TOTAL", fmt(v.total), true),
    lineaTicket("Pago (" + texto(v.metodo_pago) + ")", fmt(v.metodo_pago === "EFECTIVO" ? v.recibido : v.total))
  );
  if (v.metodo_pago === "EFECTIVO") body.appendChild(lineaTicket("Cambio", fmt(v.cambio)));
  body.append(document.createElement("hr"), nodo("div", "c", "¡Gracias por tu compra! 📖"));
  abrirModal("modal-ticket");
}

$("btn-print").addEventListener("click", () => {
  const copias = Array.from($("ticket-body").childNodes, (n) => n.cloneNode(true));
  $("print-area").replaceChildren(...copias);
  window.print();
});

/* ============================================================
   INVENTARIO
============================================================ */
let invTimer = null;

function disponibleProducto(producto) {
  return Math.max(0, numero(
    producto && (producto.stock_disponible ?? producto.disponible ?? producto.stock)
  ));
}

function normalizarExistencia(producto) {
  const fisico = numero(producto && (producto.fisico ?? producto.stock));
  const reservado = numero(producto && (producto.reservado ?? producto.stock_reservado));
  const consignado = numero(producto && (producto.consignado ?? producto.stock_consignado));
  return {
    ...producto,
    fisico,
    reservado,
    consignado,
    propiedadTotal: numero(
      producto && producto.propiedad_total,
      fisico + consignado
    ),
    disponible: numero(
      producto && (producto.disponible ?? producto.stock_disponible),
      fisico - reservado
    ),
  };
}

$("inp-inv-q").addEventListener("input", (e) => {
  clearTimeout(invTimer);
  invTimer = setTimeout(() => cargarInventario(e.target.value), 300);
});

async function cargarInventario(q) {
  const tbody = $("inv-body");
  filaVacia(tbody, 8, "Cargando existencias…");
  try {
    const res = await api("/inventario/existencias?q=" + encodeURIComponent(q || "") + "&limit=100");
    const productos = extraerLista(res, "existencias").map(normalizarExistencia);
    tbody.replaceChildren();
    for (const p of productos) {
      const tr = document.createElement("tr");
      const accionesTd = document.createElement("td");
      const acciones = nodo("div", "inv-actions");
      const kardex = nodo("button", "btn btn-outline", "Kardex");
      kardex.type = "button";
      kardex.addEventListener("click", () => abrirKardex(p));
      acciones.appendChild(kardex);
      if (esSupervisor()) {
        const politica = nodo("button", "btn btn-outline", "Política");
        politica.type = "button";
        politica.addEventListener("click", () => void abrirPoliticaReposicion(p));
        acciones.appendChild(politica);
        const ajustar = nodo("button", "btn btn-primary", "Ajustar");
        ajustar.type = "button";
        ajustar.addEventListener("click", () => abrirAjusteInventario(p));
        acciones.appendChild(ajustar);
      }
      accionesTd.appendChild(acciones);
      tr.append(
        celda(texto(p.sku)),
        celda(texto(p.titulo, "Sin título")),
        celda(p.fisico, p.fisico === 0 ? "stock-cero" : ""),
        celda(p.reservado, p.reservado > 0 ? "stock-reservado" : ""),
        celda(p.consignado, p.consignado > 0 ? "stock-reservado" : ""),
        celda(p.disponible, p.disponible === 0 ? "stock-cero" : p.disponible < 5 ? "stock-bajo" : "stock-disponible"),
        celda(p.propiedadTotal),
        accionesTd
      );
      tbody.appendChild(tr);
    }
    if (!productos.length) filaVacia(tbody, 8, "Sin resultados.");
  } catch (e) {
    filaVacia(tbody, 8, e.message);
    toast(e.message, "err");
  }
}

function pintarSaldosInventario(contenedor, producto) {
  const p = normalizarExistencia(producto);
  contenedor.replaceChildren();
  for (const [etiqueta, valor] of [
    ["Físico", p.fisico],
    ["Reservado", p.reservado],
    ["Consignado", p.consignado],
    ["Disponible", p.disponible],
    ["Total propio", p.propiedadTotal],
  ]) {
    const bloque = nodo("div", "inventario-saldo");
    bloque.append(nodo("span", "", etiqueta), nodo("b", "", valor));
    contenedor.appendChild(bloque);
  }
}

function abrirAjusteInventario(producto) {
  if (!esSupervisor()) return toast("Tu rol no permite ajustar inventario.", "err");
  const p = normalizarExistencia(producto);
  if (intentoAjuste && intentoAjuste.body.producto_id !== numero(p.id)) {
    return toast("Hay otro ajuste pendiente. Reinténtalo antes de cambiar de producto.", "err");
  }
  productoInventarioActivo = p;
  $("ajuste-inventario-titulo").textContent = "Ajustar · " + texto(p.titulo, p.sku);
  pintarSaldosInventario($("ajuste-inventario-saldos"), p);
  $("ajuste-inventario-error").textContent = "";
  if (intentoAjuste) {
    $("inp-ajuste-delta").value = texto(intentoAjuste.body.delta);
    $("inp-ajuste-motivo").value = intentoAjuste.body.motivo;
    $("ajuste-inventario-error").textContent =
      "El ajuste quedó pendiente de confirmación. Reintenta para obtener el mismo resultado sin duplicarlo.";
  } else {
    $("inp-ajuste-delta").value = "";
    $("inp-ajuste-motivo").value = "";
  }
  actualizarResultadoAjuste();
  actualizarBloqueoAjuste();
  abrirModal("modal-ajuste-inventario");
}

function actualizarResultadoAjuste() {
  if (!productoInventarioActivo) return;
  const delta = Number($("inp-ajuste-delta").value);
  const salida = $("ajuste-inventario-resultante");
  if (!Number.isInteger(delta) || delta === 0) {
    salida.textContent = "Captura un ajuste entero distinto de cero.";
    salida.className = "resultado-ajuste";
    return;
  }
  const fisico = productoInventarioActivo.fisico + delta;
  const disponible = fisico - productoInventarioActivo.reservado;
  salida.textContent = fisico < productoInventarioActivo.reservado
    ? "No es posible: el resultado afectaría unidades reservadas."
    : "Resultado: físico " + fisico + " · reservado " + productoInventarioActivo.reservado
      + " · disponible " + disponible;
  salida.className = fisico < productoInventarioActivo.reservado
    ? "resultado-ajuste resultado-invalido"
    : "resultado-ajuste resultado-valido";
}

$("inp-ajuste-delta").addEventListener("input", actualizarResultadoAjuste);

function actualizarBloqueoAjuste() {
  const congelado = Boolean(intentoAjuste);
  $("inp-ajuste-delta").disabled = ajusteEnCurso || congelado;
  $("inp-ajuste-motivo").disabled = ajusteEnCurso || congelado;
  $("btn-confirmar-ajuste").disabled = ajusteEnCurso;
  $("btn-confirmar-ajuste").textContent = ajusteEnCurso
    ? "Procesando…"
    : congelado ? "Reintentar ajuste" : "Confirmar ajuste";
}

$("btn-confirmar-ajuste").addEventListener("click", async () => {
  if (ajusteEnCurso || !productoInventarioActivo || !esSupervisor()) return;
  $("ajuste-inventario-error").textContent = "";
  if (!intentoAjuste) {
    const delta = Number($("inp-ajuste-delta").value);
    const motivo = $("inp-ajuste-motivo").value.trim();
    if (!Number.isInteger(delta) || delta === 0) {
      $("ajuste-inventario-error").textContent = "El ajuste debe ser un número entero distinto de cero.";
      return;
    }
    if (motivo.length < 3) {
      $("ajuste-inventario-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
      return;
    }
    if (productoInventarioActivo.fisico + delta < productoInventarioActivo.reservado) {
      $("ajuste-inventario-error").textContent = "El ajuste afectaría unidades reservadas.";
      return;
    }
    intentoAjuste = {
      clave: nuevaClaveIdempotencia(),
      body: { producto_id: numero(productoInventarioActivo.id), delta, motivo },
    };
  }

  ajusteEnCurso = true;
  actualizarBloqueoAjuste();
  try {
    const ajuste = await api("/inventario/ajustes", {
      method: "POST",
      body: intentoAjuste.body,
      headers: { "Idempotency-Key": intentoAjuste.clave },
    });
    productoInventarioActivo = normalizarExistencia({
      ...productoInventarioActivo,
      fisico: ajuste.stock,
      reservado: ajuste.stock_reservado,
      consignado: ajuste.stock_consignado,
      propiedad_total: numero(ajuste.stock) + numero(ajuste.stock_consignado),
      disponible: ajuste.stock_disponible,
    });
    const lineaCarrito = carrito.find(
      (linea) => numero(linea.producto_id) === numero(productoInventarioActivo.id)
    );
    if (lineaCarrito) {
      lineaCarrito.stock = Math.max(0, numero(ajuste.stock_disponible));
      invalidarCotizacionPos();
      pintarCarrito();
    }
    intentoAjuste = null;
    cerrarModal($("modal-ajuste-inventario"), true);
    toast("Inventario ajustado correctamente.", "ok");
    await cargarInventario($("inp-inv-q").value);
  } catch (e) {
    if (e.status && e.status < 500) intentoAjuste = null;
    $("ajuste-inventario-error").textContent = intentoAjuste
      ? e.message + " La clave se conservó; vuelve a intentarlo."
      : e.message;
  } finally {
    ajusteEnCurso = false;
    actualizarBloqueoAjuste();
  }
});

const etiquetasKardex = Object.freeze({
  INICIAL: "Inicial",
  AJUSTE: "Ajuste",
  VENTA: "Venta",
  CANCELACION: "Cancelación",
  DEVOLUCION: "Devolución",
  RESERVA: "Reserva",
  LIBERACION_RESERVA: "Liberación de reserva",
  EXPIRACION_RESERVA: "Expiración de reserva",
  CONSUMO_RESERVA: "Consumo de reserva",
  RECEPCION_COMPRA: "Recepción de compra",
  DEVOLUCION_PROVEEDOR: "Devolución a proveedor",
  CONTEO: "Conteo físico",
  SALIDA_CONSIGNACION: "Salida a consignación",
  VENTA_CONSIGNACION: "Venta consignada",
  DEVOLUCION_CONSIGNACION: "Devolución de consignación",
});

function referenciaKardex(movimiento) {
  if (movimiento.motivo) return texto(movimiento.motivo);
  if (movimiento.venta_id) return "Venta #" + texto(movimiento.venta_id);
  if (movimiento.cancelacion_id) return "Cancelación #" + texto(movimiento.cancelacion_id);
  if (movimiento.devolucion_id) return "Devolución #" + texto(movimiento.devolucion_id);
  return texto(movimiento.origen_clave, "—");
}

function deltaKardex(valor) {
  const delta = numero(valor);
  return { texto: delta > 0 ? "+" + delta : texto(delta), clase: delta > 0 ? "kardex-delta-pos" : delta < 0 ? "kardex-delta-neg" : "" };
}

async function abrirKardex(producto) {
  productoKardexActivo = normalizarExistencia(producto);
  kardexCursor = null;
  $("kardex-titulo").textContent = "Kardex · " + texto(producto.titulo, producto.sku);
  pintarSaldosInventario($("kardex-saldos"), productoKardexActivo);
  filaVacia($("kardex-body"), 11, "Cargando movimientos…");
  $("btn-kardex-anteriores").classList.add("hidden");
  abrirModal("modal-kardex");
  await cargarKardex({ append: false });
}

async function cargarKardex({ append = false } = {}) {
  if (kardexEnCurso || !productoKardexActivo) return;
  kardexEnCurso = true;
  const boton = $("btn-kardex-anteriores");
  boton.disabled = true;
  try {
    const cursor = append && kardexCursor ? "&cursor=" + encodeURIComponent(kardexCursor) : "";
    const res = await api(
      "/inventario/kardex?producto_id=" + encodeURIComponent(productoKardexActivo.id)
      + "&limit=100" + cursor
    );
    const movimientos = extraerLista(res, "movimientos");
    const tbody = $("kardex-body");
    if (!append) tbody.replaceChildren();
    for (const movimiento of movimientos) {
      const fisico = numero(movimiento.stock_fisico_resultante);
      const reservado = numero(movimiento.stock_reservado_resultante);
      const consignado = numero(movimiento.stock_consignado_resultante);
      const deltaFisico = deltaKardex(movimiento.delta_fisico);
      const deltaReservado = deltaKardex(movimiento.delta_reservado);
      const deltaConsignado = deltaKardex(movimiento.delta_consignado);
      const tr = document.createElement("tr");
      tr.append(
        celda(hora(movimiento.creado_en)),
        celda(etiquetasKardex[movimiento.tipo] || "Movimiento"),
        celda(deltaFisico.texto, deltaFisico.clase),
        celda(deltaReservado.texto, deltaReservado.clase),
        celda(deltaConsignado.texto, deltaConsignado.clase),
        celda(fisico),
        celda(reservado),
        celda(consignado),
        celda(fisico - reservado),
        celda(referenciaKardex(movimiento)),
        celda(texto(movimiento.usuario, texto(movimiento.actor, "Sistema")))
      );
      tbody.appendChild(tr);
    }
    if (!append && !movimientos.length) filaVacia(tbody, 11, "Sin movimientos.");
    kardexCursor = movimientos.length ? texto(movimientos[movimientos.length - 1].id) : kardexCursor;
    boton.classList.toggle("hidden", movimientos.length < 100);
  } catch (e) {
    if (!append) filaVacia($("kardex-body"), 11, e.message);
    else toast(e.message, "err");
  } finally {
    kardexEnCurso = false;
    boton.disabled = false;
  }
}

$("btn-kardex-anteriores").addEventListener("click", () => cargarKardex({ append: true }));

/* ============================================================
   REPOSICIÓN Y CONTEOS DE INVENTARIO
============================================================ */
function cambiarInventarioSeccion(nombre) {
  if (!["existencias", "reposicion", "conteos"].includes(nombre)) return;
  if (nombre !== "existencias" && !esSupervisor()) nombre = "existencias";
  inventarioSeccion = nombre;
  document.querySelectorAll(".subtab[data-inventario]").forEach((boton) => {
    boton.classList.toggle("active", boton.dataset.inventario === nombre);
  });
  document.querySelectorAll(".inventario-seccion").forEach((seccion) => {
    seccion.classList.toggle("active", seccion.id === "inventario-" + nombre);
  });
  void cargarInventarioActivo();
}

document.querySelectorAll(".subtab[data-inventario]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarInventarioSeccion(boton.dataset.inventario));
});

async function cargarInventarioActivo() {
  if (inventarioSeccion !== "existencias" && !esSupervisor()) inventarioSeccion = "existencias";
  if (inventarioSeccion === "reposicion") return cargarReposicion();
  if (inventarioSeccion === "conteos") return cargarConteosInventario();
  return cargarInventario($("inp-inv-q").value);
}

function actualizarBloqueoPoliticaReposicion() {
  const congelado = Boolean(intentoPoliticaReposicion);
  document.querySelectorAll("#form-politica-reposicion input, #form-politica-reposicion select")
    .forEach((control) => { control.disabled = politicaReposicionEnCurso || congelado; });
  $("btn-guardar-politica-reposicion").disabled = politicaReposicionEnCurso;
  $("btn-guardar-politica-reposicion").textContent = politicaReposicionEnCurso
    ? "Guardando…" : congelado ? "Reintentar guardado" : "Guardar política";
}

async function abrirPoliticaReposicion(producto) {
  if (!esSupervisor()) return;
  const productoId = numero(producto && (producto.producto_id ?? producto.id));
  if (intentoPoliticaReposicion
      && numero(intentoPoliticaReposicion.productoId) !== productoId) {
    return toast("Hay otra política pendiente de confirmación. Reinténtala primero.", "err");
  }
  try {
    if (!proveedoresOpcionesCompra.length) await cargarOpcionesProveedoresCompra();
    const politica = await api("/inventario/reposicion/productos/" + encodeURIComponent(productoId));
    politicaReposicionActiva = normalizarExistencia({ ...politica, id: politica.producto_id });
    $("politica-reposicion-titulo").textContent = "Reposición · " + texto(politica.titulo, politica.sku);
    pintarSaldosInventario($("politica-reposicion-saldos"), politicaReposicionActiva);
    actualizarSelectoresProveedoresCompra();
    const proveedorId = politica.proveedor_preferido_id == null
      ? "" : texto(politica.proveedor_preferido_id);
    if (proveedorId && !Array.from($("politica-proveedor").options).some((item) => item.value === proveedorId)) {
      const option = opcion(proveedorId, texto(politica.proveedor_preferido, "Proveedor inactivo") + " (inactivo)");
      option.disabled = true;
      $("politica-proveedor").appendChild(option);
    }
    if (intentoPoliticaReposicion) {
      const body = intentoPoliticaReposicion.body;
      $("politica-stock-minimo").value = texto(body.stock_minimo);
      $("politica-stock-objetivo").value = texto(body.stock_objetivo);
      $("politica-proveedor").value = body.proveedor_preferido_id == null
        ? "" : texto(body.proveedor_preferido_id);
      $("politica-reposicion-motivo").value = body.motivo;
      $("politica-reposicion-error").textContent =
        "El guardado quedó pendiente de confirmación; reinténtalo con la misma clave.";
    } else {
      $("politica-stock-minimo").value = texto(politica.stock_minimo, "0");
      $("politica-stock-objetivo").value = texto(politica.stock_objetivo, "0");
      $("politica-proveedor").value = proveedorId;
      $("politica-reposicion-motivo").value = "";
      $("politica-reposicion-error").textContent = "";
    }
    actualizarBloqueoPoliticaReposicion();
    abrirModal("modal-politica-reposicion");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("form-politica-reposicion").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || politicaReposicionEnCurso || !politicaReposicionActiva) return;
  $("politica-reposicion-error").textContent = "";
  if (!intentoPoliticaReposicion) {
    const minimo = Number($("politica-stock-minimo").value);
    const objetivo = Number($("politica-stock-objetivo").value);
    const proveedor = numero($("politica-proveedor").value, 0) || null;
    const motivo = $("politica-reposicion-motivo").value.trim();
    if (!Number.isInteger(minimo) || minimo < 0 || minimo > 1000000) {
      $("politica-reposicion-error").textContent = "El stock mínimo debe ser un entero entre 0 y 1,000,000.";
      return;
    }
    if (!Number.isInteger(objetivo) || objetivo < minimo || objetivo > 1000000) {
      $("politica-reposicion-error").textContent = "El objetivo debe ser entero, igual o mayor que el mínimo.";
      return;
    }
    if (motivo.length < 3) {
      $("politica-reposicion-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
      return;
    }
    intentoPoliticaReposicion = {
      productoId: numero(politicaReposicionActiva.id),
      clave: nuevaClaveIdempotencia(),
      body: {
        stock_minimo: minimo,
        stock_objetivo: objetivo,
        proveedor_preferido_id: proveedor,
        motivo,
      },
    };
  }
  politicaReposicionEnCurso = true;
  actualizarBloqueoPoliticaReposicion();
  try {
    await api(
      "/inventario/reposicion/productos/" + encodeURIComponent(intentoPoliticaReposicion.productoId),
      {
        method: "PUT",
        body: intentoPoliticaReposicion.body,
        headers: { "Idempotency-Key": intentoPoliticaReposicion.clave },
      }
    );
    intentoPoliticaReposicion = null;
    cerrarModal($("modal-politica-reposicion"), true);
    toast("Política de reposición guardada.", "ok");
    await cargarInventarioActivo();
  } catch (error) {
    if (error.status && error.status < 500) intentoPoliticaReposicion = null;
    $("politica-reposicion-error").textContent = intentoPoliticaReposicion
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    politicaReposicionEnCurso = false;
    actualizarBloqueoPoliticaReposicion();
  }
});

function sugerenciaPorProducto(productoId) {
  return sugerenciasReposicion.find((item) => numero(item.producto_id) === numero(productoId));
}

function actualizarBotonOrdenReposicion() {
  const seleccion = [...reposicionSeleccionados]
    .map(sugerenciaPorProducto)
    .filter(Boolean);
  $("btn-reposicion-crear-orden").disabled = reposicionCargaEnCurso || !seleccion.length;
  $("btn-reposicion-crear-orden").textContent = seleccion.length
    ? "Crear orden seleccionada (" + seleccion.length + ")"
    : "Crear orden seleccionada";
}

async function cargarReposicion() {
  if (!esSupervisor() || reposicionCargaEnCurso) return;
  reposicionCargaEnCurso = true;
  filaVacia($("reposicion-body"), 10, "Calculando reposición…");
  actualizarBotonOrdenReposicion();
  try {
    if (!proveedoresOpcionesCompra.length) await cargarOpcionesProveedoresCompra();
    const parametros = new URLSearchParams({
      q: $("inp-reposicion-q").value.trim(),
      solo_sugeridos: texto(!$("chk-reposicion-todas").checked),
      page: "1",
      limit: "200",
    });
    if ($("sel-reposicion-proveedor").value) {
      parametros.set("proveedor_id", $("sel-reposicion-proveedor").value);
    }
    const respuesta = await api("/inventario/reposicion/sugerencias?" + parametros.toString());
    sugerenciasReposicion = extraerLista(respuesta, "sugerencias");
    const vigentes = new Set(sugerenciasReposicion.map((item) => numero(item.producto_id)));
    reposicionSeleccionados = new Set(
      [...reposicionSeleccionados].filter((id) => vigentes.has(numero(id)))
    );
    pintarReposicion();
  } catch (error) {
    sugerenciasReposicion = [];
    reposicionSeleccionados = new Set();
    filaVacia($("reposicion-body"), 10, error.message);
    toast(error.message, "err");
  } finally {
    reposicionCargaEnCurso = false;
    actualizarBotonOrdenReposicion();
  }
}

function pintarReposicion() {
  const tbody = $("reposicion-body");
  tbody.replaceChildren();
  for (const item of sugerenciasReposicion) {
    const productoId = numero(item.producto_id);
    const cantidad = numero(item.cantidad_sugerida);
    const proveedorId = numero(item.proveedor_preferido_id, 0);
    const seleccionable = cantidad >= 1 && cantidad <= 999 && proveedorId > 0
      && item.activo !== false && item.proveedor_preferido_activo !== false;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = reposicionSeleccionados.has(productoId);
    check.disabled = !seleccionable;
    check.setAttribute("aria-label", "Seleccionar " + texto(item.titulo));
    check.title = !proveedorId
      ? "Configura un proveedor preferido."
      : item.proveedor_preferido_activo === false ? "El proveedor preferido está inactivo."
      : cantidad > 999 ? "Divide manualmente una sugerencia mayor a 999 unidades." : "";
    check.addEventListener("change", () => {
      if (!check.checked) {
        reposicionSeleccionados.delete(productoId);
      } else {
        const proveedorSeleccionado = [...reposicionSeleccionados]
          .map(sugerenciaPorProducto)
          .find(Boolean);
        if (proveedorSeleccionado
            && numero(proveedorSeleccionado.proveedor_preferido_id) !== proveedorId) {
          check.checked = false;
          toast("Selecciona productos del mismo proveedor para crear una sola orden.", "err");
        } else {
          reposicionSeleccionados.add(productoId);
        }
      }
      actualizarBotonOrdenReposicion();
    });
    const checkTd = document.createElement("td");
    checkTd.appendChild(check);
    const productoTd = document.createElement("td");
    productoTd.append(
      nodo("strong", "", texto(item.titulo)),
      nodo("small", "tabla-detalle", texto(item.editorial, "Sin editorial")
        + (item.isbn ? " · ISBN " + texto(item.isbn) : ""))
    );
    const acciones = document.createElement("td");
    const editar = nodo("button", "btn btn-outline", "Política");
    editar.type = "button";
    editar.addEventListener("click", () => void abrirPoliticaReposicion(item));
    acciones.appendChild(editar);
    const tr = document.createElement("tr");
    if (cantidad > 0) tr.classList.add("reposicion-necesaria");
    tr.append(
      checkTd,
      celda(texto(item.sku)),
      productoTd,
      celda(numero(item.disponible), numero(item.disponible) <= numero(item.stock_minimo) ? "stock-bajo" : ""),
      celda(numero(item.en_transito)),
      celda(numero(item.stock_minimo)),
      celda(numero(item.stock_objetivo)),
      celda(cantidad, cantidad > 0 ? "reposicion-cantidad" : ""),
      celda(texto(item.proveedor_preferido, "Sin configurar"), !proveedorId ? "texto-alerta" : ""),
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!sugerenciasReposicion.length) {
    filaVacia(
      tbody,
      10,
      $("chk-reposicion-todas").checked
        ? "No hay políticas de reposición para este filtro."
        : "No hay productos que requieran reposición."
    );
  }
  actualizarBotonOrdenReposicion();
}

$("form-reposicion-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarReposicion();
});
$("chk-reposicion-todas").addEventListener("change", () => void cargarReposicion());
$("sel-reposicion-proveedor").addEventListener("change", () => void cargarReposicion());
$("btn-refrescar-reposicion").addEventListener("click", () => void cargarReposicion());

$("btn-reposicion-crear-orden").addEventListener("click", async () => {
  if (!esSupervisor()) return;
  const seleccion = [...reposicionSeleccionados].map(sugerenciaPorProducto).filter(Boolean);
  if (!seleccion.length) return;
  const proveedorId = numero(seleccion[0].proveedor_preferido_id, 0);
  if (!proveedorId || seleccion.some((item) => numero(item.proveedor_preferido_id) !== proveedorId)) {
    return toast("La selección debe pertenecer a un mismo proveedor configurado.", "err");
  }
  if (seleccion.some((item) => numero(item.cantidad_sugerida) < 1
      || numero(item.cantidad_sugerida) > 999)) {
    return toast("Cada cantidad de la orden debe estar entre 1 y 999 unidades.", "err");
  }
  await abrirNuevaOrdenCompra({
    proveedorId,
    lineas: seleccion.map((item) => ({
      producto_id: numero(item.producto_id),
      sku: texto(item.sku),
      titulo: texto(item.titulo),
      cantidad: numero(item.cantidad_sugerida),
      costo_unitario: numero(item.costo),
      iva_porcentaje: numero(item.iva),
    })),
  });
});

function claseEstadoConteo(estado) {
  return "estado estado-" + texto(estado, "desconocido").toLowerCase();
}

function etiquetaEstadoConteo(estado) {
  return ({ BORRADOR: "Borrador", APLICADO: "Aplicado", CANCELADO: "Cancelado" })[estado]
    || texto(estado, "Desconocido");
}

async function cargarConteosInventario({ reiniciar = false } = {}) {
  if (!esSupervisor() || conteosCargaEnCurso) return;
  if (reiniciar) conteosPagina = 1;
  conteosCargaEnCurso = true;
  filaVacia($("conteos-body"), 7, "Cargando conteos…");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-conteo-q").value.trim(),
      page: texto(conteosPagina),
      limit: "30",
    });
    if ($("sel-conteo-estado").value) parametros.set("estado", $("sel-conteo-estado").value);
    const respuesta = await api("/inventario/conteos?" + parametros.toString());
    conteosInventario = extraerLista(respuesta, "conteos");
    conteosHaySiguiente = conteosInventario.length === 30;
    pintarConteosInventario();
  } catch (error) {
    conteosInventario = [];
    conteosHaySiguiente = false;
    filaVacia($("conteos-body"), 7, error.message);
    toast(error.message, "err");
  } finally {
    conteosCargaEnCurso = false;
    actualizarPaginacionConteos();
  }
}

function actualizarPaginacionConteos() {
  $("conteos-pagina").textContent = "Página " + conteosPagina;
  $("btn-conteos-anterior").disabled = conteosCargaEnCurso || conteosPagina <= 1;
  $("btn-conteos-siguiente").disabled = conteosCargaEnCurso || !conteosHaySiguiente;
}

function pintarConteosInventario() {
  const tbody = $("conteos-body");
  tbody.replaceChildren();
  for (const conteo of conteosInventario) {
    const estadoTd = document.createElement("td");
    estadoTd.appendChild(nodo("span", claseEstadoConteo(conteo.estado), etiquetaEstadoConteo(conteo.estado)));
    const captura = numero(conteo.capturadas) + " / " + numero(conteo.partidas);
    const acciones = document.createElement("td");
    const abrir = nodo("button", "btn btn-outline", conteo.estado === "BORRADOR" ? "Capturar" : "Ver");
    abrir.type = "button";
    abrir.addEventListener("click", () => void abrirConteoInventario(conteo.id));
    acciones.appendChild(abrir);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(conteo.folio)),
      celda(hora(conteo.creado_en)),
      celda(truncar(conteo.notas, 70) || "—"),
      celda(captura, numero(conteo.capturadas) < numero(conteo.partidas) ? "texto-alerta" : ""),
      celda(numero(conteo.diferencia_absoluta)),
      estadoTd,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!conteosInventario.length) filaVacia(tbody, 7, "No hay conteos para este filtro.");
}

$("form-conteos-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarConteosInventario({ reiniciar: true });
});
$("sel-conteo-estado").addEventListener("change", () => void cargarConteosInventario({ reiniciar: true }));
$("btn-refrescar-conteos").addEventListener("click", () => void cargarConteosInventario());
$("btn-conteos-anterior").addEventListener("click", () => {
  if (conteosPagina <= 1 || conteosCargaEnCurso) return;
  conteosPagina -= 1;
  void cargarConteosInventario();
});
$("btn-conteos-siguiente").addEventListener("click", () => {
  if (!conteosHaySiguiente || conteosCargaEnCurso) return;
  conteosPagina += 1;
  void cargarConteosInventario();
});

function pintarProductosNuevoConteo() {
  const tbody = $("nuevo-conteo-productos-body");
  tbody.replaceChildren();
  for (const producto of nuevoConteoProductos) {
    const acciones = document.createElement("td");
    const quitar = nodo("button", "btn btn-ghost", "Quitar");
    quitar.type = "button";
    quitar.disabled = creacionConteoEnCurso || Boolean(intentoCreacionConteo);
    quitar.addEventListener("click", () => {
      nuevoConteoProductos = nuevoConteoProductos.filter((item) => numero(item.id) !== numero(producto.id));
      pintarProductosNuevoConteo();
    });
    acciones.appendChild(quitar);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(producto.sku)),
      celda(texto(producto.titulo)),
      celda(numero(producto.fisico)),
      celda(numero(producto.reservado)),
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!nuevoConteoProductos.length) filaVacia(tbody, 5, "Busca y agrega los productos que vas a contar.");
  $("btn-crear-conteo").disabled = creacionConteoEnCurso
    || (!intentoCreacionConteo && !nuevoConteoProductos.length);
}

function agregarProductoNuevoConteo(producto) {
  if (creacionConteoEnCurso || intentoCreacionConteo) return;
  if (nuevoConteoProductos.some((item) => numero(item.id) === numero(producto.id))) {
    return toast("Ese producto ya está en el conteo.", "err");
  }
  if (nuevoConteoProductos.length >= 500) return toast("Un conteo admite hasta 500 productos.", "err");
  nuevoConteoProductos.push(normalizarExistencia(producto));
  $("nuevo-conteo-producto-q").value = "";
  $("nuevo-conteo-resultados").replaceChildren();
  pintarProductosNuevoConteo();
}

async function buscarProductosNuevoConteo() {
  const q = $("nuevo-conteo-producto-q").value.trim();
  const version = ++nuevoConteoProductoVersion;
  const resultados = $("nuevo-conteo-resultados");
  if (q.length < 2 || intentoCreacionConteo) {
    resultados.replaceChildren();
    return;
  }
  resultados.replaceChildren(nodo("p", "subtle", "Buscando…"));
  try {
    const respuesta = await api("/inventario/existencias?q=" + encodeURIComponent(q) + "&limit=30");
    if (version !== nuevoConteoProductoVersion) return;
    const productos = extraerLista(respuesta, "existencias").map(normalizarExistencia);
    resultados.replaceChildren();
    for (const producto of productos) {
      const tarjeta = nodo("div", "result-card");
      const info = document.createElement("div");
      info.append(
        nodo("div", "t", texto(producto.titulo)),
        nodo("div", "m", texto(producto.sku) + " · Físico " + producto.fisico
          + " · Reservado " + producto.reservado)
      );
      const agregar = nodo("button", "btn btn-outline", "Agregar");
      agregar.type = "button";
      agregar.addEventListener("click", () => agregarProductoNuevoConteo(producto));
      tarjeta.append(info, agregar);
      resultados.appendChild(tarjeta);
    }
    if (!productos.length) resultados.appendChild(nodo("p", "subtle", "Sin resultados."));
  } catch (error) {
    if (version === nuevoConteoProductoVersion) {
      resultados.replaceChildren(nodo("p", "form-error", error.message));
    }
  }
}

$("nuevo-conteo-producto-q").addEventListener("input", () => {
  clearTimeout(nuevoConteoProductoTimer);
  nuevoConteoProductoTimer = setTimeout(() => void buscarProductosNuevoConteo(), 300);
});
$("nuevo-conteo-producto-q").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") evento.preventDefault();
});

function abrirNuevoConteo() {
  if (!esSupervisor()) return;
  if (!intentoCreacionConteo) {
    nuevoConteoProductos = [];
    $("form-nuevo-conteo").reset();
    $("nuevo-conteo-resultados").replaceChildren();
    $("nuevo-conteo-error").textContent = "";
  } else {
    $("nuevo-conteo-error").textContent =
      "La creación quedó pendiente de confirmación; reinténtala con la misma clave.";
  }
  pintarProductosNuevoConteo();
  abrirModal("modal-nuevo-conteo");
}

$("btn-conteo-nuevo").addEventListener("click", abrirNuevoConteo);

function actualizarBloqueoCreacionConteo() {
  const congelado = Boolean(intentoCreacionConteo);
  $("nuevo-conteo-notas").disabled = creacionConteoEnCurso || congelado;
  $("nuevo-conteo-producto-q").disabled = creacionConteoEnCurso || congelado;
  $("btn-crear-conteo").disabled = creacionConteoEnCurso
    || (!congelado && !nuevoConteoProductos.length);
  $("btn-crear-conteo").textContent = creacionConteoEnCurso
    ? "Creando…" : congelado ? "Reintentar creación" : "Crear conteo";
  pintarProductosNuevoConteo();
}

$("form-nuevo-conteo").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || creacionConteoEnCurso) return;
  $("nuevo-conteo-error").textContent = "";
  if (!intentoCreacionConteo) {
    if (!nuevoConteoProductos.length) {
      $("nuevo-conteo-error").textContent = "Agrega al menos un producto.";
      return;
    }
    intentoCreacionConteo = {
      clave: nuevaClaveIdempotencia(),
      body: {
        producto_ids: nuevoConteoProductos.map((item) => numero(item.id)).sort((a, b) => a - b),
        notas: $("nuevo-conteo-notas").value.trim() || null,
      },
    };
  }
  creacionConteoEnCurso = true;
  actualizarBloqueoCreacionConteo();
  try {
    const conteo = await api("/inventario/conteos", {
      method: "POST",
      body: intentoCreacionConteo.body,
      headers: { "Idempotency-Key": intentoCreacionConteo.clave },
    });
    intentoCreacionConteo = null;
    cerrarModal($("modal-nuevo-conteo"), true);
    toast("Conteo " + texto(conteo.folio) + " creado.", "ok");
    await cargarConteosInventario({ reiniciar: true });
    await abrirConteoInventario(conteo.id, conteo);
  } catch (error) {
    if (error.status && error.status < 500) intentoCreacionConteo = null;
    $("nuevo-conteo-error").textContent = intentoCreacionConteo
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    creacionConteoEnCurso = false;
    actualizarBloqueoCreacionConteo();
  }
});

async function abrirConteoInventario(id, precargado = null) {
  if (!esSupervisor()) return;
  if (conteoInventarioActivo && numero(conteoInventarioActivo.id) !== numero(id)
      && (intentoCapturaConteo || intentoAplicacionConteo || intentoCancelacionConteo)) {
    return toast("Hay una operación de otro conteo pendiente de confirmación.", "err");
  }
  try {
    conteoInventarioActivo = precargado || await api("/inventario/conteos/" + encodeURIComponent(id));
    conteoCapturasSucias = new Set();
    $("conteo-operacion-motivo").value = "";
    $("conteo-error").textContent = "";
    pintarConteoInventarioActivo();
    abrirModal("modal-conteo");
  } catch (error) {
    toast(error.message, "err");
  }
}

function datoResumenConteo(etiqueta, valor) {
  const bloque = nodo("div", "resumen-dato");
  bloque.append(nodo("span", "", etiqueta), nodo("strong", "", valor));
  return bloque;
}

function detalleConteoPorId(id) {
  return (conteoInventarioActivo && conteoInventarioActivo.detalles || [])
    .find((item) => numero(item.id) === numero(id));
}

function actualizarDiferenciaCaptura(input, salida, detalle) {
  if (input.value === "") {
    salida.textContent = "—";
    salida.className = "";
    return;
  }
  const cantidad = Number(input.value);
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 1000000) {
    salida.textContent = "Inválida";
    salida.className = "texto-alerta";
    return;
  }
  const diferencia = conteoInventarioActivo && conteoInventarioActivo.estado === "APLICADO"
    && detalle.diferencia_aplicada != null
    ? numero(detalle.diferencia_aplicada)
    : conteoInventarioActivo && conteoInventarioActivo.estado === "CANCELADO"
      ? numero(detalle.diferencia_capturada)
      : cantidad - numero(detalle.stock_fisico_actual);
  salida.textContent = diferencia > 0 ? "+" + diferencia : texto(diferencia);
  salida.className = diferencia === 0 ? "" : diferencia > 0 ? "kardex-delta-pos" : "kardex-delta-neg";
  if (cantidad < numero(detalle.stock_reservado_actual)) salida.className = "texto-alerta";
}

function pintarConteoInventarioActivo() {
  const conteo = conteoInventarioActivo;
  if (!conteo) return;
  const borrador = conteo.estado === "BORRADOR";
  const detalles = Array.isArray(conteo.detalles) ? conteo.detalles : [];
  const capturadas = detalles.filter((item) => item.captura_actual_id != null).length;
  const obsoletas = borrador
    ? detalles.filter((item) => item.inventario_cambio_despues_captura).length
    : 0;
  $("conteo-modal-titulo").textContent = "Conteo " + texto(conteo.folio);
  const resumen = $("conteo-resumen");
  resumen.replaceChildren(
    datoResumenConteo("Estado", etiquetaEstadoConteo(conteo.estado)),
    datoResumenConteo("Creado", hora(conteo.creado_en)),
    datoResumenConteo("Responsable", texto(conteo.creado_por)),
    datoResumenConteo("Captura", capturadas + " / " + detalles.length)
  );
  const aviso = $("conteo-aviso");
  if (conteo.estado === "APLICADO") {
    aviso.textContent = "Aplicado " + hora(conteo.aplicado_en) + " por " + texto(conteo.aplicado_por) + ".";
  } else if (conteo.estado === "CANCELADO") {
    aviso.textContent = "Cancelado " + hora(conteo.cancelado_en) + ": " + texto(conteo.cancelacion_motivo);
  } else if (obsoletas) {
    aviso.textContent = obsoletas + " captura(s) quedaron obsoletas por movimientos posteriores. Confirma de nuevo esas cantidades antes de aplicar.";
  } else {
    aviso.textContent = "Captura sólo lo contado físicamente. Guardar no cambia existencias; Aplicar registra las diferencias en el kardex.";
  }
  if (!borrador) {
    const transicionFinal = (conteo.transiciones || []).at(-1);
    $("conteo-operacion-motivo").value = texto(
      transicionFinal && transicionFinal.motivo,
      texto(conteo.cancelacion_motivo)
    );
  }

  const tbody = $("conteo-detalles-body");
  tbody.replaceChildren();
  for (const detalle of detalles) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "1000000";
    input.step = "1";
    input.className = "inp inp-tabla conteo-cantidad";
    input.dataset.detalleId = texto(detalle.id);
    input.value = detalle.cantidad_contada == null ? "" : texto(detalle.cantidad_contada);
    input.disabled = !borrador;
    input.setAttribute("aria-label", "Cantidad contada de " + texto(detalle.producto_titulo));
    const diferenciaTd = celda("");
    actualizarDiferenciaCaptura(input, diferenciaTd, detalle);
    input.addEventListener("input", () => {
      conteoCapturasSucias.add(numero(detalle.id));
      actualizarDiferenciaCaptura(input, diferenciaTd, detalle);
      actualizarControlesConteo();
    });
    const contadoTd = document.createElement("td");
    contadoTd.appendChild(input);
    const capturaTd = document.createElement("td");
    if (detalle.captura_actual_id != null) {
      const etiquetaCaptura = conteo.estado === "APLICADO"
        ? "Aplicada"
        : conteo.estado === "CANCELADO"
          ? "Histórica"
          : detalle.inventario_cambio_despues_captura ? "Obsoleta" : "Vigente";
      capturaTd.append(
        nodo(
          "span",
          borrador && detalle.inventario_cambio_despues_captura ? "texto-alerta" : "",
          etiquetaCaptura
        ),
        nodo("small", "tabla-detalle", hora(detalle.capturado_en) + " · " + texto(detalle.capturado_por))
      );
      if (borrador) {
        const confirmar = nodo("button", "btn btn-ghost btn-mini", "Confirmar de nuevo");
        confirmar.type = "button";
        confirmar.addEventListener("click", () => {
          conteoCapturasSucias.add(numero(detalle.id));
          input.focus();
          actualizarControlesConteo();
        });
        capturaTd.appendChild(confirmar);
      }
    } else {
      capturaTd.appendChild(nodo("span", "texto-alerta", "Sin capturar"));
    }
    const productoTd = document.createElement("td");
    productoTd.append(
      nodo("strong", "", texto(detalle.producto_titulo)),
      nodo("small", "tabla-detalle", texto(detalle.producto_sku))
    );
    const tr = document.createElement("tr");
    if (borrador && detalle.inventario_cambio_despues_captura) tr.classList.add("conteo-obsoleto");
    tr.append(
      productoTd,
      celda(numero(detalle.stock_fisico_al_abrir)),
      celda(numero(detalle.stock_fisico_actual)),
      celda(numero(detalle.stock_reservado_actual), numero(detalle.stock_reservado_actual) > 0 ? "stock-reservado" : ""),
      contadoTd,
      diferenciaTd,
      capturaTd
    );
    tbody.appendChild(tr);
  }
  if (!detalles.length) filaVacia(tbody, 7, "El conteo no contiene partidas.");

  const historial = $("conteo-transiciones-body");
  historial.replaceChildren();
  for (const transicion of conteo.transiciones || []) {
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(transicion.creado_en)),
      celda(transicion.estado_anterior ? etiquetaEstadoConteo(transicion.estado_anterior) : "—"),
      celda(etiquetaEstadoConteo(transicion.estado_nuevo)),
      celda(texto(transicion.motivo)),
      celda(texto(transicion.usuario))
    );
    historial.appendChild(tr);
  }
  actualizarControlesConteo();
}

function actualizarControlesConteo() {
  const conteo = conteoInventarioActivo;
  if (!conteo) return;
  const borrador = conteo.estado === "BORRADOR";
  const operando = capturaConteoEnCurso || aplicacionConteoEnCurso || cancelacionConteoEnCurso;
  const congelado = Boolean(intentoCapturaConteo || intentoAplicacionConteo || intentoCancelacionConteo);
  document.querySelectorAll("#conteo-detalles-body input, #conteo-detalles-body button")
    .forEach((control) => { control.disabled = !borrador || operando || congelado; });
  $("conteo-operacion-motivo").disabled = !borrador || operando || congelado;
  const detalles = conteo.detalles || [];
  const listo = detalles.length > 0
    && detalles.every((item) => item.captura_actual_id != null && !item.inventario_cambio_despues_captura);
  $("btn-guardar-captura-conteo").classList.toggle("hidden", !borrador);
  $("btn-aplicar-conteo").classList.toggle("hidden", !borrador);
  $("btn-cancelar-conteo").classList.toggle("hidden", !borrador);
  $("btn-guardar-captura-conteo").disabled = !borrador || operando
    || (!intentoCapturaConteo && conteoCapturasSucias.size === 0);
  $("btn-aplicar-conteo").disabled = !borrador || operando
    || (!intentoAplicacionConteo && !listo);
  $("btn-cancelar-conteo").disabled = !borrador || operando;
  $("btn-guardar-captura-conteo").textContent = capturaConteoEnCurso
    ? "Guardando…" : intentoCapturaConteo ? "Reintentar captura" : "Guardar captura";
  $("btn-aplicar-conteo").textContent = aplicacionConteoEnCurso
    ? "Aplicando…" : intentoAplicacionConteo ? "Reintentar aplicación" : "Aplicar diferencias";
  $("btn-cancelar-conteo").textContent = cancelacionConteoEnCurso
    ? "Cancelando…" : intentoCancelacionConteo ? "Reintentar cancelación" : "Cancelar conteo";
}

function cuerpoCapturaConteo() {
  const items = [];
  for (const input of document.querySelectorAll("#conteo-detalles-body .conteo-cantidad")) {
    const detalleId = numero(input.dataset.detalleId);
    if (!conteoCapturasSucias.has(detalleId)) continue;
    const cantidad = Number(input.value);
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 1000000) {
      const detalle = detalleConteoPorId(detalleId);
      throw new Error("Revisa la cantidad de " + texto(detalle && detalle.producto_titulo, "la partida") + ".");
    }
    items.push({ detalle_conteo_id: detalleId, cantidad_contada: cantidad });
  }
  if (!items.length) throw new Error("Modifica o confirma al menos una cantidad antes de guardar.");
  items.sort((a, b) => a.detalle_conteo_id - b.detalle_conteo_id);
  return { items };
}

$("form-captura-conteo").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!conteoInventarioActivo || capturaConteoEnCurso || conteoInventarioActivo.estado !== "BORRADOR") return;
  $("conteo-error").textContent = "";
  try {
    if (!intentoCapturaConteo) {
      intentoCapturaConteo = { clave: nuevaClaveIdempotencia(), body: cuerpoCapturaConteo() };
    }
  } catch (error) {
    $("conteo-error").textContent = error.message;
    return;
  }
  capturaConteoEnCurso = true;
  actualizarControlesConteo();
  try {
    conteoInventarioActivo = await api(
      "/inventario/conteos/" + encodeURIComponent(conteoInventarioActivo.id) + "/capturas",
      {
        method: "PUT",
        body: intentoCapturaConteo.body,
        headers: { "Idempotency-Key": intentoCapturaConteo.clave },
      }
    );
    intentoCapturaConteo = null;
    conteoCapturasSucias = new Set();
    pintarConteoInventarioActivo();
    await cargarConteosInventario();
    toast("Captura guardada sin cambiar existencias.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoCapturaConteo = null;
    $("conteo-error").textContent = intentoCapturaConteo
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    capturaConteoEnCurso = false;
    actualizarControlesConteo();
  }
});

$("btn-aplicar-conteo").addEventListener("click", async () => {
  const conteo = conteoInventarioActivo;
  if (!conteo || aplicacionConteoEnCurso || conteo.estado !== "BORRADOR") return;
  $("conteo-error").textContent = "";
  if (!intentoAplicacionConteo) {
    const motivo = $("conteo-operacion-motivo").value.trim();
    if (motivo.length < 3) {
      $("conteo-error").textContent = "Escribe un motivo de al menos 3 caracteres para aplicar.";
      return;
    }
    if (!confirm("¿Aplicar todas las diferencias de " + texto(conteo.folio) + " al inventario y kardex?")) return;
    intentoAplicacionConteo = {
      clave: nuevaClaveIdempotencia(),
      body: { motivo },
    };
  }
  aplicacionConteoEnCurso = true;
  actualizarControlesConteo();
  try {
    conteoInventarioActivo = await api(
      "/inventario/conteos/" + encodeURIComponent(conteo.id) + "/aplicacion",
      {
        method: "POST",
        body: intentoAplicacionConteo.body,
        headers: { "Idempotency-Key": intentoAplicacionConteo.clave },
      }
    );
    intentoAplicacionConteo = null;
    pintarConteoInventarioActivo();
    await cargarConteosInventario();
    toast("Conteo aplicado y kardex actualizado.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoAplicacionConteo = null;
    $("conteo-error").textContent = intentoAplicacionConteo
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
    if (error.status === 409) {
      try {
        conteoInventarioActivo = await api("/inventario/conteos/" + encodeURIComponent(conteo.id));
        pintarConteoInventarioActivo();
      } catch { /* El error original ya está visible. */ }
    }
  } finally {
    aplicacionConteoEnCurso = false;
    actualizarControlesConteo();
  }
});

$("btn-cancelar-conteo").addEventListener("click", async () => {
  const conteo = conteoInventarioActivo;
  if (!conteo || cancelacionConteoEnCurso || conteo.estado !== "BORRADOR") return;
  $("conteo-error").textContent = "";
  if (!intentoCancelacionConteo) {
    const motivo = $("conteo-operacion-motivo").value.trim();
    if (motivo.length < 3) {
      $("conteo-error").textContent = "Escribe un motivo de al menos 3 caracteres para cancelar.";
      return;
    }
    if (!confirm("¿Cancelar " + texto(conteo.folio) + " sin aplicar ninguna diferencia?")) return;
    intentoCancelacionConteo = { clave: nuevaClaveIdempotencia(), body: { motivo } };
  }
  cancelacionConteoEnCurso = true;
  actualizarControlesConteo();
  try {
    conteoInventarioActivo = await api(
      "/inventario/conteos/" + encodeURIComponent(conteo.id) + "/cancelacion",
      {
        method: "POST",
        body: intentoCancelacionConteo.body,
        headers: { "Idempotency-Key": intentoCancelacionConteo.clave },
      }
    );
    intentoCancelacionConteo = null;
    pintarConteoInventarioActivo();
    await cargarConteosInventario();
    toast("Conteo cancelado sin modificar existencias.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoCancelacionConteo = null;
    $("conteo-error").textContent = intentoCancelacionConteo
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    cancelacionConteoEnCurso = false;
    actualizarControlesConteo();
  }
});

/* ============================================================
   PEDIDOS OMNICANAL Y COBRO EN CAJA
============================================================ */
const PEDIDOS_POR_PAGINA = 30;

function pedidoVencido(pedido) {
  if (!pedido || !["RESERVADO", "LISTO"].includes(texto(pedido.estado).toUpperCase())) return false;
  if (pedido.vencido === true) return true;
  const fecha = new Date(pedido.expira_en);
  return !Number.isNaN(fecha.getTime()) && fecha.getTime() <= Date.now();
}

function pedidoCobrable(pedido) {
  return Boolean(pedido
    && ["RESERVADO", "LISTO"].includes(texto(pedido.estado).toUpperCase())
    && !pedidoVencido(pedido));
}

function rotuloEstadoPedido(pedido) {
  return pedidoVencido(pedido) ? "RESERVA VENCIDA" : texto(pedido && pedido.estado, "—").replaceAll("_", " ");
}

function actualizarPaginacionPedidos() {
  $("pedidos-pagina").textContent = "Página " + pedidosPagina;
  $("btn-pedidos-anterior").disabled = pedidosCargaEnCurso || pedidosPagina <= 1;
  $("btn-pedidos-siguiente").disabled = pedidosCargaEnCurso || !pedidosHaySiguiente;
  $("btn-refrescar-pedidos").disabled = pedidosCargaEnCurso;
}

function pintarPedidos() {
  const tbody = $("pedidos-body");
  tbody.replaceChildren();
  for (const pedido of pedidos) {
    const tr = document.createElement("tr");
    const fechaTd = celda(hora(pedido.creado_en));
    fechaTd.appendChild(nodo("small", "tabla-detalle", "Reserva hasta " + hora(pedido.expira_en)));

    const clienteTd = celda(texto(pedido.cliente_nombre, "—"));
    clienteTd.appendChild(nodo("small", "tabla-detalle", texto(pedido.cliente_telefono, "Sin teléfono")));

    const estadoTd = document.createElement("td");
    const clase = pedidoVencido(pedido) ? claseEstado("EXPIRADO") : claseEstado(pedido.estado);
    estadoTd.appendChild(nodo("span", clase, rotuloEstadoPedido(pedido)));

    const accionTd = document.createElement("td");
    const ver = nodo("button", "btn btn-outline", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => abrirPedido(pedido.id));
    accionTd.appendChild(ver);

    tr.append(
      celda(texto(pedido.folio)), fechaTd,
      celda(texto(pedido.canal).toUpperCase() === "WEB" ? "Tienda" : "POS"),
      clienteTd,
      celda(texto(pedido.tipo_entrega).toUpperCase() === "ENVIO" ? "Envío" : "Recolección"),
      celda(fmt(pedido.total)), estadoTd, accionTd
    );
    tbody.appendChild(tr);
  }
  if (!pedidos.length) filaVacia(tbody, 8, "No hay pedidos con estos filtros.");
}

async function cargarPedidos({ reiniciar = false } = {}) {
  if (pedidosCargaEnCurso) return;
  if (reiniciar) pedidosPagina = 1;
  pedidosCargaEnCurso = true;
  actualizarPaginacionPedidos();
  filaVacia($("pedidos-body"), 8, "Cargando pedidos…");
  try {
    const params = new URLSearchParams({
      q: $("inp-pedido-q").value.trim(),
      page: texto(pedidosPagina),
      limit: texto(PEDIDOS_POR_PAGINA),
    });
    const estado = $("sel-pedido-estado").value;
    if (estado) params.set("estado", estado);
    const respuesta = await api("/pedidos?" + params.toString());
    pedidos = extraerLista(respuesta, "pedidos");
    pedidosHaySiguiente = pedidos.length === PEDIDOS_POR_PAGINA;
    pintarPedidos();
  } catch (e) {
    pedidos = [];
    pedidosHaySiguiente = false;
    filaVacia($("pedidos-body"), 8, e.message);
  } finally {
    pedidosCargaEnCurso = false;
    actualizarPaginacionPedidos();
  }
}

$("form-pedidos-filtros").addEventListener("submit", (e) => {
  e.preventDefault();
  void cargarPedidos({ reiniciar: true });
});
$("btn-refrescar-pedidos").addEventListener("click", () => void cargarPedidos());
$("btn-pedidos-anterior").addEventListener("click", () => {
  if (pedidosPagina <= 1 || pedidosCargaEnCurso) return;
  pedidosPagina--;
  void cargarPedidos();
});
$("btn-pedidos-siguiente").addEventListener("click", () => {
  if (!pedidosHaySiguiente || pedidosCargaEnCurso) return;
  pedidosPagina++;
  void cargarPedidos();
});

function intentoPerteneceAPedido(intento, id) {
  return Boolean(intento && numero(intento.pedidoId) === numero(id));
}

async function abrirPedido(id) {
  if (pedidoAccionEnCurso || cobroPedidoEnCurso) return;
  if ((intentoPedidoAccion && !intentoPerteneceAPedido(intentoPedidoAccion, id))
      || (intentoCobroPedido && !intentoPerteneceAPedido(intentoCobroPedido, id))) {
    toast("Hay una operación pendiente. Reabre ese pedido para reintentarla con la misma clave.", "err");
    return;
  }
  try {
    pedidoActivo = await api("/pedidos/" + encodeURIComponent(id));
    $("pedido-error").textContent = "";
    if (intentoPedidoAccion && intentoPedidoAccion.tipo === "cancelacion") {
      $("inp-pedido-motivo").value = texto(intentoPedidoAccion.body.motivo);
    } else if (!intentoPedidoAccion) {
      $("inp-pedido-motivo").value = "";
    }
    if (intentoCobroPedido) {
      $("sel-pedido-metodo").value = intentoCobroPedido.body.metodo_pago;
      $("inp-pedido-recibido").value = intentoCobroPedido.body.recibido == null
        ? "" : numero(intentoCobroPedido.body.recibido).toFixed(2);
    } else {
      $("sel-pedido-metodo").value = "EFECTIVO";
      $("inp-pedido-recibido").value = "";
    }
    pintarPedidoActivo();
    abrirModal("modal-pedido");
  } catch (e) {
    toast(e.message, "err");
  }
}

function bloqueDatoPedido(etiqueta, valor) {
  const bloque = document.createElement("div");
  bloque.append(nodo("span", "", etiqueta), nodo("strong", "", valor));
  return bloque;
}

function enlaceWhatsappCliente(pedido) {
  const telefono = texto(pedido && pedido.cliente_telefono).replace(/[^0-9]/g, "");
  if (!/^[0-9]{8,15}$/.test(telefono)) return null;
  const mensaje = [
    "Hola " + texto(pedido.cliente_nombre, "cliente") + ",",
    "Librería REM te informa que tu pedido " + texto(pedido.folio)
      + " está " + rotuloEstadoPedido(pedido).toLowerCase() + ".",
    "Total: " + fmt(pedido.total) + ".",
  ].join(" ");
  return "https://wa.me/" + telefono + "?text=" + encodeURIComponent(mensaje);
}

function pintarPedidoActivo() {
  if (!pedidoActivo) return;
  $("pedido-modal-titulo").textContent = "Pedido " + texto(pedidoActivo.folio);
  const resumen = $("pedido-resumen");
  resumen.replaceChildren(
    bloqueDatoPedido("Estado", rotuloEstadoPedido(pedidoActivo)),
    bloqueDatoPedido("Canal", texto(pedidoActivo.canal).toUpperCase() === "WEB" ? "Tienda en línea" : "POS"),
    bloqueDatoPedido("Entrega", texto(pedidoActivo.tipo_entrega).toUpperCase() === "ENVIO" ? "Envío" : "Recolección"),
    bloqueDatoPedido("Total", fmt(pedidoActivo.total)),
    bloqueDatoPedido("Creado", hora(pedidoActivo.creado_en)),
    bloqueDatoPedido("Reserva hasta", hora(pedidoActivo.expira_en)),
    bloqueDatoPedido("Precio", texto(pedidoActivo.canal_precio, "—")),
    bloqueDatoPedido("Creado por", texto(pedidoActivo.creado_por, pedidoActivo.canal === "WEB" ? "Tienda" : "—"))
  );

  const contacto = $("pedido-contacto");
  contacto.replaceChildren();
  const datosContacto = [
    ["Cliente", pedidoActivo.cliente_nombre],
    ["Teléfono", pedidoActivo.cliente_telefono],
    ["Correo", pedidoActivo.cliente_email],
    ["Dirección", pedidoActivo.cliente_direccion],
  ];
  for (const [etiqueta, valor] of datosContacto) {
    if (!valor) continue;
    const dato = document.createElement("span");
    dato.append(nodo("strong", "", etiqueta + ": "), document.createTextNode(texto(valor)));
    contacto.appendChild(dato);
  }
  const whatsappCliente = $("pedido-whatsapp-cliente");
  const whatsappHref = enlaceWhatsappCliente(pedidoActivo);
  whatsappCliente.classList.toggle("hidden", !whatsappHref);
  if (whatsappHref) whatsappCliente.href = whatsappHref;
  else whatsappCliente.removeAttribute("href");

  const notas = $("pedido-notas");
  notas.textContent = pedidoActivo.notas ? "Notas: " + texto(pedidoActivo.notas) : "";
  notas.classList.toggle("hidden", !pedidoActivo.notas);

  const detalleBody = $("pedido-detalle-body");
  detalleBody.replaceChildren();
  const detalles = Array.isArray(pedidoActivo.detalle) ? pedidoActivo.detalle : [];
  for (const detalle of detalles) {
    const productoTd = celda(texto(detalle.producto_sku, "—"));
    productoTd.appendChild(nodo("small", "tabla-detalle", texto(detalle.producto_titulo, "Producto")));
    const reservaTd = document.createElement("td");
    reservaTd.appendChild(nodo("span", claseEstado(detalle.reserva_estado), texto(detalle.reserva_estado, "—")));
    const tr = document.createElement("tr");
    tr.append(
      productoTd, celda(numero(detalle.cantidad)), celda(fmt(detalle.precio_lista)),
      celda(fmt(numero(detalle.descuento_unitario) * numero(detalle.cantidad)), "precio-descuento"),
      celda(fmt(detalle.precio_unitario)), celda(fmt(detalle.importe)), reservaTd
    );
    detalleBody.appendChild(tr);
  }
  if (!detalles.length) filaVacia(detalleBody, 7, "El pedido no tiene detalle.");

  const historial = $("pedido-transiciones-body");
  historial.replaceChildren();
  const transiciones = Array.isArray(pedidoActivo.transiciones) ? pedidoActivo.transiciones : [];
  for (const transicion of transiciones) {
    const cambio = transicion.estado_anterior
      ? texto(transicion.estado_anterior) + " → " + texto(transicion.estado_nuevo)
      : texto(transicion.estado_nuevo);
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(transicion.creado_en)), celda(cambio), celda(texto(transicion.motivo)),
      celda(texto(transicion.usuario, texto(transicion.actor, "Sistema")))
    );
    historial.appendChild(tr);
  }
  if (!transiciones.length) filaVacia(historial, 4, "Sin cambios registrados.");
  actualizarControlesPedido();
}

function actualizarControlesPedido() {
  if (!pedidoActivo) return;
  const estado = texto(pedidoActivo.estado).toUpperCase();
  const vencido = pedidoVencido(pedidoActivo);
  const intentoAccion = intentoPerteneceAPedido(intentoPedidoAccion, pedidoActivo.id)
    ? intentoPedidoAccion : null;
  const intentoCobro = intentoPerteneceAPedido(intentoCobroPedido, pedidoActivo.id)
    ? intentoCobroPedido : null;
  const reintentoListo = intentoAccion && intentoAccion.tipo === "listo";
  const reintentoCancelacion = intentoAccion && intentoAccion.tipo === "cancelacion";
  const autorizado = esSupervisor();

  $("pedido-gestion").classList.toggle("hidden", !autorizado);
  $("btn-pedido-listo").disabled = !autorizado || pedidoAccionEnCurso || cobroPedidoEnCurso
    || Boolean(intentoCobro) || Boolean(intentoAccion && !reintentoListo)
    || (!reintentoListo && (estado !== "RESERVADO" || vencido));
  $("btn-pedido-cancelar").disabled = !autorizado || pedidoAccionEnCurso || cobroPedidoEnCurso
    || Boolean(intentoCobro) || Boolean(intentoAccion && !reintentoCancelacion)
    || (!reintentoCancelacion && !["RESERVADO", "LISTO"].includes(estado));
  $("btn-pedido-listo").textContent = pedidoAccionEnCurso && reintentoListo
    ? "Procesando…" : reintentoListo ? "Reintentar marcado" : "Marcar listo";
  $("btn-pedido-cancelar").textContent = pedidoAccionEnCurso && reintentoCancelacion
    ? "Procesando…" : reintentoCancelacion ? "Reintentar cancelación" : "Cancelar pedido";
  $("inp-pedido-motivo").disabled = pedidoAccionEnCurso || Boolean(intentoAccion)
    || Boolean(intentoCobro);

  const metodo = intentoCobro ? intentoCobro.body.metodo_pago : $("sel-pedido-metodo").value;
  $("pedido-pago-efectivo").classList.toggle("hidden", metodo !== "EFECTIVO");
  const sesionExacta = !intentoCobro
    || (numero(intentoCobro.body.sesion_id) === idSesionActual() && puedeOperarCaja());
  const puedeIniciarCobro = pedidoCobrable(pedidoActivo) && puedeOperarCaja();
  $("btn-cobrar-pedido").disabled = cobroPedidoEnCurso || pedidoAccionEnCurso
    || Boolean(intentoAccion) || (intentoCobro ? !sesionExacta : !puedeIniciarCobro);
  $("btn-cobrar-pedido").textContent = cobroPedidoEnCurso
    ? "Procesando…" : intentoCobro ? "Reintentar cobro" : "Cobrar pedido";
  $("sel-pedido-metodo").disabled = cobroPedidoEnCurso || Boolean(intentoCobro)
    || Boolean(intentoAccion);
  $("inp-pedido-recibido").disabled = cobroPedidoEnCurso || Boolean(intentoCobro)
    || Boolean(intentoAccion);

  const caja = cajaSeleccionada();
  $("pedido-caja-aviso").textContent = puedeOperarCaja()
    ? nombreCaja(caja) + " · sesión " + idSesionActual()
    : "Selecciona una caja abierta que tu usuario pueda operar.";

  let aviso = "";
  if (intentoAccion) aviso = "La acción quedó pendiente de confirmación. Reinténtala para consultar el mismo resultado sin duplicarla.";
  else if (intentoCobro) aviso = sesionExacta
    ? "El cobro quedó pendiente de confirmación. Reinténtalo con la misma caja para recuperar el resultado sin cobrar dos veces."
    : "Vuelve a seleccionar la sesión de caja original para reintentar este cobro pendiente.";
  else if (vencido) aviso = "La reserva venció y ya no puede prepararse ni cobrarse; un supervisor puede cancelarla para liberar existencias.";
  else if (!["RESERVADO", "LISTO"].includes(estado)) aviso = "Este pedido ya no tiene una reserva activa para cobrar.";
  else if (!puedeOperarCaja()) aviso = "Abre o selecciona una caja propia para cobrar el pedido.";
  $("pedido-operacion-aviso").textContent = aviso;
  $("pedido-operacion-aviso").classList.toggle("hidden", !aviso);
  calcularCambioPedido();
}

function calcularCambioPedido() {
  if (!pedidoActivo) return;
  const metodo = intentoCobroPedido && intentoPerteneceAPedido(intentoCobroPedido, pedidoActivo.id)
    ? intentoCobroPedido.body.metodo_pago : $("sel-pedido-metodo").value;
  const salida = $("pedido-cambio");
  if (metodo !== "EFECTIVO") {
    salida.textContent = "Total a cobrar: " + fmt(pedidoActivo.total);
    salida.className = "resultado-ajuste";
    return;
  }
  const valor = $("inp-pedido-recibido").value.trim();
  if (!valor) {
    salida.textContent = "Total a cobrar: " + fmt(pedidoActivo.total);
    salida.className = "resultado-ajuste";
    return;
  }
  const diferencia = numero(valor) - numero(pedidoActivo.total);
  salida.textContent = diferencia >= 0 ? "Cambio: " + fmt(diferencia) : "Faltan: " + fmt(-diferencia);
  salida.className = "resultado-ajuste " + (diferencia >= 0 ? "resultado-valido" : "resultado-invalido");
}

$("sel-pedido-metodo").addEventListener("change", actualizarControlesPedido);
$("inp-pedido-recibido").addEventListener("input", calcularCambioPedido);
$("btn-pedido-listo").addEventListener("click", () => void ejecutarAccionPedido("listo"));
$("btn-pedido-cancelar").addEventListener("click", () => void ejecutarAccionPedido("cancelacion"));

async function ejecutarAccionPedido(tipo) {
  if (!pedidoActivo || !esSupervisor() || pedidoAccionEnCurso) return;
  if (intentoPedidoAccion && (!intentoPerteneceAPedido(intentoPedidoAccion, pedidoActivo.id)
      || intentoPedidoAccion.tipo !== tipo)) {
    $("pedido-error").textContent = "Primero reintenta la operación pendiente.";
    return;
  }
  if (!intentoPedidoAccion) {
    let body = {};
    if (tipo === "listo") {
      if (texto(pedidoActivo.estado).toUpperCase() !== "RESERVADO") return;
      if (pedidoVencido(pedidoActivo)) {
        $("pedido-error").textContent = "La reserva del pedido ya venció.";
        return;
      }
      if (!confirm("¿Marcar este pedido como listo para entrega?")) return;
    } else {
      if (!["RESERVADO", "LISTO"].includes(texto(pedidoActivo.estado).toUpperCase())) return;
      const motivo = $("inp-pedido-motivo").value.trim();
      if (motivo.length < 3) {
        $("pedido-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
        return;
      }
      if (!confirm("¿Cancelar el pedido y liberar toda su reserva?")) return;
      body = { motivo };
    }
    intentoPedidoAccion = {
      pedidoId: numero(pedidoActivo.id), tipo,
      clave: nuevaClaveIdempotencia(), body,
    };
  }

  pedidoAccionEnCurso = true;
  $("pedido-error").textContent = "";
  actualizarControlesPedido();
  try {
    const sufijo = tipo === "listo" ? "/listo" : "/cancelacion";
    const actualizado = await api("/pedidos/" + encodeURIComponent(pedidoActivo.id) + sufijo, {
      method: "POST",
      body: intentoPedidoAccion.body,
      headers: { "Idempotency-Key": intentoPedidoAccion.clave },
    });
    intentoPedidoAccion = null;
    pedidoActivo = actualizado;
    pintarPedidoActivo();
    await cargarPedidos();
    toast(tipo === "listo" ? "Pedido marcado como listo." : "Pedido cancelado y reserva liberada.", "ok");
  } catch (e) {
    if (e.status && e.status < 500) intentoPedidoAccion = null;
    $("pedido-error").textContent = intentoPedidoAccion
      ? e.message + " La clave se conservó; vuelve a intentarlo."
      : e.message;
  } finally {
    pedidoAccionEnCurso = false;
    actualizarControlesPedido();
    actualizarControlesCaja();
  }
}

$("btn-cobrar-pedido").addEventListener("click", async () => {
  if (!pedidoActivo || cobroPedidoEnCurso) return;
  $("pedido-error").textContent = "";
  if (intentoCobroPedido && !intentoPerteneceAPedido(intentoCobroPedido, pedidoActivo.id)) {
    $("pedido-error").textContent = "Primero reintenta el cobro pendiente.";
    return;
  }
  if (!intentoCobroPedido) {
    if (!pedidoCobrable(pedidoActivo)) {
      $("pedido-error").textContent = "El pedido no tiene una reserva vigente para cobrar.";
      return;
    }
    if (!puedeOperarCaja()) {
      $("pedido-error").textContent = "Selecciona una caja abierta que tu usuario pueda operar.";
      return;
    }
    const metodo = $("sel-pedido-metodo").value;
    const body = { sesion_id: idSesionActual(), metodo_pago: metodo };
    if (metodo === "EFECTIVO") {
      const recibido = numero($("inp-pedido-recibido").value, -1);
      if (recibido < numero(pedidoActivo.total)) {
        $("pedido-error").textContent = "Monto recibido insuficiente.";
        return;
      }
      body.recibido = recibido;
    }
    if (!confirm("¿Cobrar " + fmt(pedidoActivo.total) + " del pedido " + texto(pedidoActivo.folio) + "?")) return;
    intentoCobroPedido = {
      pedidoId: numero(pedidoActivo.id),
      clave: nuevaClaveIdempotencia(),
      body,
    };
  }

  cobroPedidoEnCurso = true;
  actualizarControlesPedido();
  actualizarControlesCaja();
  try {
    const venta = await api("/ventas/desde-pedido/" + encodeURIComponent(pedidoActivo.id), {
      method: "POST",
      body: intentoCobroPedido.body,
      headers: { "Idempotency-Key": intentoCobroPedido.clave },
    });
    intentoCobroPedido = null;
    const folioPedido = texto(pedidoActivo.folio);
    pedidoActivo = null;
    cerrarModal($("modal-pedido"), true);
    mostrarTicket(venta);
    const refrescos = await Promise.allSettled([cargarCaja(), cargarPedidos(), cargarVentas()]);
    if (refrescos.some((resultado) => resultado.status === "rejected")) {
      toast("El cobro se registró, pero una vista no pudo actualizarse. Usa Actualizar.", "err");
    }
    toast("Pedido " + folioPedido + " cobrado en la venta " + texto(venta.folio) + ".", "ok");
  } catch (e) {
    if (e.status && e.status < 500) intentoCobroPedido = null;
    $("pedido-error").textContent = intentoCobroPedido
      ? e.message + " La clave del cobro se conservó; vuelve a intentarlo."
      : e.message;
    if (!intentoCobroPedido) await cargarCaja().catch(() => {});
  } finally {
    cobroPedidoEnCurso = false;
    if (pedidoActivo) actualizarControlesPedido();
    actualizarControlesCaja();
  }
});

/* ============================================================
   VENTAS RECIENTES, CANCELACIÓN Y DEVOLUCIÓN
============================================================ */
$("btn-refrescar-ventas").addEventListener("click", () => cargarVentas());

async function cargarVentas() {
  const tbody = $("ventas-body");
  filaVacia(tbody, 7, "Cargando ventas…");
  try {
    const res = await api("/ventas");
    const ventas = extraerLista(res, "ventas");
    tbody.replaceChildren();
    for (const venta of ventas) {
      const tr = document.createElement("tr");
      const estado = texto(venta.estado, "—");
      const estadoTd = document.createElement("td");
      estadoTd.appendChild(nodo("span", claseEstado(estado), estado.replaceAll("_", " ")));
      const accionTd = document.createElement("td");
      const ver = nodo("button", "btn btn-outline", "Ver");
      ver.type = "button";
      ver.addEventListener("click", () => abrirVenta(venta.id));
      accionTd.appendChild(ver);
      tr.append(
        celda(texto(venta.folio)), celda(hora(venta.creado_en)),
        celda(texto(venta.caja_nombre, "Caja " + texto(venta.caja_id))),
        celda(texto(venta.cajero, "—")), celda(fmt(venta.total)), estadoTd, accionTd
      );
      tbody.appendChild(tr);
    }
    if (!ventas.length) filaVacia(tbody, 7, "No hay ventas registradas.");
  } catch (e) {
    filaVacia(tbody, 7, e.message);
  }
}

function claseEstado(estado) {
  return "estado estado-" + texto(estado, "desconocido").toLowerCase().replaceAll("_", "-").replace(/[^a-z-]/g, "");
}

async function abrirVenta(id) {
  try {
    ventaActiva = await api("/ventas/" + encodeURIComponent(id));
    intentoPostventa = null;
    $("inp-postventa-motivo").value = "";
    $("postventa-error").textContent = "";
    pintarVentaActiva();
    abrirModal("modal-venta");
  } catch (e) { toast(e.message, "err"); }
}

function disponibleDetalle(detalle) {
  if (detalle.disponible_devolver != null) return Math.max(0, numero(detalle.disponible_devolver));
  return Math.max(0, numero(detalle.cantidad) - numero(detalle.devuelto));
}

function pintarVentaActiva() {
  if (!ventaActiva) return;
  $("venta-modal-titulo").textContent = "Venta " + texto(ventaActiva.folio);
  const resumen = $("venta-resumen");
  resumen.replaceChildren();
  const datos = [
    ["Estado", texto(ventaActiva.estado).replaceAll("_", " ")],
    ["Caja", texto(ventaActiva.caja_nombre, "Caja " + texto(ventaActiva.caja_id))],
    ["Cajero", texto(ventaActiva.cajero, "—")],
    ["Fecha", hora(ventaActiva.creado_en)],
    ["Total", fmt(ventaActiva.total)],
  ];
  for (const [etiqueta, valor] of datos) {
    const span = document.createElement("span");
    span.append(nodo("strong", "", etiqueta + ": "), document.createTextNode(valor));
    resumen.appendChild(span);
  }

  const autorizado = esSupervisor();
  $("th-devolver").classList.toggle("hidden", !autorizado);
  $("postventa-controles").classList.toggle("hidden", !autorizado);
  $("btn-cancelar-registrada").classList.toggle("hidden", !autorizado);
  $("btn-devolver").classList.toggle("hidden", !autorizado);

  const tbody = $("venta-detalle-body");
  tbody.replaceChildren();
  const detalles = ventaActiva.detalle || [];
  for (const detalle of detalles) {
    const disponible = disponibleDetalle(detalle);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(detalle.titulo, "Producto")), celda(numero(detalle.cantidad)),
      celda(numero(detalle.devuelto)), celda(disponible)
    );
    const devolverTd = document.createElement("td");
    devolverTd.classList.toggle("hidden", !autorizado);
    if (autorizado) {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "inp dev-cantidad";
      input.min = "0";
      input.max = texto(disponible);
      input.step = "1";
      input.value = "0";
      input.disabled = disponible <= 0;
      input.dataset.detalleId = texto(detalle.id || detalle.detalle_venta_id);
      devolverTd.appendChild(input);
    }
    tr.appendChild(devolverTd);
    tbody.appendChild(tr);
  }
  if (!detalles.length) filaVacia(tbody, autorizado ? 5 : 4, "La venta no tiene detalle.");

  const estado = texto(ventaActiva.estado).toUpperCase();
  const sinDevoluciones = detalles.every((d) => numero(d.devuelto) === 0);
  const tieneDisponible = detalles.some((d) => disponibleDetalle(d) > 0);
  const operable = puedeOperarCaja();
  $("btn-cancelar-registrada").disabled =
    !(autorizado && operable && estado === "COMPLETADA" && sinDevoluciones) || postventaEnCurso;
  $("btn-devolver").disabled =
    !(autorizado && operable && !["CANCELADA", "DEVUELTA"].includes(estado) && tieneDisponible) || postventaEnCurso;
  $("postventa-ayuda").textContent = !autorizado
    ? "Solo ADMIN o SUPERVISOR pueden cancelar o devolver."
    : !operable
      ? "Selecciona una caja abierta que puedas operar para registrar la reversión."
      : "La cancelación revierte toda la venta; la devolución usa únicamente las cantidades indicadas.";
  actualizarBloqueoPostventa();
}

function actualizarBloqueoPostventa() {
  const congelado = Boolean(intentoPostventa);
  $("inp-postventa-motivo").disabled = postventaEnCurso || congelado;
  document.querySelectorAll(".dev-cantidad").forEach((input) => {
    input.disabled = postventaEnCurso || congelado || numero(input.max) <= 0;
  });
  $("sel-caja").disabled = !cajas.length || cobroEnCurso || postventaEnCurso;
  if (intentoPostventa) {
    $("btn-cancelar-registrada").disabled = postventaEnCurso || intentoPostventa.tipo !== "cancelacion";
    $("btn-devolver").disabled = postventaEnCurso || intentoPostventa.tipo !== "devolucion";
    $("postventa-ayuda").textContent = "La operación quedó pendiente de confirmación. Reintenta para obtener el mismo resultado sin duplicarla.";
  }
}

$("btn-cancelar-registrada").addEventListener("click", async () => {
  if (!ventaActiva || !esSupervisor()) return;
  const motivo = $("inp-postventa-motivo").value.trim();
  if (!intentoPostventa && motivo.length < 3) {
    $("postventa-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
    return;
  }
  if (!intentoPostventa && !confirm("¿Cancelar por completo esta venta y revertir inventario y caja?")) return;
  await ejecutarPostventa("cancelacion", { sesion_id: idSesionActual(), motivo });
});

$("btn-devolver").addEventListener("click", async () => {
  if (!ventaActiva || !esSupervisor()) return;
  const motivo = $("inp-postventa-motivo").value.trim();
  const capturas = Array.from(document.querySelectorAll(".dev-cantidad"))
    .map((input) => ({
      detalle_venta_id: numero(input.dataset.detalleId),
      cantidad: numero(input.value),
      disponible: numero(input.max),
    }));
  if (!intentoPostventa && capturas.some((item) =>
    item.cantidad < 0 || !Number.isInteger(item.cantidad) || item.cantidad > item.disponible
  )) {
    $("postventa-error").textContent = "Las cantidades deben ser enteras y no superar lo disponible.";
    return;
  }
  const items = capturas
    .filter((item) => item.detalle_venta_id > 0 && item.cantidad > 0);
  if (!intentoPostventa && motivo.length < 3) {
    $("postventa-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
    return;
  }
  if (!intentoPostventa && !items.length) {
    $("postventa-error").textContent = "Indica al menos una cantidad a devolver.";
    return;
  }
  await ejecutarPostventa("devolucion", { sesion_id: idSesionActual(), motivo, items });
});

async function ejecutarPostventa(tipo, bodyNuevo) {
  if (postventaEnCurso) return;
  if (!puedeOperarCaja()) {
    $("postventa-error").textContent = "La caja seleccionada ya no está disponible para operar.";
    return;
  }
  if (!intentoPostventa) {
    intentoPostventa = { tipo, clave: nuevaClaveIdempotencia(), body: bodyNuevo };
  } else if (intentoPostventa.tipo !== tipo) {
    $("postventa-error").textContent = "Primero reintenta la operación pendiente.";
    return;
  }

  postventaEnCurso = true;
  $("postventa-error").textContent = "";
  actualizarBloqueoPostventa();
  try {
    const sufijo = tipo === "cancelacion" ? "/cancelacion" : "/devoluciones";
    await api("/ventas/" + encodeURIComponent(ventaActiva.id) + sufijo, {
      method: "POST",
      body: intentoPostventa.body,
      headers: { "Idempotency-Key": intentoPostventa.clave },
    });
    intentoPostventa = null;
    cerrarModal($("modal-venta"), true);
    toast(tipo === "cancelacion" ? "Venta cancelada." : "Devolución registrada.", "ok");
    const refrescos = await Promise.allSettled([cargarCaja(), cargarVentas()]);
    if (refrescos.some((resultado) => resultado.status === "rejected")) {
      toast("La operación se registró, pero una vista no pudo actualizarse. Usa Actualizar.", "err");
    }
  } catch (e) {
    if (e.status && e.status < 500) intentoPostventa = null;
    $("postventa-error").textContent = intentoPostventa
      ? e.message + " La clave se conservó; vuelve a intentarlo."
      : e.message;
  } finally {
    postventaEnCurso = false;
    if (ventaActiva && $("modal-venta").classList.contains("open")) pintarVentaActiva();
    actualizarControlesCaja();
  }
}
/* ============================================================
   CATÁLOGO, PUBLICACIÓN Y PRECIOS COMPARTIDOS
============================================================ */
function truncar(valor, limite = 72) {
  const cadena = texto(valor).trim();
  return cadena.length > limite ? cadena.slice(0, limite - 1) + "…" : cadena;
}

function opcion(valor, etiqueta) {
  const elemento = nodo("option", "", etiqueta);
  elemento.value = texto(valor);
  return elemento;
}

function reponerOpciones(select, etiquetaVacia, items, etiquetaItem) {
  const anterior = select.value;
  select.replaceChildren(opcion("", etiquetaVacia));
  for (const item of items) select.appendChild(opcion(item.id, etiquetaItem(item)));
  if (Array.from(select.options).some((item) => item.value === anterior)) select.value = anterior;
}

function actualizarSelectoresCatalogo() {
  const etiquetaCategoria = (categoria) => texto(categoria.nombre)
    + (categoria.activo === false ? " (inactiva)" : "");
  reponerOpciones($("sel-cat-producto-categoria"), "Todas las categorías", categoriasCatalogo, etiquetaCategoria);
  reponerOpciones($("producto-categoria"), "Sin categoría", categoriasCatalogo, etiquetaCategoria);
  reponerOpciones($("regla-categoria"), "Selecciona una categoría", categoriasCatalogo, etiquetaCategoria);
  reponerOpciones($("regla-producto"), "Selecciona un producto", productosCatalogoOpciones, (producto) =>
    texto(producto.sku) + " · " + texto(producto.titulo)
  );
}

async function obtenerProductosCatalogo({ q = "", categoriaId = "" } = {}) {
  const acumulados = [];
  for (let pagina = 1; pagina <= 100; pagina++) {
    const parametros = new URLSearchParams({ page: texto(pagina), limit: "100" });
    if (q.trim()) parametros.set("q", q.trim());
    if (categoriaId) parametros.set("categoria_id", categoriaId);
    const respuesta = await api("/productos?" + parametros.toString());
    const lote = extraerLista(respuesta, "productos");
    acumulados.push(...lote);
    if (lote.length < 100) break;
  }
  return acumulados;
}

async function cargarCategoriasCatalogo() {
  try {
    const respuesta = await api("/categorias?incluir_inactivas=true");
    categoriasCatalogo = extraerLista(respuesta, "categorias");
    actualizarSelectoresCatalogo();
    pintarCategoriasCatalogo();
  } catch (e) {
    filaVacia($("categorias-body"), 6, e.message);
    throw e;
  }
}

async function cargarProductosCatalogo() {
  const version = ++catalogoProductosVersion;
  filaVacia($("cat-productos-body"), 7, "Cargando productos…");
  try {
    const productos = await obtenerProductosCatalogo({
      q: $("inp-cat-producto-q").value,
      categoriaId: $("sel-cat-producto-categoria").value,
    });
    if (version !== catalogoProductosVersion) return;
    productosCatalogo = productos;
    pintarProductosCatalogo();
  } catch (e) {
    if (version === catalogoProductosVersion) filaVacia($("cat-productos-body"), 7, e.message);
  }
}

async function cargarProductosCatalogoOpciones() {
  productosCatalogoOpciones = await obtenerProductosCatalogo();
  actualizarSelectoresCatalogo();
}

async function cargarReglasCatalogo() {
  filaVacia($("reglas-body"), 10, "Cargando reglas…");
  try {
    const respuesta = await api("/precios/reglas?incluir_inactivas=true");
    reglasCatalogo = extraerLista(respuesta, "reglas");
    pintarReglasCatalogo();
  } catch (e) {
    filaVacia($("reglas-body"), 10, e.message);
  }
}

async function cargarCatalogoActivo() {
  try {
    if (!categoriasCatalogo.length) await cargarCategoriasCatalogo();
    if (catalogoSeccion === "productos") await cargarProductosCatalogo();
    if (catalogoSeccion === "categorias") pintarCategoriasCatalogo();
    if (catalogoSeccion === "precios") {
      await Promise.all([
        productosCatalogoOpciones.length ? Promise.resolve() : cargarProductosCatalogoOpciones(),
        cargarReglasCatalogo(),
      ]);
    }
  } catch (e) { toast(e.message, "err"); }
}

function cambiarCatalogoSeccion(nombre) {
  catalogoSeccion = nombre;
  document.querySelectorAll(".subtab[data-catalogo]").forEach((boton) =>
    boton.classList.toggle("active", boton.dataset.catalogo === nombre)
  );
  document.querySelectorAll(".catalogo-seccion").forEach((seccion) =>
    seccion.classList.toggle("active", seccion.id === "catalogo-" + nombre)
  );
  void cargarCatalogoActivo();
}

document.querySelectorAll(".subtab[data-catalogo]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarCatalogoSeccion(boton.dataset.catalogo));
});

$("inp-cat-producto-q").addEventListener("input", () => {
  clearTimeout(catalogoProductoTimer);
  catalogoProductoTimer = setTimeout(cargarProductosCatalogo, 300);
});
$("sel-cat-producto-categoria").addEventListener("change", cargarProductosCatalogo);

function estadoChip(activo, textoActivo = "Activo", textoInactivo = "Inactivo") {
  return nodo("span", activo ? "estado estado-completada" : "estado estado-cancelada", activo ? textoActivo : textoInactivo);
}

function pintarProductosCatalogo() {
  const tbody = $("cat-productos-body");
  tbody.replaceChildren();
  for (const producto of productosCatalogo) {
    const tr = document.createElement("tr");
    const titulo = document.createElement("td");
    titulo.appendChild(nodo("strong", "", texto(producto.titulo)));
    if (producto.subtitulo) titulo.appendChild(nodo("small", "tabla-detalle", texto(producto.subtitulo)));
    titulo.appendChild(nodo(
      "small",
      "tabla-detalle",
      texto(producto.autor, "Sin autor") + (producto.isbn ? " · ISBN " + texto(producto.isbn) : "")
    ));
    const publicacion = document.createElement("td");
    publicacion.appendChild(estadoChip(Boolean(producto.publicado_web), "Publicado", "No publicado"));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", esSupervisor() ? "Editar" : "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => abrirProductoCatalogo(producto.id));
    acciones.appendChild(boton);
    tr.append(
      celda(texto(producto.sku)), titulo, celda(texto(producto.categoria, "Sin categoría")),
      celda(fmt(producto.precio)), celda(disponibleProducto(producto)), publicacion, acciones
    );
    tbody.appendChild(tr);
  }
  if (!productosCatalogo.length) filaVacia(tbody, 7, "No hay productos para este filtro.");
}

const ROLES_CONTRIBUYENTES = [
  ["AUTOR", "producto-autores"],
  ["TRADUCTOR", "producto-traductores"],
  ["ILUSTRADOR", "producto-ilustradores"],
  ["EDITOR", "producto-editores"],
];

function nombresContribuyentes(producto, rol) {
  const contribuyentes = Array.isArray(producto && producto.contribuyentes)
    ? [...producto.contribuyentes] : [];
  const nombres = contribuyentes
    .filter((item) => texto(item.rol).toUpperCase() === rol)
    .sort((a, b) => numero(a.orden) - numero(b.orden) || numero(a.id) - numero(b.id))
    .map((item) => texto(item.nombre).trim())
    .filter(Boolean);
  if (!nombres.length && rol === "AUTOR" && producto && producto.autor) {
    nombres.push(texto(producto.autor).trim());
  }
  return nombres;
}

function separarListaCapturada(id, limite, etiqueta) {
  const nombres = $(id).value.split("|").map((nombre) => nombre.trim()).filter(Boolean);
  if (nombres.length > 100) throw new Error(etiqueta + " admite como máximo 100 elementos.");
  if (nombres.some((nombre) => nombre.length > limite)) {
    throw new Error("Cada elemento de " + etiqueta.toLowerCase() + " admite hasta " + limite + " caracteres.");
  }
  const normalizados = nombres.map((nombre) => nombre.toLocaleLowerCase("es-MX"));
  if (new Set(normalizados).size !== normalizados.length) {
    throw new Error("Elimina los valores repetidos de " + etiqueta.toLowerCase() + ".");
  }
  return nombres;
}

function contribuyentesDesdeFormulario() {
  const contribuyentes = [];
  let orden = 0;
  for (const [rol, id] of ROLES_CONTRIBUYENTES) {
    for (const nombre of separarListaCapturada(id, 160, id.replace("producto-", ""))) {
      contribuyentes.push({ nombre, rol, orden: orden++ });
    }
  }
  return contribuyentes;
}

function materiasDesdeFormulario() {
  return separarListaCapturada("producto-materias", 120, "Materias").map((nombre) => ({ nombre }));
}

function aplicarModoProducto() {
  const soloLectura = !esSupervisor();
  document.querySelectorAll("#form-producto input, #form-producto select, #form-producto textarea").forEach((campo) => {
    campo.disabled = soloLectura;
  });
  document.querySelectorAll("#form-producto-imagen input, #form-producto-imagen button").forEach((campo) => {
    campo.disabled = soloLectura;
  });
  $("btn-guardar-producto").disabled = soloLectura;
  $("btn-producto-publicacion").disabled = soloLectura;
}

function pintarProductoCatalogo() {
  const producto = productoCatalogoActivo;
  const nuevo = !producto || !producto.id;
  $("producto-modal-titulo").textContent = nuevo ? "Nuevo producto" : (esSupervisor() ? "Editar · " : "Consultar · ") + texto(producto.titulo);
  $("producto-sku").value = texto(producto && producto.sku);
  $("producto-codigo").value = texto(producto && producto.codigo_barras);
  $("producto-isbn").value = texto(producto && producto.isbn);
  $("producto-isbn-normalizado").value = texto(producto && producto.isbn_normalizado);
  $("producto-titulo").value = texto(producto && producto.titulo);
  $("producto-subtitulo").value = texto(producto && producto.subtitulo);
  const autores = nombresContribuyentes(producto, "AUTOR");
  $("producto-autor").value = texto(producto && producto.autor, autores.join(" | "));
  for (const [rol, id] of ROLES_CONTRIBUYENTES) {
    $(id).value = nombresContribuyentes(producto, rol).join(" | ");
  }
  const materias = Array.isArray(producto && producto.materias) ? producto.materias : [];
  $("producto-materias").value = materias
    .map((materia) => texto(materia.nombre).trim()).filter(Boolean).join(" | ");
  $("producto-editorial").value = texto(producto && producto.editorial);
  $("producto-categoria").value = producto && producto.categoria_id ? texto(producto.categoria_id) : "";
  $("producto-edicion").value = texto(producto && producto.edicion);
  $("producto-anio-publicacion").value = producto && producto.anio_publicacion != null
    ? texto(producto.anio_publicacion) : "";
  $("producto-idioma").value = texto(producto && producto.idioma);
  $("producto-numero-paginas").value = producto && producto.numero_paginas != null
    ? texto(producto.numero_paginas) : "";
  $("producto-encuadernacion").value = texto(producto && producto.encuadernacion);
  $("producto-formato").value = texto(producto && producto.formato);
  $("producto-coleccion").value = texto(producto && producto.coleccion);
  $("producto-serie").value = texto(producto && producto.serie);
  $("producto-volumen").value = texto(producto && producto.volumen);
  $("producto-precio").value = nuevo ? "0" : texto(numero(producto.precio));
  $("producto-costo").value = nuevo ? "0" : texto(numero(producto.costo));
  $("producto-iva").value = nuevo ? "16" : texto(numero(producto.iva));
  $("producto-stock").value = "0";
  $("producto-slug").value = texto(producto && producto.slug);
  $("producto-descripcion").value = texto(producto && producto.descripcion_comercial);
  $("producto-activo").checked = nuevo ? true : producto.activo !== false;
  $("grupo-producto-stock").classList.toggle("hidden", !nuevo);
  $("producto-imagenes-seccion").classList.toggle("hidden", nuevo);
  $("producto-publicacion-seccion").classList.toggle("hidden", nuevo);
  $("producto-error").textContent = "";
  if (!nuevo) {
    const publicado = Boolean(producto.publicado_web);
    $("producto-publicacion-estado").textContent = publicado ? "Publicado en tienda" : "No publicado";
    $("btn-producto-publicacion").textContent = publicado ? "Despublicar" : "Publicar";
    $("form-producto-imagen").reset();
    pintarImagenesProducto();
  }
  aplicarModoProducto();
  configurarPermisosVisuales();
}

async function abrirProductoCatalogo(id = null) {
  try {
    if (!categoriasCatalogo.length) await cargarCategoriasCatalogo();
    productoCatalogoActivo = id ? await api("/productos/" + encodeURIComponent(id)) : {};
    pintarProductoCatalogo();
    abrirModal("modal-producto");
  } catch (e) { toast(e.message, "err"); }
}

$("btn-cat-producto-nuevo").addEventListener("click", () => {
  if (esSupervisor()) void abrirProductoCatalogo();
});

$("producto-autores").addEventListener("input", () => {
  $("producto-autor").value = $("producto-autores").value.split("|")
    .map((nombre) => nombre.trim()).filter(Boolean).join(" | ");
});

function pintarImagenesProducto() {
  const lista = $("producto-imagenes-lista");
  lista.replaceChildren();
  const imagenes = Array.isArray(productoCatalogoActivo && productoCatalogoActivo.imagenes)
    ? productoCatalogoActivo.imagenes : [];
  for (const imagen of imagenes) {
    const tarjeta = nodo("article", "imagen-card");
    const vista = document.createElement("img");
    vista.src = texto(imagen.url);
    vista.alt = texto(imagen.texto_alternativo, "Imagen del producto");
    vista.loading = "lazy";
    vista.referrerPolicy = "no-referrer";
    const info = nodo("div", "imagen-info");
    info.append(
      nodo("strong", "", texto(imagen.texto_alternativo)),
      nodo("small", "", truncar(imagen.url, 90)),
      nodo("span", "chip", imagen.principal ? "Principal" : "Orden " + numero(imagen.orden))
    );
    tarjeta.append(vista, info);
    if (esSupervisor()) {
      const eliminar = nodo("button", "btn btn-ghost", "Eliminar");
      eliminar.type = "button";
      eliminar.addEventListener("click", () => eliminarImagenProducto(imagen));
      tarjeta.appendChild(eliminar);
    }
    lista.appendChild(tarjeta);
  }
  if (!imagenes.length) lista.appendChild(nodo("p", "subtle", "Este producto todavía no tiene imágenes."));
  if (esSupervisor()) {
    $("imagen-orden").value = texto(imagenes.reduce(
      (maximo, imagen) => Math.max(maximo, numero(imagen.orden)), -1
    ) + 1);
  }
}

async function recargarProductoCatalogo(id) {
  productoCatalogoActivo = await api("/productos/" + encodeURIComponent(id));
  pintarProductoCatalogo();
}

$("form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!esSupervisor()) return;
  const boton = $("btn-guardar-producto");
  await conBotonOcupado(boton, "Guardando…", async () => {
    $("producto-error").textContent = "";
    try {
      const nuevo = !productoCatalogoActivo || !productoCatalogoActivo.id;
      const sku = $("producto-sku").value.trim();
      const titulo = $("producto-titulo").value.trim();
      const slug = $("producto-slug").value.trim();
      const precioTexto = $("producto-precio").value.trim();
      const costoTexto = $("producto-costo").value.trim();
      const ivaTexto = $("producto-iva").value.trim();
      if (!precioTexto || !costoTexto || !ivaTexto) {
        throw new Error("Captura precio, costo e IVA.");
      }
      const precio = Number(precioTexto);
      const costo = Number(costoTexto);
      const iva = Number(ivaTexto);
      const stock = Number($("producto-stock").value || 0);
      const anioTexto = $("producto-anio-publicacion").value.trim();
      const paginasTexto = $("producto-numero-paginas").value.trim();
      const anioPublicacion = anioTexto ? Number(anioTexto) : null;
      const numeroPaginas = paginasTexto ? Number(paginasTexto) : null;
      if (sku.length < 3 || titulo.length < 2) throw new Error("Captura SKU y título válidos.");
      if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("El slug solo admite minúsculas, números y guiones.");
      if (![precio, costo].every((valor) => Number.isFinite(valor) && valor >= 0 && valor <= 999999)
          || !Number.isFinite(iva) || iva < 0 || iva > 100) {
        throw new Error("Precio, costo e IVA deben ser válidos.");
      }
      if (![precio, costo, iva].every((valor) => Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-8)) {
        throw new Error("Precio, costo e IVA admiten como máximo dos decimales.");
      }
      if (nuevo && (!Number.isInteger(stock) || stock < 0)) throw new Error("La existencia inicial debe ser un entero no negativo.");
      if (anioPublicacion != null && (!Number.isInteger(anioPublicacion) || anioPublicacion < 1000 || anioPublicacion > 9999)) {
        throw new Error("El año de publicación debe ser un entero entre 1000 y 9999.");
      }
      if (numeroPaginas != null && (!Number.isInteger(numeroPaginas) || numeroPaginas <= 0)) {
        throw new Error("El número de páginas debe ser un entero mayor que cero.");
      }
      const contribuyentes = contribuyentesDesdeFormulario();
      const materias = materiasDesdeFormulario();
      const body = {
        sku,
        codigo_barras: $("producto-codigo").value.trim() || null,
        isbn: $("producto-isbn").value.trim() || null,
        titulo,
        subtitulo: $("producto-subtitulo").value.trim() || null,
        editorial: $("producto-editorial").value.trim() || null,
        categoria_id: numero($("producto-categoria").value, 0) || null,
        edicion: $("producto-edicion").value.trim() || null,
        anio_publicacion: anioPublicacion,
        idioma: $("producto-idioma").value.trim() || null,
        numero_paginas: numeroPaginas,
        encuadernacion: $("producto-encuadernacion").value.trim() || null,
        formato: $("producto-formato").value.trim() || null,
        coleccion: $("producto-coleccion").value.trim() || null,
        serie: $("producto-serie").value.trim() || null,
        volumen: $("producto-volumen").value.trim() || null,
        contribuyentes,
        materias,
        precio,
        costo,
        iva,
        slug: slug || null,
        descripcion_comercial: $("producto-descripcion").value.trim() || null,
      };
      let guardado;
      if (nuevo) {
        guardado = await api("/productos", {
          method: "POST", body: { ...body, stock, activo: $("producto-activo").checked },
        });
      } else {
        guardado = await api("/productos/" + encodeURIComponent(productoCatalogoActivo.id), {
          method: "PATCH", body: { ...body, activo: $("producto-activo").checked },
        });
      }
      await recargarProductoCatalogo(guardado.id);
      productosCatalogoOpciones = [];
      await cargarProductosCatalogo();
      if (carrito.length) pintarCarrito();
      toast(nuevo ? "Producto creado. Ya puedes agregar imágenes y publicarlo." : "Producto actualizado.", "ok");
    } catch (err) { $("producto-error").textContent = err.message; }
  });
});

$("form-producto-imagen").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!esSupervisor() || !productoCatalogoActivo || !productoCatalogoActivo.id) return;
  const boton = $("btn-agregar-imagen");
  await conBotonOcupado(boton, "Agregando…", async () => {
    $("producto-error").textContent = "";
    try {
      const url = $("imagen-url").value.trim();
      const textoAlternativo = $("imagen-alt").value.trim();
      const orden = Number($("imagen-orden").value || 0);
      let direccion;
      try { direccion = new URL(url); } catch (_) { throw new Error("Escribe una dirección de imagen válida."); }
      if (!["http:", "https:"].includes(direccion.protocol)) throw new Error("La imagen debe usar http o https.");
      if (!textoAlternativo) throw new Error("Escribe el texto alternativo de la imagen.");
      if (!Number.isInteger(orden) || orden < 0) throw new Error("El orden debe ser un entero no negativo.");
      await api("/productos/" + encodeURIComponent(productoCatalogoActivo.id) + "/imagenes", {
        method: "POST",
        body: { url, texto_alternativo: textoAlternativo, orden, principal: $("imagen-principal").checked },
      });
      $("form-producto-imagen").reset();
      await recargarProductoCatalogo(productoCatalogoActivo.id);
      await cargarProductosCatalogo();
      toast("Imagen agregada.", "ok");
    } catch (err) { $("producto-error").textContent = err.message; }
  });
});

async function eliminarImagenProducto(imagen) {
  if (!esSupervisor() || !productoCatalogoActivo || !confirm("¿Eliminar esta imagen?")) return;
  try {
    await api("/productos/" + encodeURIComponent(productoCatalogoActivo.id)
      + "/imagenes/" + encodeURIComponent(imagen.id), { method: "DELETE" });
    await recargarProductoCatalogo(productoCatalogoActivo.id);
    await cargarProductosCatalogo();
    toast("Imagen eliminada.", "ok");
  } catch (e) { $("producto-error").textContent = e.message; }
}

$("btn-producto-publicacion").addEventListener("click", async () => {
  if (!esSupervisor() || !productoCatalogoActivo || !productoCatalogoActivo.id) return;
  const publicado = Boolean(productoCatalogoActivo.publicado_web);
  await conBotonOcupado($("btn-producto-publicacion"), publicado ? "Despublicando…" : "Publicando…", async () => {
    $("producto-error").textContent = "";
    try {
      await api("/productos/" + encodeURIComponent(productoCatalogoActivo.id) + "/publicacion", {
        method: "PATCH", body: { publicado_web: !publicado },
      });
      await recargarProductoCatalogo(productoCatalogoActivo.id);
      await cargarProductosCatalogo();
      toast(publicado ? "Producto retirado de la tienda." : "Producto publicado en la tienda.", "ok");
    } catch (e) { $("producto-error").textContent = e.message; }
  });
  if (productoCatalogoActivo) {
    $("btn-producto-publicacion").textContent = productoCatalogoActivo.publicado_web ? "Despublicar" : "Publicar";
  }
});

/* ============================================================
   IMPORTACIÓN BIBLIOGRÁFICA CON PREVISUALIZACIÓN DEL SERVIDOR
============================================================ */
const MAX_CSV_PRODUCTOS_BYTES = 2 * 1024 * 1024;
const COLUMNAS_CSV_PRODUCTOS = [
  "sku", "codigo_barras", "isbn", "titulo", "subtitulo", "autores",
  "traductores", "ilustradores", "editores", "editorial", "categoria_slug",
  "edicion", "anio_publicacion", "idioma", "numero_paginas", "encuadernacion",
  "formato", "coleccion", "serie", "volumen", "materias", "precio", "costo",
  "iva", "descripcion_comercial",
];

function estadoImportacionAplicada() {
  return Boolean(importacionProductosActiva
    && ["APLICADA", "CONFIRMADA"].includes(texto(importacionProductosActiva.estado).toUpperCase()));
}

function totalResumenImportacion(campo) {
  return numero(importacionProductosResumen && importacionProductosResumen[campo]);
}

function normalizarPaginaImportacion(datos) {
  const page = Math.max(1, numero(datos && datos.page, 1));
  const limit = Math.max(1, numero(datos && datos.limit, 50));
  const resultados = Array.isArray(datos && datos.resultados) ? datos.resultados : [];
  return {
    page,
    limit,
    total: Math.max(0, numero(datos && datos.total, resultados.length)),
    resultados,
  };
}

function reiniciarImportacionProductos() {
  importacionProductosVersion++;
  importacionProductosActiva = null;
  importacionProductosResumen = null;
  importacionProductosFilas = null;
  importacionProductosPagina = 1;
  importacionProductosFiltro = "TODAS";
  importacionProductosEnCurso = false;
  intentoConfirmacionImportacion = null;
  $("form-importacion-productos").reset();
  $("sel-importacion-productos-resultado").value = "TODAS";
  $("importacion-productos-preview").classList.add("hidden");
  $("importacion-productos-resumen").replaceChildren();
  $("importacion-productos-body").replaceChildren();
  $("importacion-productos-archivo-info").textContent = "Selecciona un archivo de hasta 2 MiB.";
  $("importacion-productos-estado").textContent = "";
  $("importacion-productos-error").textContent = "";
  $("chk-importacion-productos-omisiones").checked = false;
  actualizarControlesImportacionProductos();
}

function pintarResumenImportacionProductos() {
  const contenedor = $("importacion-productos-resumen");
  contenedor.replaceChildren();
  const elementos = [
    ["Filas", "filas_total", "total"],
    ["Por crear", "crear", "crear"],
    ["Por actualizar", "actualizar", "actualizar"],
    ["Sin cambios", "sin_cambios", "sin-cambios"],
    ["Rechazadas", "rechazadas", "rechazar"],
  ];
  for (const [etiqueta, campo, clase] of elementos) {
    const tarjeta = nodo("article", "importacion-resumen-item importacion-resumen-" + clase);
    tarjeta.append(nodo("span", "", etiqueta), nodo("strong", "", totalResumenImportacion(campo)));
    contenedor.appendChild(tarjeta);
  }
}

function textoIncidenciaImportacion(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return texto(item, "Detalle no disponible");
  const campo = texto(item.campo).trim();
  const mensaje = texto(item.mensaje || item.error || item.codigo, "Dato no válido");
  return campo ? campo + ": " + mensaje : mensaje;
}

function valorCambioImportacion(valor) {
  if (valor == null || valor === "") return "vacío";
  if (typeof valor === "object") {
    try { return JSON.stringify(valor); } catch (_) { return texto(valor); }
  }
  return texto(valor);
}

function pintarDetalleFilaImportacion(fila) {
  const detalle = nodo("div", "importacion-fila-detalle");
  const errores = Array.isArray(fila.errores) ? fila.errores : [];
  const advertencias = Array.isArray(fila.advertencias) ? fila.advertencias : [];
  const cambios = Array.isArray(fila.cambios) ? fila.cambios : [];

  if (errores.length) {
    const lista = nodo("ul", "importacion-incidencias importacion-errores");
    for (const error of errores) lista.appendChild(nodo("li", "", textoIncidenciaImportacion(error)));
    detalle.appendChild(lista);
  }
  if (advertencias.length) {
    const lista = nodo("ul", "importacion-incidencias importacion-advertencias");
    for (const aviso of advertencias) lista.appendChild(nodo("li", "", textoIncidenciaImportacion(aviso)));
    detalle.appendChild(lista);
  }
  if (cambios.length) {
    const desplegable = document.createElement("details");
    desplegable.className = "importacion-cambios";
    desplegable.appendChild(nodo("summary", "", cambios.length + (cambios.length === 1 ? " cambio" : " cambios")));
    const lista = document.createElement("ul");
    for (const cambio of cambios) {
      const campo = texto(cambio && cambio.campo, "Dato");
      const anterior = valorCambioImportacion(cambio && cambio.anterior);
      const nuevo = valorCambioImportacion(cambio && cambio.nuevo);
      lista.appendChild(nodo("li", "", campo + ": " + anterior + " → " + nuevo));
    }
    desplegable.appendChild(lista);
    detalle.appendChild(desplegable);
  }
  if (!detalle.childNodes.length) detalle.appendChild(nodo("span", "subtle", "Sin observaciones."));
  return detalle;
}

function etiquetaAccionImportacion(accion) {
  const etiquetas = {
    CREAR: "Crear",
    ACTUALIZAR: "Actualizar",
    SIN_CAMBIOS: "Sin cambios",
    RECHAZAR: "Rechazada",
  };
  return etiquetas[accion] || texto(accion, "Sin clasificar");
}

function pintarFilasImportacionProductos() {
  const tbody = $("importacion-productos-body");
  tbody.replaceChildren();
  const pagina = normalizarPaginaImportacion(importacionProductosFilas);
  importacionProductosFilas = pagina;
  for (const fila of pagina.resultados) {
    const accion = texto(fila.accion).toUpperCase();
    const estado = document.createElement("td");
    estado.appendChild(nodo(
      "span",
      "estado importacion-accion importacion-accion-" + accion.toLowerCase().replaceAll("_", "-"),
      etiquetaAccionImportacion(accion)
    ));
    const claves = document.createElement("td");
    claves.append(nodo("strong", "", texto(fila.sku, "Sin SKU")));
    if (fila.isbn) claves.appendChild(nodo("small", "tabla-detalle", "ISBN " + texto(fila.isbn)));
    const producto = document.createElement("td");
    producto.append(nodo("strong", "", texto(fila.titulo, "Sin título")));
    const tr = document.createElement("tr");
    tr.append(
      celda(numero(fila.numero_fila)),
      estado,
      claves,
      producto,
      (() => {
        const td = document.createElement("td");
        td.appendChild(pintarDetalleFilaImportacion(fila));
        return td;
      })()
    );
    tbody.appendChild(tr);
  }
  if (!pagina.resultados.length) filaVacia(tbody, 5, "No hay filas para este filtro.");
  $("importacion-productos-pagina").textContent = "Página " + pagina.page + " · " + pagina.total + " filas";
  actualizarControlesImportacionProductos();
}

function actualizarControlesImportacionProductos() {
  const activa = Boolean(importacionProductosActiva);
  const aplicada = estadoImportacionAplicada();
  const rechazos = totalResumenImportacion("rechazadas");
  const aplicables = totalResumenImportacion("crear") + totalResumenImportacion("actualizar");
  const aceptoOmisiones = $("chk-importacion-productos-omisiones").checked;
  const archivo = $("importacion-productos-archivo").files[0];
  const pagina = normalizarPaginaImportacion(importacionProductosFilas);

  $("importacion-productos-preview").classList.toggle("hidden", !activa);
  $("grupo-importacion-productos-omisiones").classList.toggle("hidden", !activa || !rechazos || aplicada);
  $("btn-previsualizar-importacion-productos").classList.toggle("hidden", activa);
  $("btn-confirmar-importacion-productos").classList.toggle("hidden", !activa || aplicada);
  $("btn-reiniciar-importacion-productos").classList.toggle("hidden", !activa);

  $("importacion-productos-archivo").disabled = importacionProductosEnCurso || activa;
  $("btn-previsualizar-importacion-productos").disabled = importacionProductosEnCurso || !archivo || !esSupervisor();
  $("btn-reiniciar-importacion-productos").disabled = importacionProductosEnCurso
    || Boolean(intentoConfirmacionImportacion);
  $("btn-confirmar-importacion-productos").disabled = importacionProductosEnCurso
    || !aplicables || (rechazos > 0 && !aceptoOmisiones) || !esSupervisor();
  $("btn-confirmar-importacion-productos").textContent = intentoConfirmacionImportacion
    ? "Reintentar importación"
    : "Importar " + aplicables + (aplicables === 1 ? " fila" : " filas");
  $("sel-importacion-productos-resultado").disabled = importacionProductosEnCurso || !activa;
  $("chk-importacion-productos-omisiones").disabled = importacionProductosEnCurso
    || Boolean(intentoConfirmacionImportacion);
  $("btn-importacion-productos-anterior").disabled = importacionProductosEnCurso
    || !activa || pagina.page <= 1;
  $("btn-importacion-productos-siguiente").disabled = importacionProductosEnCurso
    || !activa || pagina.page * pagina.limit >= pagina.total;
  $("modal-importacion-productos").querySelectorAll("[data-close]").forEach((boton) => {
    boton.disabled = importacionProductosEnCurso;
  });
}

function abrirImportacionProductos() {
  if (!esSupervisor()) return;
  if (!importacionProductosActiva || estadoImportacionAplicada()) reiniciarImportacionProductos();
  configurarPermisosVisuales();
  actualizarControlesImportacionProductos();
  abrirModal("modal-importacion-productos");
}

async function leerArchivoCsvProductos() {
  const archivo = $("importacion-productos-archivo").files[0];
  if (!archivo) throw new Error("Selecciona un archivo CSV.");
  if (!/\.csv$/i.test(archivo.name)) throw new Error("El archivo debe tener extensión .csv.");
  if (!archivo.size) throw new Error("El archivo CSV está vacío.");
  if (archivo.size > MAX_CSV_PRODUCTOS_BYTES) throw new Error("El archivo supera el límite de 2 MiB.");
  let contenido;
  try {
    contenido = new TextDecoder("utf-8", { fatal: true }).decode(await archivo.arrayBuffer());
  } catch (_) {
    throw new Error("El archivo debe estar guardado en UTF-8.");
  }
  if (!contenido.trim()) throw new Error("El archivo CSV está vacío.");
  return { archivo, contenido };
}

$("btn-descargar-plantilla-productos").addEventListener("click", () => {
  if (!esSupervisor()) return;
  const blob = new Blob(["\uFEFF" + COLUMNAS_CSV_PRODUCTOS.join(",") + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = "plantilla-importacion-productos.csv";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 0);
});

$("btn-importar-productos").addEventListener("click", abrirImportacionProductos);

$("importacion-productos-archivo").addEventListener("change", () => {
  const archivo = $("importacion-productos-archivo").files[0];
  $("importacion-productos-error").textContent = "";
  $("importacion-productos-archivo-info").textContent = archivo
    ? texto(archivo.name) + " · " + (archivo.size / 1024).toFixed(1) + " KiB"
    : "Selecciona un archivo de hasta 2 MiB.";
  actualizarControlesImportacionProductos();
});

$("form-importacion-productos").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!esSupervisor() || importacionProductosEnCurso || importacionProductosActiva) return;
  $("importacion-productos-error").textContent = "";
  importacionProductosEnCurso = true;
  const version = ++importacionProductosVersion;
  actualizarControlesImportacionProductos();
  $("btn-previsualizar-importacion-productos").textContent = "Previsualizando…";
  try {
    const archivoCsv = await leerArchivoCsvProductos();
    const parametros = new URLSearchParams({
      nombre_archivo: archivoCsv.archivo.name,
      modo: "CREAR_Y_ACTUALIZAR",
    });
    const respuesta = await apiCsv(
      "/productos/importaciones/previsualizar?" + parametros.toString(),
      archivoCsv.contenido
    );
    if (version !== importacionProductosVersion) return;
    if (!respuesta || !respuesta.importacion || !respuesta.importacion.id
        || !respuesta.importacion.hash_sha256) {
      throw new Error("El servidor no devolvió una previsualización válida.");
    }
    importacionProductosActiva = respuesta.importacion;
    importacionProductosResumen = respuesta.resumen || {};
    importacionProductosFilas = normalizarPaginaImportacion(respuesta.filas);
    importacionProductosPagina = importacionProductosFilas.page;
    importacionProductosFiltro = "TODAS";
    $("sel-importacion-productos-resultado").value = "TODAS";
    $("chk-importacion-productos-omisiones").checked = false;
    $("importacion-productos-estado").textContent = "Archivo "
      + texto(importacionProductosActiva.nombre_archivo, archivoCsv.archivo.name)
      + " · revisado sin modificar el catálogo.";
    pintarResumenImportacionProductos();
    pintarFilasImportacionProductos();
  } catch (error) {
    if (version === importacionProductosVersion && error.message !== "unauthorized") {
      $("importacion-productos-error").textContent = error.message;
    }
  } finally {
    if (version === importacionProductosVersion) {
      importacionProductosEnCurso = false;
      $("btn-previsualizar-importacion-productos").textContent = "Previsualizar";
      actualizarControlesImportacionProductos();
    }
  }
});

async function cargarFilasImportacionProductos(pagina) {
  if (!importacionProductosActiva || importacionProductosEnCurso) return;
  importacionProductosEnCurso = true;
  const version = ++importacionProductosVersion;
  filaVacia($("importacion-productos-body"), 5, "Cargando filas…");
  actualizarControlesImportacionProductos();
  try {
    const parametros = new URLSearchParams({
      resultado: importacionProductosFiltro,
      page: texto(Math.max(1, numero(pagina, 1))),
      limit: "50",
    });
    const respuesta = await api(
      "/productos/importaciones/" + encodeURIComponent(importacionProductosActiva.id)
      + "/filas?" + parametros.toString()
    );
    if (version !== importacionProductosVersion) return;
    importacionProductosFilas = normalizarPaginaImportacion(respuesta);
    importacionProductosPagina = importacionProductosFilas.page;
    pintarFilasImportacionProductos();
  } catch (error) {
    if (version === importacionProductosVersion) {
      filaVacia($("importacion-productos-body"), 5, error.message);
      $("importacion-productos-error").textContent = error.message;
    }
  } finally {
    if (version === importacionProductosVersion) {
      importacionProductosEnCurso = false;
      actualizarControlesImportacionProductos();
    }
  }
}

$("sel-importacion-productos-resultado").addEventListener("change", (e) => {
  importacionProductosFiltro = e.target.value;
  void cargarFilasImportacionProductos(1);
});

$("btn-importacion-productos-anterior").addEventListener("click", () => {
  void cargarFilasImportacionProductos(importacionProductosPagina - 1);
});

$("btn-importacion-productos-siguiente").addEventListener("click", () => {
  void cargarFilasImportacionProductos(importacionProductosPagina + 1);
});

$("chk-importacion-productos-omisiones").addEventListener("change", actualizarControlesImportacionProductos);

$("btn-reiniciar-importacion-productos").addEventListener("click", () => {
  if (importacionProductosEnCurso || intentoConfirmacionImportacion) return;
  reiniciarImportacionProductos();
});

$("btn-confirmar-importacion-productos").addEventListener("click", async () => {
  if (!esSupervisor() || !importacionProductosActiva || importacionProductosEnCurso
      || estadoImportacionAplicada()) return;
  const rechazos = totalResumenImportacion("rechazadas");
  if (rechazos && !$("chk-importacion-productos-omisiones").checked) {
    $("importacion-productos-error").textContent = "Confirma que las filas rechazadas se omitirán.";
    return;
  }
  if (!intentoConfirmacionImportacion) {
    intentoConfirmacionImportacion = {
      importacionId: importacionProductosActiva.id,
      clave: nuevaClaveIdempotencia(),
      body: {
        hash_sha256: importacionProductosActiva.hash_sha256,
        confirmar_omision_rechazadas: Boolean(rechazos),
      },
    };
  }
  importacionProductosEnCurso = true;
  $("importacion-productos-error").textContent = "";
  actualizarControlesImportacionProductos();
  try {
    const respuesta = await api(
      "/productos/importaciones/" + encodeURIComponent(intentoConfirmacionImportacion.importacionId)
      + "/confirmar",
      {
        method: "POST",
        body: intentoConfirmacionImportacion.body,
        headers: { "Idempotency-Key": intentoConfirmacionImportacion.clave },
      }
    );
    intentoConfirmacionImportacion = null;
    importacionProductosActiva = respuesta.importacion || importacionProductosActiva;
    importacionProductosResumen = respuesta.resumen || importacionProductosResumen;
    $("importacion-productos-estado").textContent = "Importación aplicada. El catálogo ya usa los datos confirmados.";
    pintarResumenImportacionProductos();
    productosCatalogoOpciones = [];
    await cargarProductosCatalogo();
    if (carrito.length) pintarCarrito();
    toast("Importación aplicada al catálogo.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoConfirmacionImportacion = null;
    if (error.status === 409) {
      const mensaje = error.message + " Selecciona el archivo y genera una nueva previsualización.";
      reiniciarImportacionProductos();
      $("importacion-productos-error").textContent = mensaje;
    } else if (error.message !== "unauthorized") {
      $("importacion-productos-error").textContent = intentoConfirmacionImportacion
        ? error.message + " La clave se conservó; reintenta la misma importación."
        : error.message;
    }
  } finally {
    importacionProductosEnCurso = false;
    actualizarControlesImportacionProductos();
  }
});

function pintarCategoriasCatalogo() {
  const tbody = $("categorias-body");
  tbody.replaceChildren();
  for (const categoria of categoriasCatalogo) {
    const acciones = document.createElement("td");
    if (esSupervisor()) {
      const editar = nodo("button", "btn btn-outline", "Editar");
      editar.type = "button";
      editar.addEventListener("click", () => abrirCategoriaCatalogo(categoria));
      acciones.appendChild(editar);
    } else acciones.textContent = "Consulta";
    const estado = document.createElement("td");
    estado.appendChild(estadoChip(categoria.activo !== false));
    const tr = document.createElement("tr");
    tr.append(
      celda(numero(categoria.orden)), celda(texto(categoria.nombre)), celda(texto(categoria.slug, "—")),
      celda(truncar(categoria.descripcion, 90) || "—"), estado, acciones
    );
    tbody.appendChild(tr);
  }
  if (!categoriasCatalogo.length) filaVacia(tbody, 6, "No hay categorías registradas.");
}

function abrirCategoriaCatalogo(categoria = null) {
  if (!esSupervisor()) return;
  categoriaCatalogoActiva = categoria;
  $("categoria-modal-titulo").textContent = categoria ? "Editar categoría" : "Nueva categoría";
  $("categoria-nombre").value = texto(categoria && categoria.nombre);
  $("categoria-slug").value = texto(categoria && categoria.slug);
  $("categoria-orden").value = texto(categoria ? numero(categoria.orden) : 0);
  $("categoria-descripcion").value = texto(categoria && categoria.descripcion);
  $("categoria-activa").checked = categoria ? categoria.activo !== false : true;
  $("categoria-error").textContent = "";
  abrirModal("modal-categoria");
}

$("btn-categoria-nueva").addEventListener("click", () => abrirCategoriaCatalogo());
$("form-categoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!esSupervisor()) return;
  await conBotonOcupado($("btn-guardar-categoria"), "Guardando…", async () => {
    $("categoria-error").textContent = "";
    try {
      const nombre = $("categoria-nombre").value.trim();
      const slug = $("categoria-slug").value.trim();
      const orden = Number($("categoria-orden").value || 0);
      if (nombre.length < 2) throw new Error("El nombre debe tener al menos 2 caracteres.");
      if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("El slug solo admite minúsculas, números y guiones.");
      if (!Number.isInteger(orden) || orden < 0) throw new Error("El orden debe ser un entero no negativo.");
      const body = {
        nombre,
        descripcion: $("categoria-descripcion").value.trim() || null,
        activo: $("categoria-activa").checked,
        orden,
      };
      if (slug) body.slug = slug;
      if (categoriaCatalogoActiva) {
        await api("/categorias/" + encodeURIComponent(categoriaCatalogoActiva.id), { method: "PATCH", body });
      } else await api("/categorias", { method: "POST", body });
      cerrarModal($("modal-categoria"), true);
      await cargarCategoriasCatalogo();
      await cargarProductosCatalogo();
      toast("Categoría guardada.", "ok");
    } catch (err) { $("categoria-error").textContent = err.message; }
  });
});

function beneficioRegla(regla) {
  if (regla.tipo === "PORCENTAJE") return numero(regla.valor) + "%";
  if (regla.tipo === "MONTO_FIJO") return "−" + fmt(regla.valor);
  return "Precio " + fmt(regla.valor);
}

function alcanceRegla(regla) {
  if (regla.producto_id) return "Producto: " + texto(regla.producto, "#" + regla.producto_id);
  if (regla.categoria_id) return "Categoría: " + texto(regla.categoria, "#" + regla.categoria_id);
  return "Todos los productos";
}

function vigenciaRegla(regla) {
  if (!regla.vigente_desde && !regla.vigente_hasta) return "Siempre";
  return (regla.vigente_desde ? hora(regla.vigente_desde) : "Sin inicio")
    + " — " + (regla.vigente_hasta ? hora(regla.vigente_hasta) : "Sin fin");
}

function pintarReglasCatalogo() {
  const tbody = $("reglas-body");
  tbody.replaceChildren();
  for (const regla of reglasCatalogo) {
    const estado = document.createElement("td");
    estado.appendChild(estadoChip(regla.activo !== false));
    const acciones = document.createElement("td");
    if (esSupervisor()) {
      const editar = nodo("button", "btn btn-outline", "Editar");
      editar.type = "button";
      editar.addEventListener("click", () => abrirReglaCatalogo(regla));
      acciones.appendChild(editar);
    } else acciones.textContent = "Consulta";
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(regla.nombre)), celda(texto(regla.canal)),
      celda(texto(regla.segmento_cliente, "TODOS").replace("PUBLICO", "PÚBLICO")),
      celda(alcanceRegla(regla)),
      celda(beneficioRegla(regla), "precio-descuento"), celda(numero(regla.cantidad_minima)),
      celda(numero(regla.prioridad)), celda(vigenciaRegla(regla)), estado, acciones
    );
    tbody.appendChild(tr);
  }
  if (!reglasCatalogo.length) filaVacia(tbody, 10, "No hay reglas de precio registradas.");
}

function fechaParaInput(valor) {
  if (!valor) return "";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "";
  const local = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function actualizarAlcanceRegla() {
  const alcance = $("regla-alcance").value;
  $("grupo-regla-producto").classList.toggle("hidden", alcance !== "PRODUCTO");
  $("grupo-regla-categoria").classList.toggle("hidden", alcance !== "CATEGORIA");
}

$("regla-alcance").addEventListener("change", actualizarAlcanceRegla);

async function abrirReglaCatalogo(regla = null) {
  if (!esSupervisor()) return;
  try {
    if (!categoriasCatalogo.length) await cargarCategoriasCatalogo();
    if (!productosCatalogoOpciones.length) await cargarProductosCatalogoOpciones();
    reglaCatalogoActiva = regla;
    $("regla-modal-titulo").textContent = regla ? "Editar regla" : "Nueva regla";
    $("regla-nombre").value = texto(regla && regla.nombre);
    $("regla-canal").value = texto(regla && regla.canal, "AMBOS");
    $("sel-regla-segmento").value = texto(regla && regla.segmento_cliente, "TODOS");
    $("regla-tipo").value = texto(regla && regla.tipo, "PORCENTAJE");
    $("regla-valor").value = texto(regla ? numero(regla.valor) : 0);
    $("regla-alcance").value = regla && regla.producto_id ? "PRODUCTO" : regla && regla.categoria_id ? "CATEGORIA" : "GLOBAL";
    $("regla-producto").value = regla && regla.producto_id ? texto(regla.producto_id) : "";
    $("regla-categoria").value = regla && regla.categoria_id ? texto(regla.categoria_id) : "";
    $("regla-cantidad").value = texto(regla ? numero(regla.cantidad_minima) : 1);
    $("regla-prioridad").value = texto(regla ? numero(regla.prioridad) : 0);
    $("regla-desde").value = fechaParaInput(regla && regla.vigente_desde);
    $("regla-hasta").value = fechaParaInput(regla && regla.vigente_hasta);
    $("regla-activa").checked = regla ? regla.activo !== false : true;
    $("regla-error").textContent = "";
    actualizarAlcanceRegla();
    abrirModal("modal-regla");
  } catch (e) { toast(e.message, "err"); }
}

$("btn-regla-nueva").addEventListener("click", () => void abrirReglaCatalogo());
$("form-regla").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!esSupervisor()) return;
  await conBotonOcupado($("btn-guardar-regla"), "Guardando…", async () => {
    $("regla-error").textContent = "";
    try {
      const nombre = $("regla-nombre").value.trim();
      const tipo = $("regla-tipo").value;
      const valor = Number($("regla-valor").value);
      const cantidad = Number($("regla-cantidad").value);
      const prioridad = Number($("regla-prioridad").value);
      const alcance = $("regla-alcance").value;
      const desdeTexto = $("regla-desde").value;
      const hastaTexto = $("regla-hasta").value;
      const desdeFecha = desdeTexto ? new Date(desdeTexto) : null;
      const hastaFecha = hastaTexto ? new Date(hastaTexto) : null;
      if (nombre.length < 2) throw new Error("El nombre debe tener al menos 2 caracteres.");
      if (!Number.isFinite(valor) || valor < 0 || (tipo === "PORCENTAJE" && valor > 100)) throw new Error("El valor de la regla no es válido.");
      if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error("La cantidad mínima debe ser un entero positivo.");
      if (!Number.isInteger(prioridad)) throw new Error("La prioridad debe ser un entero.");
      if ((desdeFecha && Number.isNaN(desdeFecha.getTime())) || (hastaFecha && Number.isNaN(hastaFecha.getTime()))) throw new Error("Revisa las fechas de vigencia.");
      if (desdeFecha && hastaFecha && hastaFecha <= desdeFecha) throw new Error("La fecha final debe ser posterior a la inicial.");
      const productoId = alcance === "PRODUCTO" ? numero($("regla-producto").value, 0) : 0;
      const categoriaId = alcance === "CATEGORIA" ? numero($("regla-categoria").value, 0) : 0;
      if (alcance === "PRODUCTO" && !productoId) throw new Error("Selecciona el producto de la regla.");
      if (alcance === "CATEGORIA" && !categoriaId) throw new Error("Selecciona la categoría de la regla.");
      const body = {
        nombre,
        canal: $("regla-canal").value,
        segmento_cliente: $("sel-regla-segmento").value,
        tipo,
        valor,
        producto_id: productoId || null,
        categoria_id: categoriaId || null,
        cantidad_minima: cantidad,
        prioridad,
        vigente_desde: desdeFecha ? desdeFecha.toISOString() : null,
        vigente_hasta: hastaFecha ? hastaFecha.toISOString() : null,
        activo: $("regla-activa").checked,
      };
      if (reglaCatalogoActiva) {
        await api("/precios/reglas/" + encodeURIComponent(reglaCatalogoActiva.id), { method: "PATCH", body });
      } else await api("/precios/reglas", { method: "POST", body });
      cerrarModal($("modal-regla"), true);
      await cargarReglasCatalogo();
      if (carrito.length) pintarCarrito();
      toast("Regla de precio guardada.", "ok");
    } catch (err) { $("regla-error").textContent = err.message; }
  });
});

/* ============================================================
   COMPRAS Y PROVEEDORES
============================================================ */
function cambiarComprasSeccion(nombre) {
  if (!esSupervisor() || !["ordenes", "proveedores"].includes(nombre)) return;
  comprasSeccion = nombre;
  document.querySelectorAll(".subtab[data-compras]").forEach((boton) => {
    boton.classList.toggle("active", boton.dataset.compras === nombre);
  });
  document.querySelectorAll(".compras-seccion").forEach((seccion) => {
    seccion.classList.toggle("active", seccion.id === "compras-" + nombre);
  });
  void cargarComprasActivo();
}

document.querySelectorAll(".subtab[data-compras]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarComprasSeccion(boton.dataset.compras));
});

async function cargarOpcionesProveedoresCompra() {
  const acumulados = [];
  for (let pagina = 1; pagina <= 100; pagina += 1) {
    const respuesta = await api(
      "/proveedores?incluir_inactivos=true&page=" + pagina + "&limit=100"
    );
    const lote = extraerLista(respuesta, "proveedores");
    acumulados.push(...lote);
    if (lote.length < 100) break;
  }
  proveedoresOpcionesCompra = acumulados;
  actualizarSelectoresProveedoresCompra();
}

function actualizarSelectoresProveedoresCompra() {
  const todos = [...proveedoresOpcionesCompra].sort((a, b) =>
    texto(a.nombre).localeCompare(texto(b.nombre), "es")
  );
  reponerOpciones(
    $("sel-compra-proveedor-filtro"),
    "Todos los proveedores",
    todos,
    (proveedor) => texto(proveedor.nombre) + (proveedor.activo === false ? " (inactivo)" : "")
  );
  reponerOpciones(
    $("orden-compra-proveedor"),
    "Selecciona un proveedor",
    todos.filter((proveedor) => proveedor.activo !== false),
    (proveedor) => texto(proveedor.nombre)
  );
  reponerOpciones(
    $("sel-reposicion-proveedor"),
    "Todos los proveedores",
    todos,
    (proveedor) => texto(proveedor.nombre) + (proveedor.activo === false ? " (inactivo)" : "")
  );
  reponerOpciones(
    $("politica-proveedor"),
    "Sin proveedor preferido",
    todos.filter((proveedor) => proveedor.activo !== false),
    (proveedor) => texto(proveedor.nombre)
  );
}

async function cargarComprasActivo() {
  if (!esSupervisor()) return;
  try {
    if (!proveedoresOpcionesCompra.length) await cargarOpcionesProveedoresCompra();
    if (comprasSeccion === "proveedores") await cargarProveedoresCompra();
    else await cargarOrdenesCompra();
  } catch (error) {
    toast(error.message, "err");
  }
}

async function cargarProveedoresCompra({ reiniciar = false } = {}) {
  if (!esSupervisor() || proveedoresCargaEnCurso) return;
  if (reiniciar) proveedoresPagina = 1;
  proveedoresCargaEnCurso = true;
  filaVacia($("proveedores-body"), 7, "Cargando proveedores…");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-proveedor-q").value.trim(),
      incluir_inactivos: texto($("chk-proveedores-inactivos").checked),
      page: texto(proveedoresPagina),
      limit: "30",
    });
    const respuesta = await api("/proveedores?" + parametros.toString());
    proveedoresCompra = extraerLista(respuesta, "proveedores");
    proveedoresHaySiguiente = proveedoresCompra.length === 30;
    pintarProveedoresCompra();
  } catch (error) {
    filaVacia($("proveedores-body"), 7, error.message);
  } finally {
    proveedoresCargaEnCurso = false;
    actualizarPaginacionProveedores();
  }
}

function actualizarPaginacionProveedores() {
  $("proveedores-pagina").textContent = "Página " + proveedoresPagina;
  $("btn-proveedores-anterior").disabled = proveedoresCargaEnCurso || proveedoresPagina <= 1;
  $("btn-proveedores-siguiente").disabled = proveedoresCargaEnCurso || !proveedoresHaySiguiente;
}

function pintarProveedoresCompra() {
  const tbody = $("proveedores-body");
  tbody.replaceChildren();
  for (const proveedor of proveedoresCompra) {
    const nombre = document.createElement("td");
    nombre.append(
      nodo("strong", "", texto(proveedor.nombre)),
      nodo("small", "tabla-detalle", texto(proveedor.razon_social, "Sin razón social"))
    );
    const contacto = document.createElement("td");
    contacto.append(
      nodo("span", "", texto(proveedor.contacto, "—")),
      nodo("small", "tabla-detalle", truncar(proveedor.direccion, 60) || "")
    );
    const estado = document.createElement("td");
    estado.appendChild(estadoChip(proveedor.activo !== false));
    const acciones = document.createElement("td");
    const editar = nodo("button", "btn btn-outline", "Editar");
    editar.type = "button";
    editar.addEventListener("click", () => void abrirProveedorCompra(proveedor.id));
    acciones.appendChild(editar);
    const tr = document.createElement("tr");
    tr.append(
      nombre,
      celda(texto(proveedor.rfc, "—")),
      contacto,
      celda(texto(proveedor.telefono, "—")),
      celda(texto(proveedor.email, "—")),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!proveedoresCompra.length) filaVacia(tbody, 7, "No hay proveedores para este filtro.");
}

$("form-proveedores-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarProveedoresCompra({ reiniciar: true });
});
$("chk-proveedores-inactivos").addEventListener("change", () => {
  void cargarProveedoresCompra({ reiniciar: true });
});
$("btn-proveedores-anterior").addEventListener("click", () => {
  if (proveedoresPagina <= 1 || proveedoresCargaEnCurso) return;
  proveedoresPagina -= 1;
  void cargarProveedoresCompra();
});
$("btn-proveedores-siguiente").addEventListener("click", () => {
  if (!proveedoresHaySiguiente || proveedoresCargaEnCurso) return;
  proveedoresPagina += 1;
  void cargarProveedoresCompra();
});

async function abrirProveedorCompra(id = null) {
  if (!esSupervisor()) return;
  try {
    proveedorCompraActivo = id ? await api("/proveedores/" + encodeURIComponent(id)) : null;
    const proveedor = proveedorCompraActivo;
    $("proveedor-modal-titulo").textContent = proveedor ? "Editar proveedor" : "Nuevo proveedor";
    $("proveedor-nombre").value = texto(proveedor && proveedor.nombre);
    $("proveedor-razon-social").value = texto(proveedor && proveedor.razon_social);
    $("proveedor-rfc").value = texto(proveedor && proveedor.rfc);
    $("proveedor-contacto").value = texto(proveedor && proveedor.contacto);
    $("proveedor-telefono").value = texto(proveedor && proveedor.telefono);
    $("proveedor-email").value = texto(proveedor && proveedor.email);
    $("proveedor-direccion").value = texto(proveedor && proveedor.direccion);
    $("proveedor-notas").value = texto(proveedor && proveedor.notas);
    $("proveedor-activo").checked = proveedor ? proveedor.activo !== false : true;
    $("proveedor-error").textContent = "";
    abrirModal("modal-proveedor");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-proveedor-nuevo").addEventListener("click", () => void abrirProveedorCompra());

$("form-proveedor").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor()) return;
  await conBotonOcupado($("btn-guardar-proveedor"), "Guardando…", async () => {
    $("proveedor-error").textContent = "";
    try {
      const opcional = (id) => $(id).value.trim() || null;
      const nombre = $("proveedor-nombre").value.trim();
      const razonSocial = opcional("proveedor-razon-social");
      const rfc = opcional("proveedor-rfc");
      const contacto = opcional("proveedor-contacto");
      const telefono = opcional("proveedor-telefono");
      const email = opcional("proveedor-email");
      const direccion = opcional("proveedor-direccion");
      if (nombre.length < 2) throw new Error("El nombre debe tener al menos 2 caracteres.");
      if (razonSocial && razonSocial.length < 2) throw new Error("Revisa la razón social.");
      if (rfc && rfc.length < 3) throw new Error("El RFC debe tener al menos 3 caracteres.");
      if (contacto && contacto.length < 2) throw new Error("Revisa el nombre de contacto.");
      if (telefono && (telefono.length < 7 || !/^[0-9+()\s.-]+$/.test(telefono))) {
        throw new Error("El teléfono no tiene un formato válido.");
      }
      if (email && !$("proveedor-email").checkValidity()) throw new Error("El correo electrónico no es válido.");
      if (direccion && direccion.length < 3) throw new Error("Revisa la dirección.");
      const body = {
        nombre,
        razon_social: razonSocial,
        rfc,
        contacto,
        telefono,
        email,
        direccion,
        notas: opcional("proveedor-notas"),
        activo: $("proveedor-activo").checked,
      };
      if (proveedorCompraActivo) {
        await api("/proveedores/" + encodeURIComponent(proveedorCompraActivo.id), {
          method: "PATCH", body,
        });
      } else {
        await api("/proveedores", { method: "POST", body });
      }
      proveedorCompraActivo = null;
      cerrarModal($("modal-proveedor"), true);
      proveedoresOpcionesCompra = [];
      await Promise.all([cargarOpcionesProveedoresCompra(), cargarProveedoresCompra({ reiniciar: true })]);
      toast("Proveedor guardado.", "ok");
    } catch (error) {
      $("proveedor-error").textContent = error.message;
    }
  });
});

function etiquetaEstadoCompra(estado) {
  return ({
    EMITIDA: "Emitida",
    PARCIAL: "Recepción parcial",
    RECIBIDA: "Recibida",
    CANCELADA: "Cancelada",
  })[estado] || texto(estado, "—");
}

function chipEstadoCompra(estado) {
  return nodo("span", "estado estado-" + texto(estado).toLowerCase(), etiquetaEstadoCompra(estado));
}

async function cargarOrdenesCompra({ reiniciar = false } = {}) {
  if (!esSupervisor() || comprasCargaEnCurso) return;
  if (reiniciar) comprasPagina = 1;
  comprasCargaEnCurso = true;
  filaVacia($("compras-body"), 8, "Cargando órdenes…");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-compra-q").value.trim(),
      page: texto(comprasPagina),
      limit: "30",
    });
    if ($("sel-compra-estado").value) parametros.set("estado", $("sel-compra-estado").value);
    if ($("sel-compra-proveedor-filtro").value) {
      parametros.set("proveedor_id", $("sel-compra-proveedor-filtro").value);
    }
    const respuesta = await api("/compras/ordenes?" + parametros.toString());
    ordenesCompra = extraerLista(respuesta, "ordenes");
    comprasHaySiguiente = ordenesCompra.length === 30;
    pintarOrdenesCompra();
  } catch (error) {
    filaVacia($("compras-body"), 8, error.message);
  } finally {
    comprasCargaEnCurso = false;
    actualizarPaginacionCompras();
  }
}

function actualizarPaginacionCompras() {
  $("compras-pagina").textContent = "Página " + comprasPagina;
  $("btn-compras-anterior").disabled = comprasCargaEnCurso || comprasPagina <= 1;
  $("btn-compras-siguiente").disabled = comprasCargaEnCurso || !comprasHaySiguiente;
}

function pintarOrdenesCompra() {
  const tbody = $("compras-body");
  tbody.replaceChildren();
  for (const orden of ordenesCompra) {
    const proveedor = document.createElement("td");
    proveedor.append(
      nodo("strong", "", texto(orden.proveedor_nombre)),
      nodo("small", "tabla-detalle", "Por " + texto(orden.creado_por, "—"))
    );
    const unidades = document.createElement("td");
    unidades.append(
      nodo("span", "", numero(orden.unidades_recibidas) + " / " + numero(orden.unidades_ordenadas)),
      nodo("small", "tabla-detalle", numero(orden.unidades_pendientes) + " pendientes")
    );
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoCompra(orden.estado));
    const acciones = document.createElement("td");
    const ver = nodo("button", "btn btn-outline", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => void abrirOrdenCompra(orden.id));
    acciones.appendChild(ver);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(orden.folio)),
      celda(hora(orden.creado_en)),
      proveedor,
      celda(texto(orden.referencia, "—")),
      unidades,
      celda(fmt(orden.total)),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!ordenesCompra.length) filaVacia(tbody, 8, "No hay órdenes para este filtro.");
}

$("form-compras-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarOrdenesCompra({ reiniciar: true });
});
$("btn-refrescar-compras").addEventListener("click", () => void cargarOrdenesCompra());
$("btn-compras-anterior").addEventListener("click", () => {
  if (comprasPagina <= 1 || comprasCargaEnCurso) return;
  comprasPagina -= 1;
  void cargarOrdenesCompra();
});
$("btn-compras-siguiente").addEventListener("click", () => {
  if (!comprasHaySiguiente || comprasCargaEnCurso) return;
  comprasPagina += 1;
  void cargarOrdenesCompra();
});

function redondearCompra(valor) {
  return Math.round((numero(valor) + Number.EPSILON) * 100) / 100;
}

function totalesCapturaOrden() {
  let subtotal = 0;
  let iva = 0;
  for (const linea of ordenCompraLineas) {
    const base = redondearCompra(numero(linea.costo_unitario) * numero(linea.cantidad));
    subtotal += base;
    iva += redondearCompra(base * numero(linea.iva_porcentaje) / 100);
  }
  subtotal = redondearCompra(subtotal);
  iva = redondearCompra(iva);
  return { subtotal, iva, total: redondearCompra(subtotal + iva) };
}

function actualizarTotalesCapturaOrden() {
  const totales = totalesCapturaOrden();
  $("orden-compra-subtotal").textContent = fmt(totales.subtotal);
  $("orden-compra-iva").textContent = fmt(totales.iva);
  $("orden-compra-total").textContent = fmt(totales.total);
}

function entradaLineaOrden({ valor, min, max, step, clase, etiqueta, alCambiar }) {
  const input = document.createElement("input");
  input.className = "inp inp-tabla " + clase;
  input.type = "number";
  input.min = texto(min);
  input.max = texto(max);
  input.step = texto(step);
  input.value = texto(valor);
  input.setAttribute("aria-label", etiqueta);
  input.addEventListener("input", () => alCambiar(input.value));
  return input;
}

function pintarLineasOrdenCompra() {
  const tbody = $("orden-compra-detalle-body");
  tbody.replaceChildren();
  for (const linea of ordenCompraLineas) {
    const producto = document.createElement("td");
    producto.append(
      nodo("strong", "", texto(linea.titulo)),
      nodo("small", "tabla-detalle", texto(linea.sku))
    );
    const importeTd = celda("");
    const actualizarImporte = () => {
      importeTd.textContent = fmt(redondearCompra(
        numero(linea.costo_unitario) * numero(linea.cantidad)
      ));
      actualizarTotalesCapturaOrden();
    };
    const cantidadTd = document.createElement("td");
    cantidadTd.appendChild(entradaLineaOrden({
      valor: linea.cantidad, min: 1, max: 999, step: 1,
      clase: "orden-cantidad", etiqueta: "Cantidad de " + texto(linea.titulo),
      alCambiar: (valor) => {
        linea.cantidad = Number(valor);
        actualizarImporte();
      },
    }));
    const costoTd = document.createElement("td");
    costoTd.appendChild(entradaLineaOrden({
      valor: linea.costo_unitario, min: 0, max: 999999, step: 0.01,
      clase: "orden-costo", etiqueta: "Costo de " + texto(linea.titulo),
      alCambiar: (valor) => {
        linea.costo_unitario = Number(valor);
        actualizarImporte();
      },
    }));
    const ivaTd = document.createElement("td");
    ivaTd.appendChild(entradaLineaOrden({
      valor: linea.iva_porcentaje, min: 0, max: 100, step: 0.01,
      clase: "orden-iva", etiqueta: "IVA de " + texto(linea.titulo),
      alCambiar: (valor) => {
        linea.iva_porcentaje = Number(valor);
        actualizarTotalesCapturaOrden();
      },
    }));
    const quitarTd = document.createElement("td");
    const quitar = nodo("button", "btn btn-ghost", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", () => {
      if (emisionCompraEnCurso || intentoEmisionCompra) return;
      ordenCompraLineas = ordenCompraLineas.filter((item) => item.producto_id !== linea.producto_id);
      pintarLineasOrdenCompra();
    });
    quitarTd.appendChild(quitar);
    actualizarImporte();
    const tr = document.createElement("tr");
    tr.append(producto, cantidadTd, costoTd, ivaTd, importeTd, quitarTd);
    tbody.appendChild(tr);
  }
  if (!ordenCompraLineas.length) filaVacia(tbody, 6, "Busca y agrega al menos un producto.");
  actualizarTotalesCapturaOrden();
  actualizarBloqueoEmisionCompra();
}

function actualizarBloqueoEmisionCompra() {
  const congelado = Boolean(intentoEmisionCompra);
  document.querySelectorAll(
    "#form-orden-compra input, #form-orden-compra select, #form-orden-compra textarea, "
    + "#orden-compra-detalle-body input, #orden-compra-detalle-body button"
  ).forEach((control) => {
    control.disabled = emisionCompraEnCurso || congelado;
  });
  $("inp-orden-producto-q").disabled = emisionCompraEnCurso || congelado;
  $("btn-emitir-orden-compra").disabled = emisionCompraEnCurso
    || (!congelado && !ordenCompraLineas.length);
  $("btn-emitir-orden-compra").textContent = emisionCompraEnCurso
    ? "Emitiendo…" : congelado ? "Reintentar emisión" : "Emitir orden";
}

function agregarProductoOrden(producto) {
  if (!esSupervisor() || emisionCompraEnCurso || intentoEmisionCompra || producto.activo === false) return;
  const existente = ordenCompraLineas.find((linea) => numero(linea.producto_id) === numero(producto.id));
  if (existente) {
    existente.cantidad = Math.min(999, numero(existente.cantidad, 1) + 1);
  } else {
    if (ordenCompraLineas.length >= 200) {
      toast("La orden admite como máximo 200 partidas.", "err");
      return;
    }
    ordenCompraLineas.push({
      producto_id: numero(producto.id),
      sku: texto(producto.sku),
      titulo: texto(producto.titulo),
      cantidad: 1,
      costo_unitario: numero(producto.costo),
      iva_porcentaje: numero(producto.iva),
    });
  }
  $("inp-orden-producto-q").value = "";
  $("orden-producto-resultados").replaceChildren();
  pintarLineasOrdenCompra();
}

async function buscarProductosOrden() {
  const q = $("inp-orden-producto-q").value.trim();
  const version = ++ordenProductoVersion;
  const resultados = $("orden-producto-resultados");
  if (q.length < 2 || intentoEmisionCompra) {
    resultados.replaceChildren();
    return;
  }
  resultados.replaceChildren(nodo("p", "subtle", "Buscando…"));
  try {
    const respuesta = await api("/productos?q=" + encodeURIComponent(q) + "&page=1&limit=20");
    if (version !== ordenProductoVersion) return;
    const productos = extraerLista(respuesta, "productos").filter((producto) => producto.activo !== false);
    resultados.replaceChildren();
    for (const producto of productos) {
      const tarjeta = nodo("div", "result-card");
      const info = document.createElement("div");
      info.append(
        nodo("div", "t", texto(producto.titulo)),
        nodo("div", "m", texto(producto.sku) + " · " + texto(producto.autor, "Sin autor")
          + " · Último costo " + fmt(producto.costo) + " · IVA " + numero(producto.iva) + "%")
      );
      const agregar = nodo("button", "btn btn-outline", "Agregar");
      agregar.type = "button";
      agregar.addEventListener("click", () => agregarProductoOrden(producto));
      tarjeta.append(info, agregar);
      resultados.appendChild(tarjeta);
    }
    if (!productos.length) resultados.appendChild(nodo("p", "subtle", "No hay productos activos para esta búsqueda."));
  } catch (error) {
    if (version === ordenProductoVersion) resultados.replaceChildren(nodo("p", "form-error", error.message));
  }
}

$("inp-orden-producto-q").addEventListener("input", () => {
  clearTimeout(ordenProductoTimer);
  ordenProductoTimer = setTimeout(() => void buscarProductosOrden(), 300);
});

async function abrirNuevaOrdenCompra({ proveedorId = null, lineas = [] } = {}) {
  if (!esSupervisor()) return;
  try {
    if (!proveedoresOpcionesCompra.length) await cargarOpcionesProveedoresCompra();
    if (!proveedoresOpcionesCompra.some((proveedor) => proveedor.activo !== false)) {
      toast("Registra un proveedor activo antes de emitir una orden.", "err");
      cambiarComprasSeccion("proveedores");
      return;
    }
    ordenCompraActiva = null;
    ordenCompraLineas = lineas.map((linea) => ({ ...linea }));
    intentoEmisionCompra = null;
    clearTimeout(ordenProductoTimer);
    ordenProductoVersion += 1;
    $("form-orden-compra").reset();
    actualizarSelectoresProveedoresCompra();
    if (proveedorId != null) $("orden-compra-proveedor").value = texto(proveedorId);
    $("orden-producto-resultados").replaceChildren();
    $("orden-compra-error").textContent = "";
    $("orden-compra-modal-titulo").textContent = "Nueva orden de compra";
    $("orden-compra-captura").classList.remove("hidden");
    $("orden-compra-consulta").classList.add("hidden");
    $("btn-emitir-orden-compra").classList.remove("hidden");
    pintarLineasOrdenCompra();
    abrirModal("modal-orden-compra");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-compra-nueva").addEventListener("click", () => void abrirNuevaOrdenCompra());

function cuerpoEmisionOrden() {
  const proveedorId = numero($("orden-compra-proveedor").value, 0);
  if (!proveedorId) throw new Error("Selecciona un proveedor activo.");
  if (!ordenCompraLineas.length) throw new Error("Agrega al menos un producto.");
  const items = ordenCompraLineas.map((linea) => {
    const cantidad = Number(linea.cantidad);
    const costo = Number(linea.costo_unitario);
    const iva = Number(linea.iva_porcentaje);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
      throw new Error("Todas las cantidades deben ser enteros entre 1 y 999.");
    }
    if (!Number.isFinite(costo) || costo < 0 || costo > 999999) {
      throw new Error("Revisa los costos unitarios.");
    }
    if (!Number.isFinite(iva) || iva < 0 || iva > 100) throw new Error("Revisa los porcentajes de IVA.");
    return {
      producto_id: numero(linea.producto_id),
      cantidad,
      costo_unitario: redondearCompra(costo),
      iva_porcentaje: redondearCompra(iva),
    };
  });
  return {
    proveedor_id: proveedorId,
    referencia: $("orden-compra-referencia").value.trim() || null,
    notas: $("orden-compra-notas").value.trim() || null,
    items,
  };
}

$("form-orden-compra").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || emisionCompraEnCurso) return;
  $("orden-compra-error").textContent = "";
  try {
    if (!intentoEmisionCompra) {
      intentoEmisionCompra = { clave: nuevaClaveIdempotencia(), body: cuerpoEmisionOrden() };
    }
  } catch (error) {
    $("orden-compra-error").textContent = error.message;
    return;
  }
  emisionCompraEnCurso = true;
  actualizarBloqueoEmisionCompra();
  try {
    const orden = await api("/compras/ordenes", {
      method: "POST",
      body: intentoEmisionCompra.body,
      headers: { "Idempotency-Key": intentoEmisionCompra.clave },
    });
    intentoEmisionCompra = null;
    ordenCompraActiva = orden;
    pintarOrdenCompraActiva();
    await cargarOrdenesCompra({ reiniciar: true });
    if (inventarioSeccion === "reposicion") await cargarReposicion();
    toast("Orden " + texto(orden.folio) + " emitida.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoEmisionCompra = null;
    $("orden-compra-error").textContent = intentoEmisionCompra
      ? error.message + " La clave se conservó; vuelve a intentar la misma emisión."
      : error.message;
  } finally {
    emisionCompraEnCurso = false;
    actualizarBloqueoEmisionCompra();
  }
});

function resumenCompraDato(etiqueta, valor) {
  const bloque = document.createElement("div");
  bloque.append(nodo("span", "", etiqueta), nodo("strong", "", valor));
  return bloque;
}

async function abrirOrdenCompra(id) {
  if (!esSupervisor()) return;
  try {
    ordenCompraActiva = await api("/compras/ordenes/" + encodeURIComponent(id));
    intentoEmisionCompra = null;
    intentoRecepcionCompra = null;
    intentoDevolucionProveedor = null;
    intentoCancelacionCompra = null;
    pintarOrdenCompraActiva();
    abrirModal("modal-orden-compra");
  } catch (error) {
    toast(error.message, "err");
  }
}

function pintarOrdenCompraActiva() {
  if (!ordenCompraActiva) return;
  const orden = ordenCompraActiva;
  $("orden-compra-modal-titulo").textContent = "Orden " + texto(orden.folio);
  $("orden-compra-captura").classList.add("hidden");
  $("orden-compra-consulta").classList.remove("hidden");
  $("btn-emitir-orden-compra").classList.add("hidden");
  $("orden-compra-error").textContent = "";

  const resumen = $("orden-compra-resumen");
  resumen.replaceChildren(
    resumenCompraDato("Estado", etiquetaEstadoCompra(orden.estado)),
    resumenCompraDato("Proveedor", texto(orden.proveedor_nombre)),
    resumenCompraDato("Referencia", texto(orden.referencia, "Sin referencia")),
    resumenCompraDato("Total", fmt(orden.total)),
    resumenCompraDato("Emitida", hora(orden.creado_en)),
    resumenCompraDato("Responsable", texto(orden.creado_por, "—"))
  );
  const notas = $("orden-compra-notas-consulta");
  notas.textContent = orden.notas ? "Notas: " + texto(orden.notas) : "";
  notas.classList.toggle("hidden", !orden.notas);

  const detalle = Array.isArray(orden.detalle) ? orden.detalle : [];
  const detalleBody = $("orden-compra-consulta-body");
  detalleBody.replaceChildren();
  for (const linea of detalle) {
    const producto = document.createElement("td");
    producto.append(
      nodo("strong", "", texto(linea.producto_titulo)),
      nodo("small", "tabla-detalle", texto(linea.producto_sku))
    );
    const tr = document.createElement("tr");
    tr.append(
      producto,
      celda(numero(linea.cantidad)),
      celda(numero(linea.cantidad_recibida)),
      celda(numero(linea.cantidad_devuelta)),
      celda(numero(linea.cantidad_pendiente)),
      celda(numero(linea.cantidad_neta)),
      celda(fmt(linea.costo_unitario)),
      celda(fmt(linea.total))
    );
    detalleBody.appendChild(tr);
  }
  if (!detalle.length) filaVacia(detalleBody, 8, "La orden no tiene partidas.");

  pintarHistorialOrdenCompra();
  actualizarAccionesOrdenCompra();
}

function pintarHistorialOrdenCompra() {
  const orden = ordenCompraActiva;
  const recepciones = Array.isArray(orden.recepciones) ? orden.recepciones : [];
  const recepcionesBody = $("orden-compra-recepciones-body");
  recepcionesBody.replaceChildren();
  for (const recepcion of recepciones) {
    const unidades = (Array.isArray(recepcion.detalle) ? recepcion.detalle : [])
      .reduce((suma, linea) => suma + numero(linea.cantidad), 0);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(recepcion.folio)),
      celda(hora(recepcion.creado_en)),
      celda(texto(recepcion.referencia, "—")),
      celda(unidades),
      celda(fmt(recepcion.total)),
      celda(texto(recepcion.recibido_por, "—"))
    );
    recepcionesBody.appendChild(tr);
  }
  if (!recepciones.length) filaVacia(recepcionesBody, 6, "Todavía no hay recepciones.");

  const devoluciones = Array.isArray(orden.devoluciones) ? orden.devoluciones : [];
  const devolucionesBody = $("orden-compra-devoluciones-body");
  devolucionesBody.replaceChildren();
  for (const devolucion of devoluciones) {
    const unidades = (Array.isArray(devolucion.detalle) ? devolucion.detalle : [])
      .reduce((suma, linea) => suma + numero(linea.cantidad), 0);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(devolucion.folio)),
      celda(hora(devolucion.creado_en)),
      celda(texto(devolucion.referencia, "—")),
      celda(truncar(devolucion.motivo, 70)),
      celda(unidades),
      celda(fmt(devolucion.total)),
      celda(texto(devolucion.creado_por, "—"))
    );
    devolucionesBody.appendChild(tr);
  }
  if (!devoluciones.length) filaVacia(devolucionesBody, 7, "Todavía no hay devoluciones.");

  const transiciones = Array.isArray(orden.transiciones) ? orden.transiciones : [];
  const transicionesBody = $("orden-compra-transiciones-body");
  transicionesBody.replaceChildren();
  for (const transicion of transiciones) {
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(transicion.creado_en)),
      celda(transicion.estado_anterior ? etiquetaEstadoCompra(transicion.estado_anterior) : "Inicio"),
      celda(etiquetaEstadoCompra(transicion.estado_nuevo)),
      celda(texto(transicion.motivo, "—")),
      celda(texto(transicion.usuario, "—"))
    );
    transicionesBody.appendChild(tr);
  }
  if (!transiciones.length) filaVacia(transicionesBody, 5, "No hay transiciones registradas.");
}

function lineasRecibidasDevolvibles() {
  const recepciones = Array.isArray(ordenCompraActiva && ordenCompraActiva.recepciones)
    ? ordenCompraActiva.recepciones : [];
  return recepciones.flatMap((recepcion) =>
    (Array.isArray(recepcion.detalle) ? recepcion.detalle : []).map((linea) => ({
      ...linea,
      recepcion_folio: recepcion.folio,
      recepcion_referencia: recepcion.referencia,
      recepcion_creado_en: recepcion.creado_en,
    }))
  ).filter((linea) => numero(linea.cantidad_disponible_devolver) > 0);
}

function actualizarAccionesOrdenCompra() {
  if (!ordenCompraActiva) return;
  const admiteRemanente = ["EMITIDA", "PARCIAL"].includes(ordenCompraActiva.estado);
  const pendiente = (ordenCompraActiva.detalle || []).some((linea) => numero(linea.cantidad_pendiente) > 0);
  const puedeRecibir = admiteRemanente && pendiente;
  const puedeDevolver = lineasRecibidasDevolvibles().length > 0;
  $("btn-abrir-recepcion-compra").classList.toggle("hidden", !puedeRecibir);
  $("btn-abrir-cancelacion-compra").classList.toggle("hidden", !puedeRecibir);
  $("btn-abrir-devolucion-proveedor").classList.toggle("hidden", !puedeDevolver);
  $("btn-abrir-cancelacion-compra").textContent = ordenCompraActiva.estado === "PARCIAL"
    ? "Cancelar remanente" : "Cancelar orden";

  const aviso = $("orden-compra-operacion-aviso");
  let mensaje = "";
  if (ordenCompraActiva.estado === "RECIBIDA") {
    mensaje = "La orden está recibida por completo. Sólo pueden registrarse devoluciones de unidades disponibles.";
  } else if (ordenCompraActiva.estado === "CANCELADA") {
    mensaje = "La orden está cancelada. Lo recibido anteriormente permanece en inventario hasta que se registre una devolución.";
  }
  aviso.textContent = mensaje;
  aviso.classList.toggle("hidden", !mensaje);
}

function actualizarBloqueoRecepcionCompra() {
  const congelado = Boolean(intentoRecepcionCompra);
  document.querySelectorAll(
    "#form-recepcion-compra input, #form-recepcion-compra textarea, #recepcion-compra-body input"
  ).forEach((control) => {
    control.disabled = recepcionCompraEnCurso || congelado;
  });
  $("btn-confirmar-recepcion-compra").disabled = recepcionCompraEnCurso;
  $("btn-confirmar-recepcion-compra").textContent = recepcionCompraEnCurso
    ? "Registrando…" : congelado ? "Reintentar recepción" : "Confirmar recepción";
}

function abrirRecepcionCompra() {
  if (!ordenCompraActiva || !esSupervisor()) return;
  const pendientes = (ordenCompraActiva.detalle || [])
    .filter((linea) => numero(linea.cantidad_pendiente) > 0);
  if (!["EMITIDA", "PARCIAL"].includes(ordenCompraActiva.estado) || !pendientes.length) {
    return toast("La orden ya no admite recepciones.", "err");
  }
  intentoRecepcionCompra = null;
  $("form-recepcion-compra").reset();
  $("recepcion-compra-error").textContent = "";
  $("recepcion-compra-titulo").textContent = "Recibir · " + texto(ordenCompraActiva.folio);
  $("recepcion-compra-resumen").textContent = texto(ordenCompraActiva.proveedor_nombre)
    + " · Captura únicamente las unidades recibidas en esta entrega.";
  const tbody = $("recepcion-compra-body");
  tbody.replaceChildren();
  for (const linea of pendientes) {
    const producto = document.createElement("td");
    producto.append(
      nodo("strong", "", texto(linea.producto_titulo)),
      nodo("small", "tabla-detalle", texto(linea.producto_sku))
    );
    const cantidadTd = document.createElement("td");
    const cantidad = document.createElement("input");
    cantidad.className = "inp inp-tabla recepcion-cantidad";
    cantidad.type = "number";
    cantidad.min = "0";
    cantidad.max = texto(numero(linea.cantidad_pendiente));
    cantidad.step = "1";
    cantidad.value = "0";
    cantidad.dataset.detalleId = texto(linea.id);
    cantidad.setAttribute("aria-label", "Recibir " + texto(linea.producto_titulo));
    cantidadTd.appendChild(cantidad);
    const costoTd = document.createElement("td");
    const costo = document.createElement("input");
    costo.className = "inp inp-tabla recepcion-costo";
    costo.type = "number";
    costo.min = "0";
    costo.max = "999999";
    costo.step = "0.01";
    costo.value = numero(linea.costo_unitario).toFixed(2);
    costo.dataset.detalleId = texto(linea.id);
    costo.setAttribute("aria-label", "Costo real de " + texto(linea.producto_titulo));
    costoTd.appendChild(costo);
    const tr = document.createElement("tr");
    tr.append(producto, celda(numero(linea.cantidad_pendiente)), cantidadTd, costoTd);
    tbody.appendChild(tr);
  }
  actualizarBloqueoRecepcionCompra();
  abrirModal("modal-recepcion-compra");
}

$("btn-abrir-recepcion-compra").addEventListener("click", abrirRecepcionCompra);

function cuerpoRecepcionCompra() {
  const costos = new Map(Array.from(document.querySelectorAll(".recepcion-costo")).map((input) => [
    numero(input.dataset.detalleId), Number(input.value),
  ]));
  const capturas = Array.from(document.querySelectorAll(".recepcion-cantidad")).map((input) => ({
    detalle_orden_compra_id: numero(input.dataset.detalleId),
    cantidad: Number(input.value),
    maximo: numero(input.max),
    costo_unitario: costos.get(numero(input.dataset.detalleId)),
  }));
  if (capturas.some((item) => !Number.isInteger(item.cantidad)
    || item.cantidad < 0 || item.cantidad > item.maximo)) {
    throw new Error("Las cantidades deben ser enteras y no superar lo pendiente.");
  }
  const items = capturas.filter((item) => item.cantidad > 0).map((item) => {
    if (!Number.isFinite(item.costo_unitario)
      || item.costo_unitario < 0 || item.costo_unitario > 999999) {
      throw new Error("Revisa los costos reales de las partidas recibidas.");
    }
    return {
      detalle_orden_compra_id: item.detalle_orden_compra_id,
      cantidad: item.cantidad,
      costo_unitario: redondearCompra(item.costo_unitario),
    };
  });
  if (!items.length) throw new Error("Indica al menos una cantidad recibida.");
  return {
    referencia: $("recepcion-compra-referencia").value.trim() || null,
    notas: $("recepcion-compra-notas").value.trim() || null,
    items,
  };
}

$("form-recepcion-compra").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!ordenCompraActiva || !esSupervisor() || recepcionCompraEnCurso) return;
  $("recepcion-compra-error").textContent = "";
  try {
    if (!intentoRecepcionCompra) {
      intentoRecepcionCompra = { clave: nuevaClaveIdempotencia(), body: cuerpoRecepcionCompra() };
    }
  } catch (error) {
    $("recepcion-compra-error").textContent = error.message;
    return;
  }
  recepcionCompraEnCurso = true;
  actualizarBloqueoRecepcionCompra();
  try {
    const resultado = await api(
      "/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id) + "/recepciones",
      {
        method: "POST",
        body: intentoRecepcionCompra.body,
        headers: { "Idempotency-Key": intentoRecepcionCompra.clave },
      }
    );
    intentoRecepcionCompra = null;
    ordenCompraActiva = resultado.orden;
    cerrarModal($("modal-recepcion-compra"), true);
    pintarOrdenCompraActiva();
    await Promise.all([
      cargarOrdenesCompra({ reiniciar: true }),
      cargarInventario($("inp-inv-q").value),
    ]);
    toast("Recepción " + texto(resultado.recepcion && resultado.recepcion.folio) + " registrada.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoRecepcionCompra = null;
    $("recepcion-compra-error").textContent = intentoRecepcionCompra
      ? error.message + " La clave se conservó; vuelve a intentar la misma recepción."
      : error.message;
    if (!intentoRecepcionCompra) {
      ordenCompraActiva = await api("/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id))
        .catch(() => ordenCompraActiva);
    }
  } finally {
    recepcionCompraEnCurso = false;
    actualizarBloqueoRecepcionCompra();
    if (ordenCompraActiva && $("modal-orden-compra").classList.contains("open")) {
      pintarOrdenCompraActiva();
    }
  }
});

function actualizarBloqueoCancelacionCompra() {
  const congelado = Boolean(intentoCancelacionCompra);
  const etiqueta = ordenCompraActiva && ordenCompraActiva.estado === "PARCIAL"
    ? "Cancelar remanente" : "Cancelar orden";
  $("cancelacion-compra-motivo").disabled = cancelacionCompraEnCurso || congelado;
  $("btn-confirmar-cancelacion-compra").disabled = cancelacionCompraEnCurso;
  $("btn-confirmar-cancelacion-compra").textContent = cancelacionCompraEnCurso
    ? "Cancelando…" : congelado ? "Reintentar cancelación" : etiqueta;
}

function abrirCancelacionCompra() {
  if (!ordenCompraActiva || !esSupervisor()) return;
  if (!["EMITIDA", "PARCIAL"].includes(ordenCompraActiva.estado)) {
    return toast("La orden ya no admite cancelación.", "err");
  }
  intentoCancelacionCompra = null;
  $("form-cancelacion-compra").reset();
  $("cancelacion-compra-error").textContent = "";
  const parcial = ordenCompraActiva.estado === "PARCIAL";
  $("cancelacion-compra-titulo").textContent = parcial ? "Cancelar remanente" : "Cancelar orden";
  $("cancelacion-compra-resumen").textContent = parcial
    ? "Se cerrará el pendiente de " + texto(ordenCompraActiva.folio)
      + ". Lo ya recibido permanecerá en inventario."
    : "Se cancelará " + texto(ordenCompraActiva.folio) + " sin afectar inventario.";
  $("btn-confirmar-cancelacion-compra").textContent = parcial ? "Cancelar remanente" : "Cancelar orden";
  actualizarBloqueoCancelacionCompra();
  abrirModal("modal-cancelacion-compra");
}

$("btn-abrir-cancelacion-compra").addEventListener("click", abrirCancelacionCompra);

$("form-cancelacion-compra").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!ordenCompraActiva || !esSupervisor() || cancelacionCompraEnCurso) return;
  $("cancelacion-compra-error").textContent = "";
  if (!intentoCancelacionCompra) {
    const motivo = $("cancelacion-compra-motivo").value.trim();
    if (motivo.length < 3) {
      $("cancelacion-compra-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
      return;
    }
    intentoCancelacionCompra = {
      clave: nuevaClaveIdempotencia(),
      body: { motivo },
    };
  }
  cancelacionCompraEnCurso = true;
  actualizarBloqueoCancelacionCompra();
  try {
    const orden = await api(
      "/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id) + "/cancelacion",
      {
        method: "POST",
        body: intentoCancelacionCompra.body,
        headers: { "Idempotency-Key": intentoCancelacionCompra.clave },
      }
    );
    intentoCancelacionCompra = null;
    ordenCompraActiva = orden;
    cerrarModal($("modal-cancelacion-compra"), true);
    pintarOrdenCompraActiva();
    await Promise.all([
      cargarOrdenesCompra({ reiniciar: true }),
      cargarInventario($("inp-inv-q").value),
    ]);
    toast("Orden " + texto(orden.folio) + " cancelada.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoCancelacionCompra = null;
    $("cancelacion-compra-error").textContent = intentoCancelacionCompra
      ? error.message + " La clave se conservó; vuelve a intentar la misma cancelación."
      : error.message;
    if (!intentoCancelacionCompra) {
      ordenCompraActiva = await api("/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id))
        .catch(() => ordenCompraActiva);
    }
  } finally {
    cancelacionCompraEnCurso = false;
    actualizarBloqueoCancelacionCompra();
    if (ordenCompraActiva && $("modal-orden-compra").classList.contains("open")) {
      pintarOrdenCompraActiva();
    }
  }
});

function actualizarBloqueoDevolucionProveedor() {
  const congelado = Boolean(intentoDevolucionProveedor);
  document.querySelectorAll(
    "#form-devolucion-proveedor input, #form-devolucion-proveedor textarea, "
    + "#devolucion-proveedor-body input"
  ).forEach((control) => {
    control.disabled = devolucionProveedorEnCurso || congelado;
  });
  $("btn-confirmar-devolucion-proveedor").disabled = devolucionProveedorEnCurso;
  $("btn-confirmar-devolucion-proveedor").textContent = devolucionProveedorEnCurso
    ? "Registrando…" : congelado ? "Reintentar devolución" : "Confirmar devolución";
}

function abrirDevolucionProveedor() {
  if (!ordenCompraActiva || !esSupervisor()) return;
  const lineas = lineasRecibidasDevolvibles();
  if (!lineas.length) return toast("No hay unidades recibidas disponibles para devolver.", "err");
  intentoDevolucionProveedor = null;
  $("form-devolucion-proveedor").reset();
  $("devolucion-proveedor-error").textContent = "";
  $("devolucion-proveedor-titulo").textContent = "Devolver · " + texto(ordenCompraActiva.folio);
  $("devolucion-proveedor-resumen").textContent = texto(ordenCompraActiva.proveedor_nombre)
    + " · Selecciona las unidades por recepción de origen.";
  const tbody = $("devolucion-proveedor-body");
  tbody.replaceChildren();
  for (const linea of lineas) {
    const recepcion = document.createElement("td");
    recepcion.append(
      nodo("strong", "", texto(linea.recepcion_folio)),
      nodo("small", "tabla-detalle", texto(linea.recepcion_referencia, hora(linea.recepcion_creado_en)))
    );
    const producto = document.createElement("td");
    producto.append(
      nodo("strong", "", texto(linea.producto_titulo)),
      nodo("small", "tabla-detalle", texto(linea.producto_sku))
    );
    const cantidadTd = document.createElement("td");
    const cantidad = document.createElement("input");
    cantidad.className = "inp inp-tabla devolucion-proveedor-cantidad";
    cantidad.type = "number";
    cantidad.min = "0";
    cantidad.max = texto(numero(linea.cantidad_disponible_devolver));
    cantidad.step = "1";
    cantidad.value = "0";
    cantidad.dataset.detalleRecepcionId = texto(linea.id);
    cantidad.setAttribute("aria-label", "Devolver " + texto(linea.producto_titulo)
      + " de " + texto(linea.recepcion_folio));
    cantidadTd.appendChild(cantidad);
    const tr = document.createElement("tr");
    tr.append(
      recepcion,
      producto,
      celda(numero(linea.cantidad)),
      celda(numero(linea.cantidad_devuelta)),
      celda(numero(linea.cantidad_disponible_devolver)),
      cantidadTd
    );
    tbody.appendChild(tr);
  }
  actualizarBloqueoDevolucionProveedor();
  abrirModal("modal-devolucion-proveedor");
}

$("btn-abrir-devolucion-proveedor").addEventListener("click", abrirDevolucionProveedor);

function cuerpoDevolucionProveedor() {
  const motivo = $("devolucion-proveedor-motivo").value.trim();
  if (motivo.length < 3) throw new Error("Escribe un motivo de al menos 3 caracteres.");
  const capturas = Array.from(document.querySelectorAll(".devolucion-proveedor-cantidad"))
    .map((input) => ({
      detalle_recepcion_compra_id: numero(input.dataset.detalleRecepcionId),
      cantidad: Number(input.value),
      maximo: numero(input.max),
    }));
  if (capturas.some((item) => !Number.isInteger(item.cantidad)
    || item.cantidad < 0 || item.cantidad > item.maximo)) {
    throw new Error("Las cantidades deben ser enteras y no superar lo disponible.");
  }
  const items = capturas
    .filter((item) => item.cantidad > 0)
    .map(({ detalle_recepcion_compra_id, cantidad }) => ({ detalle_recepcion_compra_id, cantidad }));
  if (!items.length) throw new Error("Indica al menos una cantidad a devolver.");
  return {
    motivo,
    referencia: $("devolucion-proveedor-referencia").value.trim() || null,
    notas: $("devolucion-proveedor-notas").value.trim() || null,
    items,
  };
}

$("form-devolucion-proveedor").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!ordenCompraActiva || !esSupervisor() || devolucionProveedorEnCurso) return;
  $("devolucion-proveedor-error").textContent = "";
  try {
    if (!intentoDevolucionProveedor) {
      intentoDevolucionProveedor = {
        clave: nuevaClaveIdempotencia(),
        body: cuerpoDevolucionProveedor(),
      };
    }
  } catch (error) {
    $("devolucion-proveedor-error").textContent = error.message;
    return;
  }
  devolucionProveedorEnCurso = true;
  actualizarBloqueoDevolucionProveedor();
  try {
    const resultado = await api(
      "/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id) + "/devoluciones",
      {
        method: "POST",
        body: intentoDevolucionProveedor.body,
        headers: { "Idempotency-Key": intentoDevolucionProveedor.clave },
      }
    );
    intentoDevolucionProveedor = null;
    ordenCompraActiva = resultado.orden;
    cerrarModal($("modal-devolucion-proveedor"), true);
    pintarOrdenCompraActiva();
    await Promise.all([
      cargarOrdenesCompra({ reiniciar: true }),
      cargarInventario($("inp-inv-q").value),
    ]);
    toast("Devolución " + texto(resultado.devolucion && resultado.devolucion.folio)
      + " registrada.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoDevolucionProveedor = null;
    $("devolucion-proveedor-error").textContent = intentoDevolucionProveedor
      ? error.message + " La clave se conservó; vuelve a intentar la misma devolución."
      : error.message;
    if (!intentoDevolucionProveedor) {
      ordenCompraActiva = await api("/compras/ordenes/" + encodeURIComponent(ordenCompraActiva.id))
        .catch(() => ordenCompraActiva);
    }
  } finally {
    devolucionProveedorEnCurso = false;
    actualizarBloqueoDevolucionProveedor();
    if (ordenCompraActiva && $("modal-orden-compra").classList.contains("open")) {
      pintarOrdenCompraActiva();
    }
  }
});

/* ============================================================
   REPORTES OPERATIVOS Y GERENCIALES
============================================================ */
const SECCIONES_REPORTES = ["ventas", "inventario", "compras", "pedidos", "caja"];

function limpiarReportes() {
  document.querySelectorAll("#tab-reportes form").forEach((formulario) => formulario.reset());
  $("reporte-desde").value = "";
  $("reporte-hasta").value = "";
  $("reportes-estado").textContent = "";
  $("reportes-error").textContent = "";
  $("reportes-nota-periodo").textContent =
    "Desde y hasta incluyen los días indicados. Las fechas se interpretan en la zona horaria de este dispositivo.";
  document.querySelectorAll("[data-reportes]").forEach((boton) => {
    const activo = boton.dataset.reportes === "ventas";
    boton.classList.toggle("active", activo);
    boton.setAttribute("aria-selected", activo ? "true" : "false");
  });
  document.querySelectorAll(".reportes-seccion").forEach((seccion) => {
    seccion.classList.toggle("active", seccion.id === "reportes-ventas");
  });
  document.querySelectorAll(".reportes-metricas").forEach((contenedor) => contenedor.replaceChildren());
  document.querySelectorAll("#tab-reportes tbody").forEach((tbody) => tbody.replaceChildren());
  SECCIONES_REPORTES.forEach((seccion) => {
    $("reporte-" + seccion + "-pagina").textContent = "Página 1";
  });
  $("reporte-compras-compromisos").textContent =
    "Las órdenes abiertas se mostrarán como compromisos actuales, separadas de las compras del periodo.";
  actualizarBloqueoReportes();
}

function fechaEntradaLocal(fecha) {
  const pad = (valor) => String(valor).padStart(2, "0");
  return fecha.getFullYear() + "-" + pad(fecha.getMonth() + 1) + "-" + pad(fecha.getDate());
}

function inicializarPeriodoReportes() {
  if (!$("reporte-hasta").value) $("reporte-hasta").value = fechaEntradaLocal(new Date());
  if (!$("reporte-desde").value) {
    const hoy = new Date();
    $("reporte-desde").value = fechaEntradaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  }
}

function instanteDesdeFechaReporte(valor, diasAdicionales = 0) {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(valor);
  if (!partes) throw new Error("Selecciona fechas válidas para el reporte.");
  const fecha = new Date(
    Number(partes[1]),
    Number(partes[2]) - 1,
    Number(partes[3]) + diasAdicionales,
    0, 0, 0, 0
  );
  if (Number.isNaN(fecha.getTime())) throw new Error("Selecciona fechas válidas para el reporte.");
  return fecha.toISOString();
}

function zonaHorariaReporte() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
  } catch (_) {
    return "America/Mexico_City";
  }
}

function periodoReportes() {
  inicializarPeriodoReportes();
  const desde = $("reporte-desde").value;
  const hasta = $("reporte-hasta").value;
  if (!desde || !hasta) throw new Error("Selecciona las fechas desde y hasta.");
  if (desde > hasta) throw new Error("La fecha desde no puede ser posterior a la fecha hasta.");
  const desdeIso = instanteDesdeFechaReporte(desde);
  const hastaIso = instanteDesdeFechaReporte(hasta, 1);
  if (Date.parse(hastaIso) - Date.parse(desdeIso) > 366 * 24 * 60 * 60 * 1000) {
    throw new Error("El periodo máximo es de 366 días.");
  }
  return { desde: desdeIso, hasta: hastaIso, zona_horaria: zonaHorariaReporte() };
}

function agregarParametroReporte(params, nombre, valor) {
  if (valor !== undefined && valor !== null && texto(valor).trim() !== "") {
    params.set(nombre, texto(valor).trim());
  }
}

function parametrosReporte(seccion, { incluirPagina = true } = {}) {
  const params = new URLSearchParams();
  if (seccion !== "inventario") {
    const periodo = periodoReportes();
    params.set("desde", periodo.desde);
    params.set("hasta", periodo.hasta);
    params.set("zona_horaria", periodo.zona_horaria);
  }
  if (seccion === "ventas") {
    agregarParametroReporte(params, "caja_id", $("reporte-ventas-caja").value);
    agregarParametroReporte(params, "usuario_id", $("reporte-ventas-usuario").value);
    agregarParametroReporte(params, "metodo_pago", $("reporte-ventas-metodo").value);
    agregarParametroReporte(params, "canal", $("reporte-ventas-canal").value);
  } else if (seccion === "inventario") {
    agregarParametroReporte(params, "q", $("reporte-inventario-q").value);
    agregarParametroReporte(params, "categoria_id", $("reporte-inventario-categoria").value);
    agregarParametroReporte(params, "estado", $("reporte-inventario-estado").value);
    agregarParametroReporte(params, "proveedor_id", $("reporte-inventario-proveedor").value);
    agregarParametroReporte(params, "activo", $("reporte-inventario-activo").value);
    agregarParametroReporte(params, "publicado_web", $("reporte-inventario-publicado").value);
  } else if (seccion === "compras") {
    agregarParametroReporte(params, "proveedor_id", $("reporte-compras-proveedor").value);
  } else if (seccion === "pedidos") {
    agregarParametroReporte(params, "canal", $("reporte-pedidos-canal").value);
    agregarParametroReporte(params, "estado", $("reporte-pedidos-estado").value);
    agregarParametroReporte(params, "tipo_entrega", $("reporte-pedidos-entrega").value);
  } else if (seccion === "caja") {
    agregarParametroReporte(params, "caja_id", $("reporte-caja-caja").value);
    agregarParametroReporte(params, "usuario_id", $("reporte-caja-usuario").value);
    agregarParametroReporte(params, "operador_id", $("reporte-caja-operador").value);
  }
  if (incluirPagina) {
    params.set("page", texto(reportesPaginas[seccion] || 1));
    params.set("limit", "30");
  }
  return params;
}

function poblarSelectReporte(id, elementos, etiquetaVacia, etiquetaElemento) {
  const select = $(id);
  const valorAnterior = select.value;
  const vacia = nodo("option", "", etiquetaVacia);
  vacia.value = "";
  const opciones = [vacia];
  for (const elemento of elementos || []) {
    const sufijo = elemento.activo === false ? " · inactivo" : "";
    const opcion = nodo("option", "", etiquetaElemento(elemento) + sufijo);
    opcion.value = texto(elemento.id);
    opciones.push(opcion);
  }
  select.replaceChildren(...opciones);
  if (opciones.some((opcion) => opcion.value === valorAnterior)) select.value = valorAnterior;
}

async function cargarFiltrosReportes() {
  if (reportesFiltrosCargados) return;
  if (reportesFiltrosPromesa) return reportesFiltrosPromesa;
  reportesFiltrosPromesa = api("/reportes/filtros")
    .then((datos) => {
      const cajasReporte = Array.isArray(datos.cajas) ? datos.cajas : [];
      const usuariosReporte = Array.isArray(datos.usuarios) ? datos.usuarios : [];
      const categoriasReporte = Array.isArray(datos.categorias) ? datos.categorias : [];
      const proveedoresReporte = Array.isArray(datos.proveedores) ? datos.proveedores : [];
      poblarSelectReporte("reporte-ventas-caja", cajasReporte, "Todas las cajas", (item) => texto(item.nombre));
      poblarSelectReporte("reporte-caja-caja", cajasReporte, "Todas las cajas", (item) => texto(item.nombre));
      poblarSelectReporte("reporte-ventas-usuario", usuariosReporte, "Todos los usuarios", (item) =>
        texto(item.nombre) + " · " + texto(item.rol));
      poblarSelectReporte("reporte-caja-usuario", usuariosReporte, "Todos los actores", (item) =>
        texto(item.nombre) + " · " + texto(item.rol));
      poblarSelectReporte("reporte-caja-operador", usuariosReporte, "Todos los operadores de sesión", (item) =>
        texto(item.nombre) + " · " + texto(item.rol));
      poblarSelectReporte("reporte-inventario-categoria", categoriasReporte, "Todas las categorías", (item) =>
        texto(item.nombre));
      poblarSelectReporte("reporte-inventario-proveedor", proveedoresReporte, "Todos los proveedores", (item) =>
        texto(item.nombre));
      poblarSelectReporte("reporte-compras-proveedor", proveedoresReporte, "Todos los proveedores", (item) =>
        texto(item.nombre));
      reportesFiltrosCargados = true;
    })
    .finally(() => {
      reportesFiltrosPromesa = null;
    });
  return reportesFiltrosPromesa;
}

function enteroReporte(valor) {
  return Math.trunc(numero(valor)).toLocaleString("es-MX");
}

function fechaCortaReporte(valor) {
  const partes = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(texto(valor));
  return partes ? partes[3] + "/" + partes[2] + "/" + partes[1] : texto(valor, "—");
}

function etiquetaCodigoReporte(valor) {
  const etiquetas = {
    POS: "Punto de venta", WEB: "Tienda en línea", INTERNO: "Pedido interno",
    EFECTIVO: "Efectivo", TARJETA: "Tarjeta", TRANSFERENCIA: "Transferencia",
    VENTA: "Venta", CANCELACION: "Cancelación", DEVOLUCION: "Devolución",
    RECEPCION: "Recepción", DEVOLUCION_PROVEEDOR: "Devolución a proveedor",
    RECOLECCION: "Recolección", ENVIO: "Envío",
    RESERVADO: "Reservado", LISTO: "Listo", COMPLETADO: "Completado",
    CANCELADO: "Cancelado", EXPIRADO: "Expirado", APERTURA: "Apertura",
    CIERRE: "Cierre", INGRESO: "Ingreso", RETIRO: "Retiro",
  };
  return etiquetas[valor] || texto(valor, "—");
}

function detalleReporte(principal, secundarios = []) {
  const contenedor = document.createElement("div");
  contenedor.appendChild(nodo("strong", "", texto(principal, "—")));
  const detalles = secundarios.map((item) => texto(item).trim()).filter(Boolean);
  if (detalles.length) contenedor.appendChild(nodo("small", "tabla-detalle", detalles.join(" · ")));
  return contenedor;
}

function libroReporte(item, principal) {
  const extras = [item.sku ? "SKU " + item.sku : "", item.isbn ? "ISBN " + item.isbn : ""];
  if (item.autor) extras.push(item.autor);
  if (item.editorial) extras.push(item.editorial);
  if (item.categoria) extras.push(item.categoria);
  return detalleReporte(principal || item.titulo || item.etiqueta, extras);
}

function datoNetoReporte(valor, { dinero = true } = {}) {
  const n = numero(valor);
  return {
    texto: dinero ? fmt(n) : enteroReporte(n),
    clase: n < 0 ? "reporte-neto-negativo" : n > 0 ? "reporte-neto-positivo" : "",
  };
}

function crearCeldaReporte(resultado) {
  const descriptor = resultado && typeof resultado === "object" && !resultado.nodeType
    ? resultado : { texto: resultado };
  const td = document.createElement("td");
  if (descriptor.clase) td.className = descriptor.clase;
  if (descriptor.nodo && descriptor.nodo.nodeType) td.appendChild(descriptor.nodo);
  else if (resultado && resultado.nodeType) td.appendChild(resultado);
  else td.textContent = texto(descriptor.texto, "—");
  return td;
}

function pintarTablaReporte(id, filas, columnas, mensajeVacio) {
  const tbody = $(id);
  tbody.replaceChildren();
  if (!Array.isArray(filas) || !filas.length) {
    filaVacia(tbody, columnas.length, mensajeVacio || "No hay datos para los filtros seleccionados.");
    return;
  }
  for (const item of filas) {
    const tr = document.createElement("tr");
    for (const columna of columnas) tr.appendChild(crearCeldaReporte(columna(item)));
    tbody.appendChild(tr);
  }
}

function pintarMetricasReporte(id, metricas) {
  const contenedor = $(id);
  const nodos = metricas.map((metrica) => {
    const tarjeta = nodo("div", "reporte-metrica" + (metrica.clase ? " " + metrica.clase : ""));
    tarjeta.append(nodo("span", "", metrica.etiqueta), nodo("strong", "", metrica.valor));
    return tarjeta;
  });
  contenedor.replaceChildren(...nodos);
}

function actualizarPaginacionReporte(seccion, paginacion) {
  const pagina = Math.max(1, numero(paginacion && paginacion.page, reportesPaginas[seccion] || 1));
  const limite = Math.max(1, numero(paginacion && paginacion.limit, 30));
  const total = Math.max(0, numero(paginacion && paginacion.total));
  reportesPaginas[seccion] = pagina;
  reportesHaySiguiente[seccion] = pagina * limite < total;
  $("reporte-" + seccion + "-pagina").textContent =
    "Página " + enteroReporte(pagina) + " · " + enteroReporte(total) + " resultados";
  actualizarBloqueoReportes();
}

function actualizarBloqueoReportes() {
  const bloqueado = reportesCargaEnCurso;
  $("btn-reportes-actualizar").disabled = bloqueado;
  $("btn-reportes-actualizar").textContent = bloqueado ? "Actualizando…" : "Actualizar";
  $("btn-reportes-exportar").disabled = bloqueado || reportesExportacionEnCurso;
  $("btn-reportes-exportar").textContent = reportesExportacionEnCurso ? "Preparando CSV…" : "Exportar CSV";
  SECCIONES_REPORTES.forEach((seccion) => {
    $("btn-reporte-" + seccion + "-anterior").disabled = bloqueado || reportesPaginas[seccion] <= 1;
    $("btn-reporte-" + seccion + "-siguiente").disabled = bloqueado || !reportesHaySiguiente[seccion];
  });
}

function pintarReporteVentas(datos) {
  const resumen = datos.resumen || {};
  const reversos = numero(resumen.importe_cancelado) + numero(resumen.importe_devuelto);
  pintarMetricasReporte("reporte-ventas-resumen", [
    { etiqueta: "Venta neta", valor: fmt(resumen.venta_neta) },
    { etiqueta: "Venta bruta", valor: fmt(resumen.venta_bruta) },
    { etiqueta: "Reversos", valor: fmt(reversos), clase: reversos ? "reporte-metrica-negativa" : "" },
    { etiqueta: "Tickets", valor: enteroReporte(resumen.ventas) },
    { etiqueta: "Ticket promedio", valor: fmt(resumen.ticket_promedio) },
    { etiqueta: "Unidades netas", valor: enteroReporte(resumen.unidades_netas) },
    { etiqueta: "Descuento neto", valor: fmt(resumen.descuentos_netos) },
    { etiqueta: "Eventos", valor: enteroReporte(resumen.movimientos) },
  ]);
  const columnasAgrupacion = (campo) => [
    (item) => etiquetaCodigoReporte(item[campo]),
    (item) => enteroReporte(item.ventas),
    (item) => fmt(item.venta_bruta),
    (item) => fmt(item.reversos),
    (item) => datoNetoReporte(item.venta_neta),
  ];
  pintarTablaReporte("reporte-ventas-canales-body", datos.por_canal, columnasAgrupacion("canal"), "Sin ventas por canal.");
  pintarTablaReporte("reporte-ventas-metodos-body", datos.por_metodo, columnasAgrupacion("metodo_pago"), "Sin ventas por método.");
  pintarTablaReporte("reporte-ventas-dias-body", datos.por_dia, [
    (item) => fechaCortaReporte(item.fecha),
    (item) => enteroReporte(item.ventas),
    (item) => fmt(item.venta_bruta),
    (item) => fmt(item.cancelaciones),
    (item) => fmt(item.devoluciones),
    (item) => datoNetoReporte(item.venta_neta),
  ], "Sin actividad diaria en el periodo.");
  const productos = datos.rankings && Array.isArray(datos.rankings.productos) ? datos.rankings.productos : [];
  pintarTablaReporte("reporte-ventas-productos-body", productos, [
    (item) => ({ nodo: libroReporte(item, item.etiqueta) }),
    (item) => enteroReporte(item.unidades_brutas),
    (item) => enteroReporte(item.unidades_canceladas),
    (item) => enteroReporte(item.unidades_devueltas),
    (item) => datoNetoReporte(item.unidades_netas, { dinero: false }),
    (item) => datoNetoReporte(item.importe_neto),
  ], "Sin libros vendidos en el periodo.");
  const movimientos = datos.movimientos || {};
  pintarTablaReporte("reporte-ventas-body", movimientos.resultados, [
    (item) => hora(item.creado_en),
    (item) => etiquetaCodigoReporte(item.tipo),
    (item) => texto(item.folio, "—"),
    (item) => etiquetaCodigoReporte(item.canal),
    (item) => texto(item.caja_nombre, "—"),
    (item) => texto(item.usuario, "—"),
    (item) => etiquetaCodigoReporte(item.metodo_pago),
    (item) => datoNetoReporte(item.importe_neto),
  ], "No hay movimientos de venta en el periodo.");
  actualizarPaginacionReporte("ventas", movimientos);
}

function pintarReporteInventario(datos) {
  const resumen = datos.resumen || {};
  pintarMetricasReporte("reporte-inventario-resumen", [
    { etiqueta: "Libros", valor: enteroReporte(resumen.productos) },
    { etiqueta: "En tienda", valor: enteroReporte(resumen.unidades_fisicas) },
    { etiqueta: "Reservadas", valor: enteroReporte(resumen.unidades_reservadas) },
    { etiqueta: "Consignadas", valor: enteroReporte(resumen.unidades_consignadas) },
    { etiqueta: "Total propio", valor: enteroReporte(resumen.unidades_propiedad_total) },
    { etiqueta: "Disponibles", valor: enteroReporte(resumen.unidades_disponibles) },
    { etiqueta: "En tránsito", valor: enteroReporte(resumen.unidades_en_transito) },
    { etiqueta: "Con reposición", valor: enteroReporte(resumen.bajo_minimo), clase: numero(resumen.bajo_minimo) ? "reporte-metrica-alerta" : "" },
    { etiqueta: "Costo en tienda", valor: fmt(resumen.valor_costo_fisico) },
    { etiqueta: "Costo consignado", valor: fmt(resumen.valor_costo_consignado) },
    { etiqueta: "Costo total propio", valor: fmt(resumen.valor_costo_total) },
    { etiqueta: "Valor disponible", valor: fmt(resumen.valor_venta_disponible) },
  ]);
  const productos = datos.productos || {};
  pintarTablaReporte("reporte-inventario-body", productos.resultados, [
    (item) => ({ nodo: libroReporte(item) }),
    (item) => enteroReporte(item.fisico),
    (item) => enteroReporte(item.reservado),
    (item) => enteroReporte(item.consignado),
    (item) => datoNetoReporte(item.disponible, { dinero: false }),
    (item) => enteroReporte(item.propiedad_total),
    (item) => enteroReporte(item.en_transito),
    (item) => item.stock_minimo == null ? "Sin política" : enteroReporte(item.stock_minimo) + " / " + enteroReporte(item.stock_objetivo),
    (item) => numero(item.cantidad_sugerida) > 0
      ? { texto: enteroReporte(item.cantidad_sugerida), clase: "reporte-neto-negativo" }
      : "0",
    (item) => fmt(item.valor_costo_total),
    (item) => fmt(item.valor_venta_disponible),
  ], "No hay libros que coincidan con los filtros.");
  actualizarPaginacionReporte("inventario", productos);
}

function pintarReporteCompras(datos) {
  const resumen = datos.resumen || {};
  const compromisos = datos.compromisos_actuales || {};
  pintarMetricasReporte("reporte-compras-resumen", [
    { etiqueta: "Compra neta", valor: fmt(resumen.compra_neta) },
    { etiqueta: "Recibido", valor: fmt(resumen.total_recibido) },
    { etiqueta: "Devuelto", valor: fmt(resumen.total_devuelto), clase: numero(resumen.total_devuelto) ? "reporte-metrica-negativa" : "" },
    { etiqueta: "Unidades netas", valor: enteroReporte(resumen.unidades_netas) },
    { etiqueta: "Recepciones", valor: enteroReporte(resumen.recepciones) },
    { etiqueta: "Devoluciones", valor: enteroReporte(resumen.devoluciones) },
    { etiqueta: "Órdenes abiertas", valor: enteroReporte(compromisos.ordenes_abiertas), clase: numero(compromisos.ordenes_abiertas) ? "reporte-metrica-alerta" : "" },
    { etiqueta: "Unidades pendientes", valor: enteroReporte(compromisos.unidades_pendientes) },
  ]);
  const ordenesAbiertas = numero(compromisos.ordenes_abiertas);
  const unidadesPendientes = numero(compromisos.unidades_pendientes);
  $("reporte-compras-compromisos").textContent =
    "Compromisos vigentes, separados del periodo: " + enteroReporte(ordenesAbiertas)
    + (ordenesAbiertas === 1 ? " orden abierta, " : " órdenes abiertas, ")
    + enteroReporte(unidadesPendientes)
    + (unidadesPendientes === 1 ? " unidad pendiente por " : " unidades pendientes por ")
    + fmt(compromisos.importe_pendiente) + ".";
  pintarTablaReporte("reporte-compras-proveedores-body", datos.proveedores, [
    (item) => texto(item.proveedor_nombre, "—"),
    (item) => enteroReporte(item.recepciones),
    (item) => fmt(item.total_recibido),
    (item) => fmt(item.total_devuelto),
    (item) => datoNetoReporte(item.compra_neta),
  ], "Sin movimientos por proveedor.");
  pintarTablaReporte("reporte-compras-productos-body", datos.productos, [
    (item) => ({ nodo: libroReporte(item) }),
    (item) => enteroReporte(item.unidades_recibidas),
    (item) => enteroReporte(item.unidades_devueltas),
    (item) => datoNetoReporte(item.unidades_netas, { dinero: false }),
    (item) => datoNetoReporte(item.costo_neto),
  ], "Sin libros recibidos en el periodo.");
  const movimientos = datos.movimientos || {};
  pintarTablaReporte("reporte-compras-body", movimientos.resultados, [
    (item) => hora(item.creado_en),
    (item) => etiquetaCodigoReporte(item.tipo),
    (item) => texto(item.folio, "—"),
    (item) => texto(item.orden_folio, "—"),
    (item) => texto(item.proveedor_nombre, "—"),
    (item) => texto(item.usuario, "—"),
    (item) => texto(item.referencia, "—"),
    (item) => datoNetoReporte(numero(item.total) * numero(item.signo, 1)),
  ], "No hay recepciones ni devoluciones en el periodo.");
  actualizarPaginacionReporte("compras", movimientos);
}

function pintarReportePedidos(datos) {
  const resumen = datos.resumen || {};
  pintarMetricasReporte("reporte-pedidos-resumen", [
    { etiqueta: "Pedidos", valor: enteroReporte(resumen.pedidos) },
    { etiqueta: "Importe solicitado", valor: fmt(resumen.importe_solicitado) },
    { etiqueta: "Activos", valor: enteroReporte(resumen.activos) },
    { etiqueta: "Completados", valor: enteroReporte(resumen.completados) },
    { etiqueta: "Cancelados", valor: enteroReporte(resumen.cancelados) },
    { etiqueta: "Expirados", valor: enteroReporte(resumen.expirados) },
    { etiqueta: "Vencidos pendientes", valor: enteroReporte(resumen.vencidos_pendientes), clase: numero(resumen.vencidos_pendientes) ? "reporte-metrica-alerta" : "" },
    { etiqueta: "Unidades reservadas", valor: enteroReporte(resumen.unidades_reservadas) },
  ]);
  pintarTablaReporte("reporte-pedidos-estados-body", datos.por_estado, [
    (item) => etiquetaCodigoReporte(item.estado),
    (item) => enteroReporte(item.pedidos),
    (item) => fmt(item.importe),
  ], "Sin pedidos por estado.");
  pintarTablaReporte("reporte-pedidos-canales-body", datos.por_canal, [
    (item) => etiquetaCodigoReporte(item.canal),
    (item) => enteroReporte(item.pedidos),
    (item) => enteroReporte(item.completados),
    (item) => fmt(item.importe),
  ], "Sin pedidos por canal.");
  const pedidosReporte = datos.pedidos || {};
  pintarTablaReporte("reporte-pedidos-body", pedidosReporte.resultados, [
    (item) => hora(item.creado_en),
    (item) => texto(item.folio, "—"),
    (item) => etiquetaCodigoReporte(item.canal),
    (item) => ({ nodo: detalleReporte(item.cliente_nombre || "Cliente", [item.cliente_telefono]) }),
    (item) => etiquetaCodigoReporte(item.tipo_entrega),
    (item) => enteroReporte(item.unidades),
    (item) => enteroReporte(item.unidades_reservadas),
    (item) => fmt(item.total),
    (item) => ({
      texto: etiquetaCodigoReporte(item.estado) + (item.vencido_pendiente ? " · vencido" : ""),
      clase: item.vencido_pendiente ? "reporte-neto-negativo" : "estado",
    }),
    (item) => texto(item.venta_folio, "—"),
  ], "No hay pedidos en el periodo.");
  actualizarPaginacionReporte("pedidos", pedidosReporte);
}

function montoFirmadoCaja(item) {
  const monto = numero(item.monto);
  return ["CANCELACION", "DEVOLUCION", "RETIRO"].includes(item.tipo) ? -monto : monto;
}

function pintarReporteCaja(datos) {
  const resumen = datos.resumen || {};
  const ventas = numero(resumen.ventas_efectivo) + numero(resumen.ventas_tarjeta)
    + numero(resumen.ventas_transferencia);
  const reversos = numero(resumen.reversos_efectivo) + numero(resumen.reversos_tarjeta)
    + numero(resumen.reversos_transferencia);
  pintarMetricasReporte("reporte-caja-resumen", [
    { etiqueta: "Fondos de apertura", valor: fmt(resumen.fondos_apertura) },
    { etiqueta: "Ventas", valor: fmt(ventas) },
    { etiqueta: "Reversos", valor: fmt(reversos), clase: reversos ? "reporte-metrica-negativa" : "" },
    { etiqueta: "Flujo de efectivo", valor: fmt(resumen.flujo_efectivo) },
    { etiqueta: "Ingresos", valor: fmt(resumen.ingresos) },
    { etiqueta: "Retiros", valor: fmt(resumen.retiros) },
    { etiqueta: "Cortes", valor: enteroReporte(resumen.cortes) },
    { etiqueta: "Diferencia de cortes", valor: fmt(resumen.diferencia_cortes), clase: numero(resumen.diferencia_cortes) ? "reporte-metrica-alerta" : "" },
  ]);
  pintarTablaReporte("reporte-caja-grupos-body", datos.por_caja_usuario, [
    (item) => ({ nodo: detalleReporte(item.caja_nombre, [item.usuario]) }),
    (item) => fmt(item.ventas),
    (item) => fmt(item.reversos),
    (item) => fmt(item.ingresos),
    (item) => fmt(item.retiros),
    (item) => datoNetoReporte(item.flujo_efectivo),
  ], "Sin movimientos por caja y actor.");
  pintarTablaReporte("reporte-caja-abiertas-body", datos.sesiones_abiertas, [
    (item) => texto(item.caja_nombre, "—"),
    (item) => texto(item.operador, "—"),
    (item) => hora(item.fecha_apertura),
    (item) => fmt(item.fondo_inicial),
  ], "No hay sesiones abiertas para los filtros actuales.");
  pintarTablaReporte("reporte-caja-cortes-body", datos.cortes, [
    (item) => hora(item.creado_en),
    (item) => texto(item.caja_nombre, "—"),
    (item) => texto(item.operador, "—"),
    (item) => texto(item.responsable, "—"),
    (item) => fmt(item.efectivo_esperado),
    (item) => fmt(item.efectivo_contado),
    (item) => datoNetoReporte(item.diferencia),
  ], "No hay cortes en el periodo.");
  const movimientos = datos.movimientos || {};
  pintarTablaReporte("reporte-caja-body", movimientos.resultados, [
    (item) => hora(item.creado_en),
    (item) => etiquetaCodigoReporte(item.tipo),
    (item) => texto(item.caja_nombre, "—"),
    (item) => texto(item.usuario, "—") + (item.actor_inferido ? " · inferido" : ""),
    (item) => etiquetaCodigoReporte(item.metodo_pago),
    (item) => texto(item.concepto || item.referencia, "—"),
    (item) => datoNetoReporte(montoFirmadoCaja(item)),
  ], "No hay movimientos de caja en el periodo.");
  actualizarPaginacionReporte("caja", movimientos);
}

function pintarReporte(seccion, datos) {
  const pintores = {
    ventas: pintarReporteVentas,
    inventario: pintarReporteInventario,
    compras: pintarReporteCompras,
    pedidos: pintarReportePedidos,
    caja: pintarReporteCaja,
  };
  pintores[seccion](datos);
}

function actualizarPeriodoVisualReportes() {
  const esInventario = reportesSeccion === "inventario";
  $("reporte-desde").disabled = esInventario;
  $("reporte-hasta").disabled = esInventario;
  const botonPeriodo = $("form-reportes-periodo").querySelector('button[type="submit"]');
  botonPeriodo.disabled = esInventario;
  $("reportes-nota-periodo").textContent = esInventario
    ? "Inventario es una fotografía actual: existencias, reservas, tránsito y valores provienen de la misma fuente omnicanal."
    : "Desde y hasta incluyen los días indicados. Las fechas se interpretan en la zona horaria de este dispositivo.";
}

function cambiarReportesSeccion(seccion, { cargar = true } = {}) {
  if (!SECCIONES_REPORTES.includes(seccion)) return;
  reportesSeccion = seccion;
  document.querySelectorAll("[data-reportes]").forEach((boton) => {
    const activo = boton.dataset.reportes === seccion;
    boton.classList.toggle("active", activo);
    boton.setAttribute("aria-selected", activo ? "true" : "false");
  });
  document.querySelectorAll(".reportes-seccion").forEach((panel) => {
    panel.classList.toggle("active", panel.id === "reportes-" + seccion);
  });
  actualizarPeriodoVisualReportes();
  if (cargar) cargarReporteActivo();
}

async function cargarReporteActivo() {
  if (!esSupervisor()) return;
  inicializarPeriodoReportes();
  const seccion = reportesSeccion;
  const version = ++reportesVersion;
  reportesCargaEnCurso = true;
  $("reportes-error").textContent = "";
  $("reportes-estado").textContent = "Consultando " + seccion + "…";
  actualizarBloqueoReportes();
  try {
    await cargarFiltrosReportes();
    if (version !== reportesVersion) return;
    const params = parametrosReporte(seccion);
    const datos = await api("/reportes/" + seccion + "?" + params.toString());
    if (version !== reportesVersion) return;
    pintarReporte(seccion, datos);
    $("reportes-estado").textContent = "Actualizado " + hora(datos.generado_en) + ".";
  } catch (error) {
    if (version !== reportesVersion || error.message === "unauthorized") return;
    $("reportes-estado").textContent = "";
    $("reportes-error").textContent = error.message;
  } finally {
    if (version === reportesVersion) {
      reportesCargaEnCurso = false;
      actualizarBloqueoReportes();
    }
  }
}

async function exportarReporteActivo() {
  if (!esSupervisor() || reportesExportacionEnCurso || reportesCargaEnCurso) return;
  reportesExportacionEnCurso = true;
  $("reportes-error").textContent = "";
  actualizarBloqueoReportes();
  try {
    const params = parametrosReporte(reportesSeccion, { incluirPagina: false });
    const archivo = await apiArchivo(
      "/reportes/exportaciones/" + reportesSeccion + "?" + params.toString()
    );
    const url = URL.createObjectURL(archivo.blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = archivo.nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("reportes-estado").textContent = "CSV generado: " + archivo.nombre + ".";
  } catch (error) {
    if (error.message !== "unauthorized") $("reportes-error").textContent = error.message;
  } finally {
    reportesExportacionEnCurso = false;
    actualizarBloqueoReportes();
  }
}

document.querySelectorAll("[data-reportes]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarReportesSeccion(boton.dataset.reportes));
});

$("form-reportes-periodo").addEventListener("submit", (evento) => {
  evento.preventDefault();
  reportesPaginas[reportesSeccion] = 1;
  cargarReporteActivo();
});

SECCIONES_REPORTES.forEach((seccion) => {
  $("form-reporte-" + seccion).addEventListener("submit", (evento) => {
    evento.preventDefault();
    reportesPaginas[seccion] = 1;
    if (reportesSeccion === seccion) cargarReporteActivo();
  });
  $("btn-reporte-" + seccion + "-anterior").addEventListener("click", () => {
    if (reportesCargaEnCurso || reportesPaginas[seccion] <= 1) return;
    reportesPaginas[seccion]--;
    cargarReporteActivo();
  });
  $("btn-reporte-" + seccion + "-siguiente").addEventListener("click", () => {
    if (reportesCargaEnCurso || !reportesHaySiguiente[seccion]) return;
    reportesPaginas[seccion]++;
    cargarReporteActivo();
  });
});

$("btn-reportes-actualizar").addEventListener("click", cargarReporteActivo);
$("btn-reportes-exportar").addEventListener("click", exportarReporteActivo);
limpiarReportes();

/* ============================================================
   CLIENTES, MAYOREO Y COTIZACIONES PERSISTENTES
============================================================ */
const CLIENTES_POR_PAGINA = 30;
const COTIZACIONES_POR_PAGINA = 30;
let clienteGuardadoEnCurso = false;
let cambioClienteCotizacionEnCurso = false;

function rotuloSegmento(segmento) {
  return texto(segmento).toUpperCase() === "MAYOREO" ? "Mayoreo" : "Público";
}

function rotuloTipoComercial(tipo) {
  const rotulos = {
    CONSUMIDOR: "Consumidor",
    LIBRERIA: "Librería",
    DISTRIBUIDOR: "Distribuidor",
    INSTITUCION: "Institución",
  };
  return rotulos[texto(tipo).toUpperCase()] || "Consumidor";
}

function claseSegmento(segmento) {
  return "estado segmento-" + (texto(segmento).toUpperCase() === "MAYOREO" ? "mayoreo" : "publico");
}

function clientePorId(id) {
  const buscado = numero(id, 0);
  return clientesOpciones.find((cliente) => numero(cliente.id) === buscado) || null;
}

function clienteSeleccionadoVenta() {
  return clientePorId(clienteVentaId);
}

function opcionCliente(cliente) {
  const option = nodo(
    "option",
    "",
    texto(cliente.nombre, "Cliente") + " · " + rotuloSegmento(cliente.segmento_precio)
  );
  option.value = texto(cliente.id);
  return option;
}

function poblarSelectoresClientes() {
  const pos = $("sel-venta-cliente");
  const alta = $("cotizacion-alta-cliente");
  const altaAnterior = numero(alta.value, 0);
  const publico = nodo("option", "", "PÚBLICO GENERAL · Precio público");
  publico.value = "";
  pos.replaceChildren(publico);
  const seleccionar = nodo("option", "", "Selecciona un cliente");
  seleccionar.value = "";
  alta.replaceChildren(seleccionar);
  for (const cliente of clientesOpciones) {
    pos.appendChild(opcionCliente(cliente));
    alta.appendChild(opcionCliente(cliente));
  }

  if (!clientePorId(clienteVentaId)) clienteVentaId = null;
  pos.value = clienteVentaId ? texto(clienteVentaId) : "";
  const altaId = clientePorId(altaAnterior)
    ? altaAnterior
    : clientePorId(clienteVentaId) ? clienteVentaId : null;
  alta.value = altaId ? texto(altaId) : "";
  actualizarSelectorClientesConsignacion();
  actualizarAvisoClienteVenta();
}

function actualizarAvisoClienteVenta() {
  const cliente = clienteSeleccionadoVenta();
  const aviso = $("cliente-precio-aviso");
  if (!cliente) {
    aviso.textContent = "Venta sin cliente registrado · precio público.";
    return;
  }
  aviso.textContent = texto(cliente.nombre) + " · precio "
    + rotuloSegmento(cliente.segmento_precio).toLowerCase()
    + (texto(cliente.telefono).trim()
      ? "."
      : " · agrega un teléfono para poder guardar cotizaciones.");
}

function seleccionarClienteVenta(id) {
  const cliente = clientePorId(id);
  clienteVentaId = cliente ? numero(cliente.id) : null;
  $("sel-venta-cliente").value = clienteVentaId ? texto(clienteVentaId) : "";
  actualizarAvisoClienteVenta();
  return cliente;
}

function invalidarCotizacionPos() {
  cotizacionPosVersion++;
  cotizacionPos = null;
  cotizacionPosFirma = "";
  cotizacionPosError = "";
  cotizacionPosEnCurso = false;
}

function huellaCliente(cliente) {
  return cliente ? JSON.stringify({
    id: numero(cliente.id),
    nombre: texto(cliente.nombre),
    telefono: texto(cliente.telefono),
    segmento_precio: texto(cliente.segmento_precio),
    tipo_comercial: texto(cliente.tipo_comercial),
    activo: cliente.activo !== false,
  }) : "";
}

async function cargarOpcionesClientes({ recotizar = false } = {}) {
  const seleccionAnterior = clienteVentaId;
  const huellaAnterior = huellaCliente(clienteSeleccionadoVenta());
  const todos = [];
  for (let page = 1; page <= 1000; page++) {
    const params = new URLSearchParams({ page: texto(page), limit: "100" });
    const respuesta = await api("/clientes?" + params.toString());
    const pagina = extraerLista(respuesta, "clientes");
    todos.push(...pagina);
    if (pagina.length < 100) break;
  }
  clientesOpciones = todos
    .filter((cliente) => cliente && cliente.activo !== false && numero(cliente.id) > 0)
    .sort((a, b) => texto(a.nombre).localeCompare(texto(b.nombre), "es"));
  clienteVentaId = seleccionAnterior;
  poblarSelectoresClientes();
  const cambio = huellaAnterior !== huellaCliente(clienteSeleccionadoVenta());
  if (recotizar && carrito.length && (cambio || seleccionAnterior)) {
    invalidarCotizacionPos();
    pintarCarrito();
  } else actualizarControlesCaja();
  return clientesOpciones;
}

$("sel-venta-cliente").addEventListener("change", (evento) => {
  if (cobroEnCurso || intentoCobro || altaCotizacionEnCurso || intentoAltaCotizacion) {
    evento.currentTarget.value = clienteVentaId ? texto(clienteVentaId) : "";
    return;
  }
  seleccionarClienteVenta(evento.currentTarget.value);
  invalidarCotizacionPos();
  pintarCarrito();
});

$("btn-refrescar-clientes-pos").addEventListener("click", async () => {
  await conBotonOcupado($("btn-refrescar-clientes-pos"), "Actualizando…", async () => {
    try {
      await cargarOpcionesClientes({ recotizar: true });
      toast("Directorio de clientes actualizado.", "ok");
    } catch (error) {
      if (error.message !== "unauthorized") toast(error.message, "err");
    }
  });
});

function cambiarClientesCotizacionesSeccion(nombre, { cargar = true } = {}) {
  if (!new Set(["clientes", "cotizaciones"]).has(nombre)) return;
  clientesCotizacionesSeccion = nombre;
  document.querySelectorAll("[data-clientes-seccion]").forEach((boton) => {
    const activo = boton.dataset.clientesSeccion === nombre;
    boton.classList.toggle("active", activo);
    boton.setAttribute("aria-selected", activo ? "true" : "false");
  });
  document.querySelectorAll(".clientes-seccion").forEach((seccion) => {
    seccion.classList.toggle("active", seccion.id === "clientes-seccion-" + nombre);
  });
  if (cargar) cargarClientesCotizacionesActivo();
}

function cargarClientesCotizacionesActivo() {
  if (clientesCotizacionesSeccion === "cotizaciones") return cargarCotizaciones();
  return cargarClientesDirectorio();
}

document.querySelectorAll("[data-clientes-seccion]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarClientesCotizacionesSeccion(boton.dataset.clientesSeccion));
});

function actualizarPaginacionClientes() {
  $("clientes-pagina").textContent = "Página " + clientesPagina;
  $("btn-clientes-anterior").disabled = clientesCargaEnCurso || clientesPagina <= 1;
  $("btn-clientes-siguiente").disabled = clientesCargaEnCurso || !clientesHaySiguiente;
  $("btn-refrescar-clientes").disabled = clientesCargaEnCurso;
  $("btn-nuevo-cliente").disabled = clientesCargaEnCurso;
}

function pintarClientesDirectorio() {
  const tbody = $("clientes-body");
  tbody.replaceChildren();
  for (const cliente of clientesDirectorio) {
    const nombreTd = celda(texto(cliente.nombre, "—"));
    if (cliente.notas) nombreTd.appendChild(nodo("small", "tabla-detalle", texto(cliente.notas)));
    const contactoTd = celda(texto(cliente.telefono, "Sin teléfono"));
    if (cliente.email) contactoTd.appendChild(nodo("small", "tabla-detalle", texto(cliente.email)));
    const segmentoTd = document.createElement("td");
    segmentoTd.appendChild(nodo("span", claseSegmento(cliente.segmento_precio), rotuloSegmento(cliente.segmento_precio)));
    const tipoTd = celda(rotuloTipoComercial(cliente.tipo_comercial));
    const registroTd = celda(hora(cliente.creado_en));
    registroTd.appendChild(nodo("small", "tabla-detalle", "Por " + texto(cliente.creado_por, "—")));
    const estadoTd = document.createElement("td");
    estadoTd.appendChild(estadoChip(cliente.activo !== false));
    const accionTd = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", esSupervisor() ? "Editar" : "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirCliente(cliente.id));
    accionTd.appendChild(boton);
    const tr = document.createElement("tr");
    tr.append(nombreTd, contactoTd, tipoTd, segmentoTd, registroTd, estadoTd, accionTd);
    tbody.appendChild(tr);
  }
  if (!clientesDirectorio.length) filaVacia(tbody, 7, "No hay clientes con estos filtros.");
}

async function cargarClientesDirectorio({ reiniciar = false } = {}) {
  if (clientesCargaEnCurso) return;
  if (reiniciar) clientesPagina = 1;
  clientesCargaEnCurso = true;
  actualizarPaginacionClientes();
  filaVacia($("clientes-body"), 7, "Cargando clientes…");
  try {
    const params = new URLSearchParams({
      q: $("inp-clientes-q").value.trim(),
      incluir_inactivos: esSupervisor() && $("chk-clientes-inactivos").checked ? "true" : "false",
      page: texto(clientesPagina),
      limit: texto(CLIENTES_POR_PAGINA),
    });
    const segmento = $("sel-clientes-segmento").value;
    if (segmento) params.set("segmento_precio", segmento);
    const tipoComercial = esSupervisor() ? $("sel-clientes-tipo").value : "";
    if (tipoComercial) params.set("tipo_comercial", tipoComercial);
    const respuesta = await api("/clientes?" + params.toString());
    clientesDirectorio = extraerLista(respuesta, "clientes");
    clientesHaySiguiente = clientesDirectorio.length === CLIENTES_POR_PAGINA;
    pintarClientesDirectorio();
  } catch (error) {
    clientesDirectorio = [];
    clientesHaySiguiente = false;
    filaVacia($("clientes-body"), 7, error.message);
  } finally {
    clientesCargaEnCurso = false;
    actualizarPaginacionClientes();
  }
}

$("form-clientes-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarClientesDirectorio({ reiniciar: true });
});
$("btn-refrescar-clientes").addEventListener("click", () => void cargarClientesDirectorio());
$("btn-clientes-anterior").addEventListener("click", () => {
  if (clientesPagina <= 1 || clientesCargaEnCurso) return;
  clientesPagina--;
  void cargarClientesDirectorio();
});
$("btn-clientes-siguiente").addEventListener("click", () => {
  if (!clientesHaySiguiente || clientesCargaEnCurso) return;
  clientesPagina++;
  void cargarClientesDirectorio();
});

function actualizarControlesCliente() {
  const consulta = clienteModoConsulta;
  const bloqueado = clienteGuardadoEnCurso || consulta;
  [
    "inp-cliente-nombre", "inp-cliente-telefono", "inp-cliente-email",
    "inp-cliente-direccion", "inp-cliente-notas",
  ].forEach((id) => { $(id).disabled = bloqueado; });
  $("sel-cliente-segmento").disabled = clienteGuardadoEnCurso || !esSupervisor();
  $("sel-cliente-tipo").disabled = clienteGuardadoEnCurso || !esSupervisor();
  $("chk-cliente-activo").disabled = clienteGuardadoEnCurso || !esSupervisor();
  const guardar = $("btn-guardar-cliente");
  guardar.classList.toggle("hidden", consulta);
  guardar.disabled = clienteGuardadoEnCurso;
  guardar.textContent = clienteGuardadoEnCurso
    ? "Guardando…" : clienteActivo ? "Guardar cambios" : "Guardar cliente";
}

async function abrirCliente(id = null) {
  if (clienteGuardadoEnCurso) return;
  try {
    clienteActivo = id ? await api("/clientes/" + encodeURIComponent(id)) : null;
    clienteModoConsulta = Boolean(clienteActivo && !esSupervisor());
    $("cliente-modal-titulo").textContent = clienteActivo
      ? (clienteModoConsulta ? "Consultar cliente" : "Editar cliente")
      : "Nuevo cliente";
    $("inp-cliente-id").value = clienteActivo ? texto(clienteActivo.id) : "";
    $("inp-cliente-nombre").value = texto(clienteActivo && clienteActivo.nombre);
    $("inp-cliente-telefono").value = texto(clienteActivo && clienteActivo.telefono);
    $("inp-cliente-email").value = texto(clienteActivo && clienteActivo.email);
    $("inp-cliente-direccion").value = texto(clienteActivo && clienteActivo.direccion);
    $("inp-cliente-notas").value = texto(clienteActivo && clienteActivo.notas);
    $("sel-cliente-segmento").value = texto(clienteActivo && clienteActivo.segmento_precio, "PUBLICO");
    $("sel-cliente-tipo").value = texto(clienteActivo && clienteActivo.tipo_comercial, "CONSUMIDOR");
    $("chk-cliente-activo").checked = clienteActivo ? clienteActivo.activo !== false : true;
    $("cliente-error").textContent = "";
    actualizarControlesCliente();
    abrirModal("modal-cliente");
  } catch (error) {
    if (error.message !== "unauthorized") toast(error.message, "err");
  }
}

$("btn-nuevo-cliente").addEventListener("click", () => void abrirCliente());

$("form-cliente").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (clienteGuardadoEnCurso || clienteModoConsulta) return;
  $("cliente-error").textContent = "";
  const nombre = $("inp-cliente-nombre").value.trim();
  if (nombre.length < 2) {
    $("cliente-error").textContent = "El nombre debe tener al menos 2 caracteres.";
    return;
  }
  const body = {
    nombre,
    telefono: $("inp-cliente-telefono").value.trim() || null,
    email: $("inp-cliente-email").value.trim() || null,
    direccion: $("inp-cliente-direccion").value.trim() || null,
    notas: $("inp-cliente-notas").value.trim() || null,
    segmento_precio: esSupervisor() ? $("sel-cliente-segmento").value : "PUBLICO",
    tipo_comercial: esSupervisor() ? $("sel-cliente-tipo").value : "CONSUMIDOR",
  };
  if (clienteActivo && esSupervisor()) body.activo = $("chk-cliente-activo").checked;

  const seleccionadoAntes = clienteVentaId;
  const huellaAntes = huellaCliente(clienteSeleccionadoVenta());
  clienteGuardadoEnCurso = true;
  actualizarControlesCliente();
  try {
    if (clienteActivo) {
      await api("/clientes/" + encodeURIComponent(clienteActivo.id), { method: "PATCH", body });
    } else {
      await api("/clientes", { method: "POST", body });
    }
    cerrarModal($("modal-cliente"), true);
    clienteActivo = null;
    clienteModoConsulta = false;
    await Promise.all([cargarClientesDirectorio(), cargarOpcionesClientes()]);
    const huellaDespues = huellaCliente(clienteSeleccionadoVenta());
    if (carrito.length && seleccionadoAntes && huellaAntes !== huellaDespues) {
      invalidarCotizacionPos();
      pintarCarrito();
    }
    toast("Cliente guardado.", "ok");
  } catch (error) {
    if (error.message !== "unauthorized") $("cliente-error").textContent = error.message;
  } finally {
    clienteGuardadoEnCurso = false;
    actualizarControlesCliente();
  }
});

function cotizacionVencida(cotizacion) {
  if (!cotizacion || texto(cotizacion.estado).toUpperCase() !== "VIGENTE") return false;
  if (cotizacion.vencida === true) return true;
  const limite = new Date(cotizacion.vigente_hasta);
  return !Number.isNaN(limite.getTime()) && limite.getTime() <= Date.now();
}

function rotuloEstadoCotizacion(cotizacion) {
  if (cotizacionVencida(cotizacion)) return "VENCIDA · PENDIENTE";
  return texto(cotizacion && cotizacion.estado, "—").replaceAll("_", " ");
}

function actualizarPaginacionCotizaciones() {
  $("cotizaciones-pagina").textContent = "Página " + cotizacionesPagina;
  $("btn-cotizaciones-anterior").disabled = cotizacionesCargaEnCurso || cotizacionesPagina <= 1;
  $("btn-cotizaciones-siguiente").disabled = cotizacionesCargaEnCurso || !cotizacionesHaySiguiente;
  $("btn-refrescar-cotizaciones").disabled = cotizacionesCargaEnCurso;
  $("btn-procesar-cotizaciones-vencidas").disabled = cotizacionesCargaEnCurso || !esSupervisor();
}

function pintarCotizaciones() {
  const tbody = $("cotizaciones-body");
  tbody.replaceChildren();
  for (const cotizacion of cotizaciones) {
    const fechaTd = celda(hora(cotizacion.creado_en));
    fechaTd.appendChild(nodo("small", "tabla-detalle", "Por " + texto(cotizacion.creado_por, "—")));
    const clienteTd = celda(texto(cotizacion.cliente_nombre, "—"));
    clienteTd.appendChild(nodo("small", "tabla-detalle", texto(cotizacion.cliente_telefono, "Sin teléfono")));
    const segmentoTd = document.createElement("td");
    segmentoTd.appendChild(nodo("span", claseSegmento(cotizacion.segmento_precio), rotuloSegmento(cotizacion.segmento_precio)));
    const vigenciaTd = celda(hora(cotizacion.vigente_hasta));
    if (cotizacionVencida(cotizacion)) {
      vigenciaTd.appendChild(nodo("small", "tabla-detalle cotizacion-vencida-aviso", "Pendiente de procesar"));
    }
    const estadoTd = document.createElement("td");
    const estadoVisual = cotizacionVencida(cotizacion) ? "VENCIDA" : cotizacion.estado;
    estadoTd.appendChild(nodo("span", claseEstado(estadoVisual), rotuloEstadoCotizacion(cotizacion)));
    const pedidoTd = celda(texto(cotizacion.pedido_folio, "—"));
    if (cotizacion.pedido_estado) pedidoTd.appendChild(nodo("small", "tabla-detalle", texto(cotizacion.pedido_estado)));
    const accionTd = document.createElement("td");
    const ver = nodo("button", "btn btn-outline", "Ver");
    ver.type = "button";
    ver.addEventListener("click", () => void abrirCotizacion(cotizacion.id));
    accionTd.appendChild(ver);
    const tr = document.createElement("tr");
    tr.append(
      celda(texto(cotizacion.folio)), fechaTd, clienteTd, segmentoTd,
      vigenciaTd, celda(fmt(cotizacion.total)), estadoTd, pedidoTd, accionTd
    );
    tbody.appendChild(tr);
  }
  if (!cotizaciones.length) filaVacia(tbody, 9, "No hay cotizaciones con estos filtros.");
}

async function cargarCotizaciones({ reiniciar = false } = {}) {
  if (cotizacionesCargaEnCurso) return;
  if (reiniciar) cotizacionesPagina = 1;
  cotizacionesCargaEnCurso = true;
  actualizarPaginacionCotizaciones();
  filaVacia($("cotizaciones-body"), 9, "Cargando cotizaciones…");
  try {
    const params = new URLSearchParams({
      q: $("inp-cotizaciones-q").value.trim(),
      page: texto(cotizacionesPagina),
      limit: texto(COTIZACIONES_POR_PAGINA),
    });
    const estado = $("sel-cotizaciones-estado").value;
    if (estado) params.set("estado", estado);
    const respuesta = await api("/cotizaciones?" + params.toString());
    cotizaciones = extraerLista(respuesta, "cotizaciones");
    cotizacionesHaySiguiente = cotizaciones.length === COTIZACIONES_POR_PAGINA;
    pintarCotizaciones();
  } catch (error) {
    cotizaciones = [];
    cotizacionesHaySiguiente = false;
    filaVacia($("cotizaciones-body"), 9, error.message);
  } finally {
    cotizacionesCargaEnCurso = false;
    actualizarPaginacionCotizaciones();
  }
}

$("form-cotizaciones-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarCotizaciones({ reiniciar: true });
});
$("btn-refrescar-cotizaciones").addEventListener("click", () => void cargarCotizaciones());
$("btn-cotizaciones-anterior").addEventListener("click", () => {
  if (cotizacionesPagina <= 1 || cotizacionesCargaEnCurso) return;
  cotizacionesPagina--;
  void cargarCotizaciones();
});
$("btn-cotizaciones-siguiente").addEventListener("click", () => {
  if (!cotizacionesHaySiguiente || cotizacionesCargaEnCurso) return;
  cotizacionesPagina++;
  void cargarCotizaciones();
});

function intentoPerteneceACotizacion(intento, id) {
  return Boolean(intento && numero(intento.cotizacionId) === numero(id));
}

async function abrirCotizacion(id) {
  if (cotizacionAccionEnCurso) return;
  if (intentoCotizacionAccion && !intentoPerteneceACotizacion(intentoCotizacionAccion, id)) {
    toast("Hay una operación pendiente. Reabre esa cotización para reintentarla con la misma clave.", "err");
    return;
  }
  try {
    cotizacionActiva = await api("/cotizaciones/" + encodeURIComponent(id));
    $("cotizacion-error").textContent = "";
    const intento = intentoPerteneceACotizacion(intentoCotizacionAccion, id)
      ? intentoCotizacionAccion : null;
    $("sel-cotizacion-entrega").value = intento && intento.tipo === "conversion"
      ? intento.body.tipo_entrega : "RECOLECCION";
    $("inp-cotizacion-motivo").value = intento && intento.tipo === "cancelacion"
      ? texto(intento.body.motivo) : "";
    pintarCotizacionActiva();
    abrirModal("modal-cotizacion");
  } catch (error) {
    if (error.message !== "unauthorized") toast(error.message, "err");
  }
}

function pintarCotizacionActiva() {
  if (!cotizacionActiva) return;
  $("cotizacion-modal-titulo").textContent = "Cotización " + texto(cotizacionActiva.folio);
  $("cotizacion-resumen").replaceChildren(
    bloqueDatoPedido("Estado", rotuloEstadoCotizacion(cotizacionActiva)),
    bloqueDatoPedido("Total", fmt(cotizacionActiva.total)),
    bloqueDatoPedido("Subtotal", fmt(cotizacionActiva.subtotal)),
    bloqueDatoPedido("Descuento", fmt(cotizacionActiva.descuento)),
    bloqueDatoPedido("Segmento", rotuloSegmento(cotizacionActiva.segmento_precio)),
    bloqueDatoPedido("Creada", hora(cotizacionActiva.creado_en)),
    bloqueDatoPedido("Vigente hasta", hora(cotizacionActiva.vigente_hasta)),
    bloqueDatoPedido("Creada por", texto(cotizacionActiva.creado_por, "—"))
  );

  const contacto = $("cotizacion-contacto");
  contacto.replaceChildren();
  [
    ["Cliente", cotizacionActiva.cliente_nombre],
    ["Teléfono", cotizacionActiva.cliente_telefono],
    ["Correo", cotizacionActiva.cliente_email],
    ["Dirección", cotizacionActiva.cliente_direccion],
  ].forEach(([etiqueta, valor]) => {
    if (!valor) return;
    const dato = document.createElement("span");
    dato.append(nodo("strong", "", etiqueta + ": "), document.createTextNode(texto(valor)));
    contacto.appendChild(dato);
  });
  $("cotizacion-notas").textContent = cotizacionActiva.notas
    ? "Notas: " + texto(cotizacionActiva.notas) : "";
  $("cotizacion-notas").classList.toggle("hidden", !cotizacionActiva.notas);

  const detalleBody = $("cotizacion-detalle-body");
  detalleBody.replaceChildren();
  const detalle = Array.isArray(cotizacionActiva.detalle) ? cotizacionActiva.detalle : [];
  for (const linea of detalle) {
    const productoTd = celda(texto(linea.producto_sku, "—"));
    productoTd.appendChild(nodo("small", "tabla-detalle", texto(linea.producto_titulo, "Producto")));
    const tr = document.createElement("tr");
    tr.append(
      productoTd,
      celda(numero(linea.cantidad)),
      celda(fmt(linea.precio_lista)),
      celda(fmt(numero(linea.descuento_unitario) * numero(linea.cantidad)), "precio-descuento"),
      celda(fmt(linea.precio_unitario)),
      celda(fmt(linea.importe))
    );
    detalleBody.appendChild(tr);
  }
  if (!detalle.length) filaVacia(detalleBody, 6, "La cotización no tiene detalle.");

  const historial = $("cotizacion-transiciones-body");
  historial.replaceChildren();
  const transiciones = Array.isArray(cotizacionActiva.transiciones)
    ? cotizacionActiva.transiciones : [];
  for (const transicion of transiciones) {
    const cambio = transicion.estado_anterior
      ? texto(transicion.estado_anterior) + " → " + texto(transicion.estado_nuevo)
      : texto(transicion.estado_nuevo);
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(transicion.creado_en)), celda(cambio), celda(texto(transicion.motivo)),
      celda(texto(transicion.usuario, texto(transicion.actor, "Sistema")))
    );
    historial.appendChild(tr);
  }
  if (!transiciones.length) filaVacia(historial, 4, "Sin cambios registrados.");
  actualizarControlesCotizacion();
}

function actualizarControlesCotizacion() {
  if (!cotizacionActiva) return;
  const intento = intentoPerteneceACotizacion(intentoCotizacionAccion, cotizacionActiva.id)
    ? intentoCotizacionAccion : null;
  const vigente = texto(cotizacionActiva.estado).toUpperCase() === "VIGENTE"
    && !cotizacionVencida(cotizacionActiva);
  const reintentoConversion = intento && intento.tipo === "conversion";
  const reintentoCancelacion = intento && intento.tipo === "cancelacion";
  $("cotizacion-gestion").classList.toggle("hidden", !vigente && !intento);
  $("btn-convertir-cotizacion").disabled = cotizacionAccionEnCurso
    || Boolean(intento && !reintentoConversion) || (!reintentoConversion && !vigente);
  $("btn-convertir-cotizacion").textContent = cotizacionAccionEnCurso && reintentoConversion
    ? "Procesando…" : reintentoConversion ? "Reintentar conversión" : "Convertir y reservar";
  $("sel-cotizacion-entrega").disabled = cotizacionAccionEnCurso || Boolean(intento);
  $("btn-cancelar-cotizacion").disabled = !esSupervisor() || cotizacionAccionEnCurso
    || Boolean(intento && !reintentoCancelacion) || (!reintentoCancelacion && !vigente);
  $("btn-cancelar-cotizacion").textContent = cotizacionAccionEnCurso && reintentoCancelacion
    ? "Procesando…" : reintentoCancelacion ? "Reintentar cancelación" : "Cancelar cotización";
  $("inp-cotizacion-motivo").disabled = cotizacionAccionEnCurso || Boolean(intento);
  const verPedido = $("btn-cotizacion-ver-pedido");
  verPedido.classList.toggle("hidden", !cotizacionActiva.pedido_id);
  verPedido.disabled = cotizacionAccionEnCurso || Boolean(intento);
}

function carritoCoincideCotizacion(cotizacion) {
  if (!cotizacion || numero(cotizacion.cliente_id) !== numero(clienteVentaId)) return false;
  const detalle = Array.isArray(cotizacion.detalle) ? cotizacion.detalle : [];
  if (!detalle.length || detalle.length !== carrito.length) return false;
  const cantidades = new Map(detalle.map((linea) => [numero(linea.producto_id), numero(linea.cantidad)]));
  return carrito.every((linea) => cantidades.get(numero(linea.producto_id)) === numero(linea.cantidad));
}

async function ejecutarAccionCotizacion(tipo) {
  if (!cotizacionActiva || cotizacionAccionEnCurso) return;
  if (intentoCotizacionAccion && (
    !intentoPerteneceACotizacion(intentoCotizacionAccion, cotizacionActiva.id)
    || intentoCotizacionAccion.tipo !== tipo
  )) {
    $("cotizacion-error").textContent = "Primero reintenta la operación pendiente.";
    return;
  }
  if (!intentoCotizacionAccion) {
    if (texto(cotizacionActiva.estado).toUpperCase() !== "VIGENTE" || cotizacionVencida(cotizacionActiva)) {
      $("cotizacion-error").textContent = "La cotización ya no está vigente para esta operación.";
      return;
    }
    let body;
    if (tipo === "conversion") {
      body = { tipo_entrega: $("sel-cotizacion-entrega").value };
      if (!confirm("¿Convertir esta cotización en pedido y reservar sus existencias?")) return;
    } else {
      if (!esSupervisor()) return;
      const motivo = $("inp-cotizacion-motivo").value.trim();
      if (motivo.length < 3) {
        $("cotizacion-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
        return;
      }
      if (!confirm("¿Cancelar esta cotización? No se modificará el inventario.")) return;
      body = { motivo };
    }
    intentoCotizacionAccion = {
      cotizacionId: numero(cotizacionActiva.id),
      tipo,
      clave: nuevaClaveIdempotencia(),
      body,
    };
  }

  const vaciarCarrito = tipo === "conversion" && carritoCoincideCotizacion(cotizacionActiva);
  cotizacionAccionEnCurso = true;
  $("cotizacion-error").textContent = "";
  actualizarControlesCotizacion();
  try {
    if (tipo === "conversion") {
      const conversion = await api(
        "/cotizaciones/" + encodeURIComponent(cotizacionActiva.id) + "/conversion",
        {
          method: "POST",
          body: intentoCotizacionAccion.body,
          headers: { "Idempotency-Key": intentoCotizacionAccion.clave },
        }
      );
      intentoCotizacionAccion = null;
      cotizacionActiva = conversion.cotizacion;
      if (vaciarCarrito) {
        carrito = [];
        seleccionarClienteVenta(null);
        invalidarCotizacionPos();
        pintarCarrito();
      }
      pintarCotizacionActiva();
      await Promise.allSettled([
        cargarCotizaciones(),
        cargarPedidos({ reiniciar: true }),
      ]);
      toast("Cotización convertida en el pedido " + texto(conversion.pedido && conversion.pedido.folio) + ".", "ok");
    } else {
      const actualizada = await api(
        "/cotizaciones/" + encodeURIComponent(cotizacionActiva.id) + "/cancelacion",
        {
          method: "POST",
          body: intentoCotizacionAccion.body,
          headers: { "Idempotency-Key": intentoCotizacionAccion.clave },
        }
      );
      intentoCotizacionAccion = null;
      cotizacionActiva = actualizada;
      pintarCotizacionActiva();
      await cargarCotizaciones();
      toast("Cotización cancelada sin modificar existencias.", "ok");
    }
  } catch (error) {
    if (error.status && error.status < 500) intentoCotizacionAccion = null;
    $("cotizacion-error").textContent = intentoCotizacionAccion
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    cotizacionAccionEnCurso = false;
    if (cotizacionActiva) actualizarControlesCotizacion();
    actualizarControlesCaja();
  }
}

$("btn-convertir-cotizacion").addEventListener("click", () => void ejecutarAccionCotizacion("conversion"));
$("btn-cancelar-cotizacion").addEventListener("click", () => void ejecutarAccionCotizacion("cancelacion"));
$("btn-cotizacion-ver-pedido").addEventListener("click", () => {
  if (!cotizacionActiva || !cotizacionActiva.pedido_id || cotizacionAccionEnCurso) return;
  const pedidoId = cotizacionActiva.pedido_id;
  cerrarModal($("modal-cotizacion"), true);
  cambiarTab("pedidos");
  void abrirPedido(pedidoId);
});

$("btn-procesar-cotizaciones-vencidas").addEventListener("click", async () => {
  if (!esSupervisor()) return;
  await conBotonOcupado($("btn-procesar-cotizaciones-vencidas"), "Procesando…", async () => {
    try {
      const resultado = await api("/cotizaciones/expiraciones/procesar", {
        method: "POST",
        body: { limite: 100 },
      });
      await cargarCotizaciones({ reiniciar: true });
      if (cotizacionActiva && texto(cotizacionActiva.estado).toUpperCase() === "VIGENTE") {
        cotizacionActiva = await api("/cotizaciones/" + encodeURIComponent(cotizacionActiva.id));
        pintarCotizacionActiva();
      }
      toast(numero(resultado.procesadas) + " cotización(es) vencida(s) procesada(s).", "ok");
    } catch (error) {
      if (error.message !== "unauthorized") toast(error.message, "err");
    }
  });
});

function actualizarResumenAltaCotizacion() {
  const cliente = clientePorId($("cotizacion-alta-cliente").value);
  if (!cliente) {
    $("cotizacion-alta-resumen").textContent = "Selecciona un cliente registrado para guardar el carrito actual.";
    return;
  }
  if (!texto(cliente.telefono).trim()) {
    $("cotizacion-alta-resumen").textContent = texto(cliente.nombre)
      + " no tiene teléfono. Agrégalo en el directorio antes de guardar la cotización.";
    return;
  }
  const totalArticulos = carrito.reduce((suma, linea) => suma + numero(linea.cantidad), 0);
  $("cotizacion-alta-resumen").textContent = texto(cliente.nombre) + " · "
    + rotuloSegmento(cliente.segmento_precio) + " · " + totalArticulos
    + (totalArticulos === 1 ? " artículo · " : " artículos · ")
    + (cotizacionPosVigente() ? fmt(cotizacionPos.total) : "precio pendiente");
}

function actualizarControlesAltaCotizacion() {
  const congelado = Boolean(intentoAltaCotizacion);
  $("cotizacion-alta-cliente").disabled = altaCotizacionEnCurso
    || cambioClienteCotizacionEnCurso || congelado;
  $("inp-cotizacion-vigencia").disabled = altaCotizacionEnCurso || congelado;
  $("inp-cotizacion-notas").disabled = altaCotizacionEnCurso || congelado;
  const boton = $("btn-crear-cotizacion");
  boton.disabled = altaCotizacionEnCurso || cambioClienteCotizacionEnCurso;
  boton.textContent = altaCotizacionEnCurso
    ? "Procesando…" : congelado ? "Reintentar guardado" : "Guardar cotización";
  actualizarControlesCaja();
}

async function abrirAltaCotizacion() {
  if (altaCotizacionEnCurso || intentoAltaCotizacion) return;
  const cliente = clienteSeleccionadoVenta();
  if (!cliente) return toast("Selecciona un cliente registrado.", "err");
  if (!texto(cliente.telefono).trim()) {
    return toast("El cliente necesita un teléfono antes de guardar una cotización.", "err");
  }
  if (!cotizacionPosVigente()) await solicitarCotizacionPos();
  if (!cotizacionPosVigente()) {
    return toast(cotizacionPosError || "No hay precios vigentes para guardar la cotización.", "err");
  }
  $("cotizacion-alta-cliente").value = texto(cliente.id);
  $("inp-cotizacion-vigencia").value = "7";
  $("inp-cotizacion-notas").value = "";
  $("cotizacion-alta-error").textContent = "";
  actualizarResumenAltaCotizacion();
  actualizarControlesAltaCotizacion();
  abrirModal("modal-cotizacion-alta");
}

$("btn-guardar-cotizacion").addEventListener("click", () => void abrirAltaCotizacion());

$("cotizacion-alta-cliente").addEventListener("change", async (evento) => {
  if (altaCotizacionEnCurso || intentoAltaCotizacion || cambioClienteCotizacionEnCurso) return;
  cambioClienteCotizacionEnCurso = true;
  actualizarControlesAltaCotizacion();
  try {
    seleccionarClienteVenta(evento.currentTarget.value);
    invalidarCotizacionPos();
    pintarCarrito({ recotizar: false });
    await solicitarCotizacionPos();
    actualizarResumenAltaCotizacion();
  } finally {
    cambioClienteCotizacionEnCurso = false;
    actualizarControlesAltaCotizacion();
  }
});

$("form-cotizacion-alta").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (altaCotizacionEnCurso || cambioClienteCotizacionEnCurso) return;
  $("cotizacion-alta-error").textContent = "";
  if (!intentoAltaCotizacion) {
    const clienteId = numero($("cotizacion-alta-cliente").value, 0);
    const cliente = clientePorId(clienteId);
    const vigencia = Number($("inp-cotizacion-vigencia").value);
    if (!cliente) {
      $("cotizacion-alta-error").textContent = "Selecciona un cliente registrado.";
      return;
    }
    if (!texto(cliente.telefono).trim()) {
      $("cotizacion-alta-error").textContent = "El cliente necesita un teléfono registrado.";
      return;
    }
    if (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > 90) {
      $("cotizacion-alta-error").textContent = "La vigencia debe ser de 1 a 90 días.";
      return;
    }
    if (numero(clienteVentaId) !== clienteId) {
      seleccionarClienteVenta(clienteId);
      invalidarCotizacionPos();
      pintarCarrito({ recotizar: false });
      await solicitarCotizacionPos();
    }
    if (!carrito.length || !cotizacionPosVigente()) {
      $("cotizacion-alta-error").textContent = cotizacionPosError
        || "No hay una cotización de precios vigente para este carrito.";
      return;
    }
    intentoAltaCotizacion = {
      clave: nuevaClaveIdempotencia(),
      body: {
        cliente_id: clienteId,
        vigencia_dias: vigencia,
        notas: $("inp-cotizacion-notas").value.trim() || null,
        items: carrito.map((linea) => ({
          producto_id: numero(linea.producto_id),
          cantidad: numero(linea.cantidad),
        })),
      },
    };
  }

  altaCotizacionEnCurso = true;
  actualizarControlesAltaCotizacion();
  try {
    const creada = await api("/cotizaciones", {
      method: "POST",
      body: intentoAltaCotizacion.body,
      headers: { "Idempotency-Key": intentoAltaCotizacion.clave },
    });
    intentoAltaCotizacion = null;
    cerrarModal($("modal-cotizacion-alta"), true);
    await cargarCotizaciones({ reiniciar: true });
    toast("Cotización " + texto(creada.folio) + " guardada sin reservar inventario.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) intentoAltaCotizacion = null;
    $("cotizacion-alta-error").textContent = intentoAltaCotizacion
      ? error.message + " La clave se conservó; vuelve a intentarlo."
      : error.message;
  } finally {
    altaCotizacionEnCurso = false;
    actualizarControlesAltaCotizacion();
  }
});

/* ============================================================
   GESTIÓN EDITORIAL · OBRAS, COLABORADORES Y CONTRATOS
============================================================ */
const TRANSICIONES_OBRA_EDITORIAL = {
  PROPUESTA: ["EVALUACION", "ARCHIVADA"],
  EVALUACION: ["PROPUESTA", "CONTRATADA", "ARCHIVADA"],
  CONTRATADA: ["EVALUACION", "EDICION", "ARCHIVADA"],
  EDICION: ["CONTRATADA", "DISENO", "ARCHIVADA"],
  DISENO: ["EDICION", "IMPRESION", "ARCHIVADA"],
  IMPRESION: ["DISENO", "PUBLICADA", "ARCHIVADA"],
  PUBLICADA: ["ARCHIVADA"],
  ARCHIVADA: [],
};
const TRANSICIONES_CONTRATO_EDITORIAL = {
  BORRADOR: ["VIGENTE", "TERMINADO"],
  VIGENTE: ["SUSPENDIDO", "TERMINADO"],
  SUSPENDIDO: ["VIGENTE", "TERMINADO"],
  TERMINADO: [],
};
const TRANSICIONES_LIQUIDACION_REGALIA = {
  BORRADOR: ["EMITIDA", "CANCELADA"],
  EMITIDA: ["PAGADA", "CANCELADA"],
  PAGADA: [],
  CANCELADA: [],
};
const ROTULOS_EDITORIALES = {
  PROPUESTA: "Propuesta",
  EVALUACION: "Evaluación",
  CONTRATADA: "Contratada",
  EDICION: "Edición",
  DISENO: "Diseño",
  IMPRESION: "Impresión",
  PUBLICADA: "Publicada",
  ARCHIVADA: "Archivada",
  BORRADOR: "Borrador",
  VIGENTE: "Vigente",
  SUSPENDIDO: "Suspendido",
  TERMINADO: "Terminado",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
  EMITIDA: "Emitida",
  PAGADA: "Pagada",
  CANCELADA: "Cancelada",
  ENVIADA: "Enviada",
  PARCIAL: "Parcial",
  LIQUIDADA: "Unidades liquidadas",
  CERRADA: "Cerrada",
  CONSUMIDOR: "Consumidor",
  LIBRERIA: "Librería",
  DISTRIBUIDOR: "Distribuidor",
  INSTITUCION: "Institución",
  ENVIO: "Envío",
  VENTA: "Venta",
  DEVOLUCION: "Devolución",
  EDICION_CONTRATO: "Edición",
  CESION: "Cesión",
  LICENCIA: "Licencia",
  COLABORACION: "Colaboración",
  VENTA_NETA: "Venta neta",
  PRECIO_LISTA: "Precio de lista",
  MENSUAL: "Mensual",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
  UNICA: "Única",
  PREPRENSA: "Preprensa",
  PAPEL: "Papel",
  ENCUADERNACION: "Encuadernación",
  ACABADOS: "Acabados",
  TRANSPORTE: "Transporte",
  OTRO: "Otro",
};

function rotuloEditorial(valor) {
  return ROTULOS_EDITORIALES[texto(valor).toUpperCase()] || texto(valor, "—");
}

function fechaEditorial(valor) {
  if (!valor) return "—";
  const parte = texto(valor).slice(0, 10);
  const fecha = new Date(parte + "T00:00:00");
  return Number.isNaN(fecha.getTime()) ? parte : fecha.toLocaleDateString("es-MX");
}

function chipEstadoEditorial(estado) {
  const clave = texto(estado, "SIN_ESTADO").toLowerCase().replaceAll("_", "-");
  return nodo("span", "estado estado-" + clave, rotuloEditorial(estado));
}

function bloqueResumenEditorial(etiqueta, valor) {
  const bloque = nodo("div");
  bloque.append(nodo("span", "", etiqueta), nodo("strong", "", valor));
  return bloque;
}

function pintarResumenEditorial(contenedor, datos) {
  contenedor.replaceChildren(...datos.map(([etiqueta, valor]) =>
    bloqueResumenEditorial(etiqueta, valor)
  ));
}

function opcionalEditorial(valor) {
  const limpio = texto(valor).trim();
  return limpio || null;
}

async function postEditorialIdempotente(tipo, path, body) {
  const firma = JSON.stringify({ path, body });
  if (!intentoEditorialOperacion) {
    intentoEditorialOperacion = {
      tipo,
      path,
      body,
      firma,
      clave: nuevaClaveIdempotencia(),
    };
  } else if (intentoEditorialOperacion.tipo !== tipo
    || intentoEditorialOperacion.firma !== firma) {
    throw new Error("Hay una operación editorial pendiente. Reinténtala sin modificar sus datos.");
  }
  try {
    const resultado = await api(intentoEditorialOperacion.path, {
      method: "POST",
      body: intentoEditorialOperacion.body,
      headers: { "Idempotency-Key": intentoEditorialOperacion.clave },
    });
    intentoEditorialOperacion = null;
    return resultado;
  } catch (error) {
    if (error.status && error.status < 500) intentoEditorialOperacion = null;
    throw error;
  }
}

function cambiarEditorialSeccion(nombre) {
  if (!esSupervisor()
    || !["obras", "colaboradores", "contratos", "tirajes", "regalias", "consignaciones"].includes(nombre)) return;
  editorialSeccion = nombre;
  document.querySelectorAll(".subtab[data-editorial]").forEach((boton) => {
    const activo = boton.dataset.editorial === nombre;
    boton.classList.toggle("active", activo);
    boton.setAttribute("aria-selected", texto(activo));
  });
  document.querySelectorAll(".editorial-seccion").forEach((seccion) => {
    seccion.classList.toggle("active", seccion.id === "editorial-" + nombre);
  });
  void cargarEditorialActivo();
}

document.querySelectorAll(".subtab[data-editorial]").forEach((boton) => {
  boton.addEventListener("click", () => cambiarEditorialSeccion(boton.dataset.editorial));
});

async function cargarEditorialActivo() {
  if (!esSupervisor()) return;
  if (editorialSeccion === "colaboradores") await cargarColaboradoresEditoriales();
  else if (editorialSeccion === "contratos") await cargarContratosEditoriales();
  else if (editorialSeccion === "tirajes") await cargarTirajesEditoriales();
  else if (editorialSeccion === "regalias") await cargarRegaliasEditoriales();
  else if (editorialSeccion === "consignaciones") await cargarConsignacionesEditoriales();
  else await cargarObrasEditoriales();
}

async function obtenerOpcionesEditoriales(path, propiedad) {
  const todos = [];
  for (let pagina = 1; pagina <= 100; pagina += 1) {
    const separador = path.includes("?") ? "&" : "?";
    const respuesta = await api(path + separador + "page=" + pagina + "&limit=100");
    const lote = extraerLista(respuesta, propiedad);
    todos.push(...lote);
    if (lote.length < 100) break;
  }
  return todos;
}

async function cargarOpcionesObrasEditoriales() {
  obrasEditorialesOpciones = await obtenerOpcionesEditoriales("/editorial/obras", "obras");
  reponerOpciones(
    $("sel-contrato-editorial-obra"),
    "Selecciona una obra",
    obrasEditorialesOpciones.filter((obra) => obra.estado !== "ARCHIVADA"),
    (obra) => texto(obra.folio) + " · " + texto(obra.titulo)
  );
  reponerOpciones(
    $("sel-tiraje-editorial-obra"),
    "Selecciona una obra",
    obrasEditorialesOpciones.filter((obra) =>
      ["CONTRATADA", "EDICION", "DISENO", "IMPRESION", "PUBLICADA"].includes(obra.estado)
    ),
    (obra) => texto(obra.folio) + " · " + texto(obra.titulo)
  );
}

async function cargarOpcionesColaboradoresEditoriales() {
  colaboradoresEditorialesOpciones = await obtenerOpcionesEditoriales(
    "/editorial/colaboradores?incluir_inactivos=true",
    "colaboradores"
  );
  reponerOpciones(
    $("sel-obra-colaborador"),
    "Selecciona un colaborador",
    colaboradoresEditorialesOpciones.filter((colaborador) => colaborador.activo !== false),
    (colaborador) => texto(colaborador.nombre_publico || colaborador.nombre_legal)
  );
}

function actualizarPaginacionEditorial(tipo) {
  const configuraciones = {
    obras: [obrasEditorialesPagina, obrasEditorialesHaySiguiente, obrasEditorialesCargaEnCurso],
    colaboradores: [
      colaboradoresEditorialesPagina,
      colaboradoresEditorialesHaySiguiente,
      colaboradoresEditorialesCargaEnCurso,
    ],
    contratos: [
      contratosEditorialesPagina,
      contratosEditorialesHaySiguiente,
      contratosEditorialesCargaEnCurso,
    ],
    tirajes: [tirajesEditorialesPagina, tirajesEditorialesHaySiguiente, tirajesEditorialesCargaEnCurso],
    regalias: [
      regaliasEditorialesPagina,
      regaliasEditorialesHaySiguiente,
      regaliasEditorialesCargaEnCurso,
    ],
    consignaciones: [
      consignacionesEditorialesPagina,
      consignacionesEditorialesHaySiguiente,
      consignacionesEditorialesCargaEnCurso,
    ],
  };
  const [pagina, siguiente, cargando] = configuraciones[tipo];
  $(tipo + "-editoriales-pagina").textContent = "Página " + pagina;
  $("btn-" + tipo + "-editoriales-anterior").disabled = cargando || pagina <= 1;
  $("btn-" + tipo + "-editoriales-siguiente").disabled = cargando || !siguiente;
}

async function cargarObrasEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || obrasEditorialesCargaEnCurso) return;
  if (reiniciar) obrasEditorialesPagina = 1;
  obrasEditorialesCargaEnCurso = true;
  filaVacia($("editorial-obras-body"), 8, "Cargando obras…");
  actualizarPaginacionEditorial("obras");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-obra-q").value.trim(),
      page: texto(obrasEditorialesPagina),
      limit: "30",
    });
    if ($("sel-editorial-obra-estado").value) {
      parametros.set("estado", $("sel-editorial-obra-estado").value);
    }
    const respuesta = await api("/editorial/obras?" + parametros.toString());
    obrasEditoriales = extraerLista(respuesta, "obras");
    obrasEditorialesHaySiguiente = obrasEditoriales.length === 30;
    pintarObrasEditoriales();
  } catch (error) {
    filaVacia($("editorial-obras-body"), 8, error.message);
  } finally {
    obrasEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("obras");
  }
}

function pintarObrasEditoriales() {
  const tbody = $("editorial-obras-body");
  tbody.replaceChildren();
  for (const obra of obrasEditoriales) {
    const tr = document.createElement("tr");
    const titulo = document.createElement("td");
    titulo.append(nodo("strong", "", obra.titulo));
    if (obra.subtitulo) titulo.append(nodo("small", "tabla-detalle", obra.subtitulo));
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(obra.estado));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirObraEditorial(obra.id));
    acciones.appendChild(boton);
    tr.append(
      celda(obra.folio),
      titulo,
      estado,
      celda(obra.editor_responsable || "Sin asignar"),
      celda(numero(obra.colaboradores)),
      celda(numero(obra.ediciones)),
      celda(numero(obra.contratos_no_terminados)),
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!obrasEditoriales.length) filaVacia(tbody, 8, "No hay obras para este filtro.");
}

async function cargarColaboradoresEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || colaboradoresEditorialesCargaEnCurso) return;
  if (reiniciar) colaboradoresEditorialesPagina = 1;
  colaboradoresEditorialesCargaEnCurso = true;
  filaVacia($("editorial-colaboradores-body"), 7, "Cargando colaboradores…");
  actualizarPaginacionEditorial("colaboradores");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-colaborador-q").value.trim(),
      incluir_inactivos: texto($("chk-editorial-colaboradores-inactivos").checked),
      page: texto(colaboradoresEditorialesPagina),
      limit: "30",
    });
    const respuesta = await api("/editorial/colaboradores?" + parametros.toString());
    colaboradoresEditoriales = extraerLista(respuesta, "colaboradores");
    colaboradoresEditorialesHaySiguiente = colaboradoresEditoriales.length === 30;
    pintarColaboradoresEditoriales();
  } catch (error) {
    filaVacia($("editorial-colaboradores-body"), 7, error.message);
  } finally {
    colaboradoresEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("colaboradores");
  }
}

function pintarColaboradoresEditoriales() {
  const tbody = $("editorial-colaboradores-body");
  tbody.replaceChildren();
  for (const colaborador of colaboradoresEditoriales) {
    const contacto = document.createElement("td");
    contacto.append(nodo("span", "", colaborador.email || "Sin correo"));
    contacto.append(nodo("small", "tabla-detalle", colaborador.telefono || "Sin teléfono"));
    const estado = document.createElement("td");
    estado.appendChild(estadoChip(colaborador.activo !== false));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Editar");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirColaboradorEditorial(colaborador.id));
    acciones.appendChild(boton);
    const tr = document.createElement("tr");
    tr.append(
      celda(colaborador.nombre_legal),
      celda(colaborador.nombre_publico || "—"),
      contacto,
      celda(numero(colaborador.obras_vinculadas)),
      celda(numero(colaborador.contratos_no_terminados)),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!colaboradoresEditoriales.length) {
    filaVacia(tbody, 7, "No hay colaboradores para este filtro.");
  }
}

async function cargarContratosEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || contratosEditorialesCargaEnCurso) return;
  if (reiniciar) contratosEditorialesPagina = 1;
  contratosEditorialesCargaEnCurso = true;
  filaVacia($("editorial-contratos-body"), 8, "Cargando contratos…");
  actualizarPaginacionEditorial("contratos");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-contrato-q").value.trim(),
      page: texto(contratosEditorialesPagina),
      limit: "30",
    });
    if ($("sel-editorial-contrato-estado").value) {
      parametros.set("estado", $("sel-editorial-contrato-estado").value);
    }
    const respuesta = await api("/editorial/contratos?" + parametros.toString());
    contratosEditoriales = extraerLista(respuesta, "contratos");
    contratosEditorialesHaySiguiente = contratosEditoriales.length === 30;
    pintarContratosEditoriales();
  } catch (error) {
    filaVacia($("editorial-contratos-body"), 8, error.message);
  } finally {
    contratosEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("contratos");
  }
}

function pintarContratosEditoriales() {
  const tbody = $("editorial-contratos-body");
  tbody.replaceChildren();
  for (const contrato of contratosEditoriales) {
    const obra = document.createElement("td");
    obra.append(nodo("strong", "", contrato.obra_titulo));
    obra.append(nodo("small", "tabla-detalle", contrato.obra_folio));
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(contrato.estado));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirContratoEditorial(contrato.id));
    acciones.appendChild(boton);
    const vigencia = fechaEditorial(contrato.vigente_desde) + " – "
      + fechaEditorial(contrato.vigente_hasta);
    const tr = document.createElement("tr");
    tr.append(
      celda(contrato.folio),
      obra,
      celda(contrato.colaborador_nombre),
      celda(rotuloEditorial(contrato.tipo)),
      celda(numero(contrato.porcentaje_regalia).toFixed(4).replace(/\.?0+$/, "") + "%"),
      celda(vigencia),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!contratosEditoriales.length) filaVacia(tbody, 8, "No hay contratos para este filtro.");
}

$("form-editorial-obras-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarObrasEditoriales({ reiniciar: true });
});
$("btn-refrescar-obras-editoriales").addEventListener("click", () =>
  void cargarObrasEditoriales({ reiniciar: false })
);
$("form-editorial-colaboradores-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarColaboradoresEditoriales({ reiniciar: true });
});
$("btn-refrescar-colaboradores-editoriales").addEventListener("click", () =>
  void cargarColaboradoresEditoriales({ reiniciar: false })
);
$("form-editorial-contratos-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarContratosEditoriales({ reiniciar: true });
});
$("btn-refrescar-contratos-editoriales").addEventListener("click", () =>
  void cargarContratosEditoriales({ reiniciar: false })
);

for (const tipo of ["obras", "colaboradores", "contratos", "tirajes", "regalias", "consignaciones"]) {
  $("btn-" + tipo + "-editoriales-anterior").addEventListener("click", () => {
    if (tipo === "obras" && obrasEditorialesPagina > 1) obrasEditorialesPagina -= 1;
    if (tipo === "colaboradores" && colaboradoresEditorialesPagina > 1) {
      colaboradoresEditorialesPagina -= 1;
    }
    if (tipo === "contratos" && contratosEditorialesPagina > 1) contratosEditorialesPagina -= 1;
    if (tipo === "tirajes" && tirajesEditorialesPagina > 1) tirajesEditorialesPagina -= 1;
    if (tipo === "regalias" && regaliasEditorialesPagina > 1) regaliasEditorialesPagina -= 1;
    if (tipo === "consignaciones" && consignacionesEditorialesPagina > 1) {
      consignacionesEditorialesPagina -= 1;
    }
    void cargarEditorialActivo();
  });
  $("btn-" + tipo + "-editoriales-siguiente").addEventListener("click", () => {
    if (tipo === "obras" && obrasEditorialesHaySiguiente) obrasEditorialesPagina += 1;
    if (tipo === "colaboradores" && colaboradoresEditorialesHaySiguiente) {
      colaboradoresEditorialesPagina += 1;
    }
    if (tipo === "contratos" && contratosEditorialesHaySiguiente) contratosEditorialesPagina += 1;
    if (tipo === "tirajes" && tirajesEditorialesHaySiguiente) tirajesEditorialesPagina += 1;
    if (tipo === "regalias" && regaliasEditorialesHaySiguiente) regaliasEditorialesPagina += 1;
    if (tipo === "consignaciones" && consignacionesEditorialesHaySiguiente) {
      consignacionesEditorialesPagina += 1;
    }
    void cargarEditorialActivo();
  });
}

function abrirAccionEditorial({
  titulo,
  estados = [],
  ayuda = "",
  referencia = false,
  referenciaObligatoria = false,
  textoBoton = "Confirmar",
  ejecutar,
}) {
  if (editorialOperacionEnCurso || intentoEditorialOperacion) return;
  accionEditorialActiva = { ejecutar, referenciaObligatoria };
  $("editorial-accion-titulo").textContent = titulo;
  const select = $("sel-editorial-accion-estado");
  select.replaceChildren(...estados.map((estado) => opcion(estado, rotuloEditorial(estado))));
  $("editorial-accion-estado-wrap").classList.toggle("hidden", !estados.length);
  $("editorial-accion-referencia-wrap").classList.toggle("hidden", !referencia);
  $("inp-editorial-accion-referencia").required = referenciaObligatoria;
  $("inp-editorial-accion-motivo").value = "";
  $("inp-editorial-accion-referencia").value = "";
  $("editorial-accion-ayuda").textContent = ayuda;
  $("editorial-accion-ayuda").classList.toggle("hidden", !ayuda);
  $("editorial-accion-error").textContent = "";
  $("btn-confirmar-editorial-accion").textContent = textoBoton;
  abrirModal("modal-editorial-accion");
}

$("form-editorial-accion").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!accionEditorialActiva || editorialOperacionEnCurso) return;
  const motivo = $("inp-editorial-accion-motivo").value.trim();
  const referencia = $("inp-editorial-accion-referencia").value.trim();
  if (motivo.length < 3) {
    $("editorial-accion-error").textContent = "Escribe un motivo de al menos 3 caracteres.";
    return;
  }
  if (accionEditorialActiva.referenciaObligatoria && !referencia) {
    $("editorial-accion-error").textContent = "La referencia es obligatoria.";
    return;
  }
  editorialOperacionEnCurso = true;
  $("editorial-accion-error").textContent = "";
  await conBotonOcupado($("btn-confirmar-editorial-accion"), "Procesando…", async () => {
    try {
      await accionEditorialActiva.ejecutar({
        estado: $("sel-editorial-accion-estado").value,
        motivo,
        referencia: referencia || null,
      });
      accionEditorialActiva = null;
      cerrarModal($("modal-editorial-accion"), true);
    } catch (error) {
      $("editorial-accion-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

function pintarTransicionesEditoriales(tbody, transiciones) {
  tbody.replaceChildren();
  for (const transicion of transiciones || []) {
    const cambio = transicion.estado_anterior
      ? rotuloEditorial(transicion.estado_anterior) + " → " + rotuloEditorial(transicion.estado_nuevo)
      : rotuloEditorial(transicion.estado_nuevo);
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(transicion.creado_en)),
      celda(cambio),
      celda(transicion.motivo),
      celda(transicion.usuario)
    );
    tbody.appendChild(tr);
  }
  if (!(transiciones || []).length) filaVacia(tbody, 4, "Sin cambios registrados.");
}

function abrirFormularioObraEditorial(obra = null) {
  if (!esSupervisor() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  const edicion = Boolean(obra);
  obraEditorialActiva = obra || null;
  $("obra-editorial-modal-titulo").textContent = edicion ? "Editar obra" : "Nueva obra";
  $("btn-guardar-obra-editorial").textContent = edicion ? "Guardar cambios" : "Guardar obra";
  $("inp-obra-editorial-id").value = texto(obra && obra.id);
  $("inp-obra-editorial-titulo").value = texto(obra && obra.titulo);
  $("inp-obra-editorial-subtitulo").value = texto(obra && obra.subtitulo);
  $("inp-obra-editorial-idioma").value = texto(obra && obra.idioma, "Español");
  $("inp-obra-editorial-recepcion").value = fechaParaInput(obra && obra.fecha_recepcion)
    || new Date().toISOString().slice(0, 10);
  $("inp-obra-editorial-objetivo").value = fechaParaInput(
    obra && obra.fecha_objetivo_publicacion
  );
  $("inp-obra-editorial-sinopsis").value = texto(obra && obra.sinopsis);
  $("inp-obra-editorial-notas").value = texto(obra && obra.notas);
  $("obra-editorial-error").textContent = "";
  abrirModal("modal-obra-editorial");
}

$("btn-nueva-obra-editorial").addEventListener("click", () => abrirFormularioObraEditorial());

$("form-obra-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const id = numero($("inp-obra-editorial-id").value, 0);
  const titulo = $("inp-obra-editorial-titulo").value.trim();
  const idioma = $("inp-obra-editorial-idioma").value.trim();
  if (titulo.length < 2 || idioma.length < 2) {
    $("obra-editorial-error").textContent = "Revisa el título y el idioma de la obra.";
    return;
  }
  const body = {
    titulo,
    subtitulo: opcionalEditorial($("inp-obra-editorial-subtitulo").value),
    sinopsis: opcionalEditorial($("inp-obra-editorial-sinopsis").value),
    idioma,
    fecha_recepcion: $("inp-obra-editorial-recepcion").value,
    fecha_objetivo_publicacion: $("inp-obra-editorial-objetivo").value || null,
    notas: opcionalEditorial($("inp-obra-editorial-notas").value),
  };
  editorialOperacionEnCurso = true;
  $("obra-editorial-error").textContent = "";
  await conBotonOcupado($("btn-guardar-obra-editorial"), "Guardando…", async () => {
    try {
      const guardada = id
        ? await api("/editorial/obras/" + encodeURIComponent(id), { method: "PATCH", body })
        : await postEditorialIdempotente("ALTA_OBRA_EDITORIAL", "/editorial/obras", body);
      obraEditorialActiva = guardada;
      cerrarModal($("modal-obra-editorial"), true);
      await Promise.all([
        cargarObrasEditoriales({ reiniciar: !id }),
        cargarOpcionesObrasEditoriales(),
      ]);
      pintarObraEditorialActiva();
      abrirModal("modal-obra-editorial-detalle");
      toast(id ? "Obra actualizada." : "Obra editorial creada.", "ok");
    } catch (error) {
      $("obra-editorial-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function prepararOpcionesObraEditorial() {
  const tareas = [];
  if (!colaboradoresEditorialesOpciones.length) tareas.push(cargarOpcionesColaboradoresEditoriales());
  if (!productosCatalogoOpciones.length) tareas.push(cargarProductosCatalogoOpciones());
  await Promise.all(tareas);
}

function actualizarOpcionesDetalleObra() {
  if (!obraEditorialActiva) return;
  const colaboradoresVinculados = new Set(
    (obraEditorialActiva.colaboradores || []).map((item) => numero(item.colaborador_editorial_id))
  );
  reponerOpciones(
    $("sel-obra-colaborador"),
    "Selecciona un colaborador",
    colaboradoresEditorialesOpciones.filter((item) =>
      item.activo !== false && !colaboradoresVinculados.has(numero(item.id))
    ),
    (item) => texto(item.nombre_publico || item.nombre_legal)
  );
  reponerOpciones(
    $("sel-obra-edicion-producto"),
    "Selecciona un producto sin obra",
    productosCatalogoOpciones.filter((item) =>
      item.activo !== false && !numero(item.obra_editorial_id, 0)
    ),
    (item) => texto(item.sku) + " · " + texto(item.titulo)
  );
}

async function abrirObraEditorial(id) {
  if (!esSupervisor()) return;
  try {
    const [obra] = await Promise.all([
      api("/editorial/obras/" + encodeURIComponent(id)),
      prepararOpcionesObraEditorial(),
    ]);
    obraEditorialActiva = obra;
    pintarObraEditorialActiva();
    abrirModal("modal-obra-editorial-detalle");
  } catch (error) {
    toast(error.message, "err");
  }
}

function pintarObraEditorialActiva() {
  const obra = obraEditorialActiva;
  if (!obra) return;
  $("obra-editorial-detalle-titulo").textContent = texto(obra.folio) + " · " + texto(obra.titulo);
  pintarResumenEditorial($("obra-editorial-resumen"), [
    ["Etapa", rotuloEditorial(obra.estado)],
    ["Idioma", obra.idioma || "—"],
    ["Recepción", fechaEditorial(obra.fecha_recepcion)],
    ["Objetivo", fechaEditorial(obra.fecha_objetivo_publicacion)],
    ["Responsable", obra.editor_responsable || "Sin asignar"],
    ["Creada por", obra.creado_por || "—"],
  ]);
  $("obra-editorial-sinopsis").textContent = texto(obra.sinopsis);
  $("obra-editorial-sinopsis").classList.toggle("hidden", !obra.sinopsis);
  $("obra-editorial-detalle-error").textContent = "";
  const archivada = obra.estado === "ARCHIVADA";
  const estados = TRANSICIONES_OBRA_EDITORIAL[obra.estado] || [];
  $("btn-editar-obra-editorial").classList.toggle("hidden", archivada);
  $("btn-transicionar-obra-editorial").classList.toggle("hidden", !estados.length);
  $("form-vinculo-colaborador-obra").classList.toggle("hidden", archivada);
  $("form-vinculo-edicion-obra").classList.toggle("hidden", archivada);
  actualizarOpcionesDetalleObra();

  const equipo = $("obra-editorial-colaboradores-body");
  equipo.replaceChildren();
  for (const vinculo of obra.colaboradores || []) {
    const acciones = document.createElement("td");
    if (!archivada) {
      const quitar = nodo("button", "btn btn-danger", "Retirar");
      quitar.type = "button";
      quitar.addEventListener("click", () => void retirarColaboradorDeObra(vinculo, quitar));
      acciones.appendChild(quitar);
    }
    const tr = document.createElement("tr");
    tr.append(
      celda(rotuloEditorial(vinculo.rol)),
      celda(vinculo.nombre_publico || vinculo.nombre_legal),
      celda(vinculo.nombre_credito || vinculo.nombre_publico || vinculo.nombre_legal),
      celda(vinculo.credito_publico ? "Sí" : "No"),
      acciones
    );
    equipo.appendChild(tr);
  }
  if (!(obra.colaboradores || []).length) filaVacia(equipo, 5, "La obra aún no tiene equipo.");

  const ediciones = $("obra-editorial-ediciones-body");
  ediciones.replaceChildren();
  for (const edicion of obra.ediciones || []) {
    const acciones = document.createElement("td");
    if (!["PUBLICADA", "ARCHIVADA"].includes(obra.estado)) {
      const quitar = nodo("button", "btn btn-danger", "Desvincular");
      quitar.type = "button";
      quitar.addEventListener("click", () => abrirDesvinculacionEdicion(edicion));
      acciones.appendChild(quitar);
    }
    const nombre = document.createElement("td");
    nombre.append(nodo("strong", "", edicion.titulo));
    if (edicion.edicion) nombre.append(nodo("small", "tabla-detalle", edicion.edicion));
    const tr = document.createElement("tr");
    tr.append(
      celda(edicion.sku),
      nombre,
      celda(edicion.isbn || "—"),
      celda(numero(edicion.stock)),
      celda(edicion.publicado_web ? "Publicado" : "No publicado"),
      acciones
    );
    ediciones.appendChild(tr);
  }
  if (!(obra.ediciones || []).length) filaVacia(ediciones, 6, "No hay ediciones vinculadas.");

  const contratos = $("obra-editorial-contratos-body");
  contratos.replaceChildren();
  for (const contrato of obra.contratos || []) {
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(contrato.estado));
    const tr = document.createElement("tr");
    tr.append(
      celda(contrato.folio),
      celda(contrato.colaborador_nombre),
      celda(rotuloEditorial(contrato.tipo)),
      celda(numero(contrato.porcentaje_regalia).toFixed(4).replace(/\.?0+$/, "") + "%"),
      estado
    );
    contratos.appendChild(tr);
  }
  if (!(obra.contratos || []).length) filaVacia(contratos, 5, "No hay contratos para esta obra.");
  pintarTransicionesEditoriales(
    $("obra-editorial-transiciones-body"),
    obra.transiciones
  );
}

$("btn-editar-obra-editorial").addEventListener("click", () => {
  if (!obraEditorialActiva || obraEditorialActiva.estado === "ARCHIVADA") return;
  cerrarModal($("modal-obra-editorial-detalle"), true);
  abrirFormularioObraEditorial(obraEditorialActiva);
});

$("btn-transicionar-obra-editorial").addEventListener("click", () => {
  if (!obraEditorialActiva) return;
  const id = obraEditorialActiva.id;
  const estados = TRANSICIONES_OBRA_EDITORIAL[obraEditorialActiva.estado] || [];
  abrirAccionEditorial({
    titulo: "Cambiar etapa de " + texto(obraEditorialActiva.folio),
    estados,
    ayuda: "La evaluación requiere equipo; la contratación requiere contrato vigente; impresión y publicación requieren una edición vinculada.",
    ejecutar: async ({ estado, motivo }) => {
      obraEditorialActiva = await postEditorialIdempotente(
        "TRANSICION_OBRA_" + id,
        "/editorial/obras/" + encodeURIComponent(id) + "/transiciones",
        { estado, motivo }
      );
      pintarObraEditorialActiva();
      await cargarObrasEditoriales();
      toast("Etapa editorial actualizada.", "ok");
    },
  });
});

$("form-vinculo-colaborador-obra").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!obraEditorialActiva || editorialOperacionEnCurso) return;
  const colaboradorId = numero($("sel-obra-colaborador").value, 0);
  const orden = Number($("inp-obra-colaborador-orden").value);
  if (!colaboradorId || !Number.isInteger(orden) || orden < 0 || orden > 999) {
    $("obra-editorial-detalle-error").textContent = "Selecciona un colaborador y revisa el orden del crédito.";
    return;
  }
  const id = obraEditorialActiva.id;
  const body = {
    colaborador_editorial_id: colaboradorId,
    rol: $("sel-obra-colaborador-rol").value,
    nombre_credito: opcionalEditorial($("inp-obra-colaborador-credito").value),
    orden_credito: orden,
    credito_publico: $("chk-obra-colaborador-publico").checked,
    notas: opcionalEditorial($("inp-obra-colaborador-notas").value),
  };
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-vincular-colaborador-obra"), "Agregando…", async () => {
    try {
      obraEditorialActiva = await postEditorialIdempotente(
        "VINCULO_COLABORADOR_OBRA_" + id,
        "/editorial/obras/" + encodeURIComponent(id) + "/colaboradores",
        body
      );
      evento.currentTarget.reset();
      $("inp-obra-colaborador-orden").value = "0";
      $("chk-obra-colaborador-publico").checked = true;
      pintarObraEditorialActiva();
      await Promise.all([cargarObrasEditoriales(), cargarOpcionesObrasEditoriales()]);
      toast("Colaborador agregado a la obra.", "ok");
    } catch (error) {
      $("obra-editorial-detalle-error").textContent = error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function retirarColaboradorDeObra(vinculo, boton) {
  if (!obraEditorialActiva || editorialOperacionEnCurso) return;
  if (!confirm("¿Retirar a este colaborador del equipo de la obra?")) return;
  editorialOperacionEnCurso = true;
  await conBotonOcupado(boton, "Retirando…", async () => {
    try {
      obraEditorialActiva = await api(
        "/editorial/obras/" + encodeURIComponent(obraEditorialActiva.id)
          + "/colaboradores/" + encodeURIComponent(vinculo.id),
        { method: "DELETE" }
      );
      pintarObraEditorialActiva();
      await Promise.all([cargarObrasEditoriales(), cargarOpcionesObrasEditoriales()]);
      toast("Colaborador retirado de la obra.", "ok");
    } catch (error) {
      $("obra-editorial-detalle-error").textContent = error.message;
    }
  });
  editorialOperacionEnCurso = false;
}

$("form-vinculo-edicion-obra").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!obraEditorialActiva || editorialOperacionEnCurso) return;
  const productoId = numero($("sel-obra-edicion-producto").value, 0);
  const motivo = $("inp-obra-edicion-motivo").value.trim();
  if (!productoId || motivo.length < 3) {
    $("obra-editorial-detalle-error").textContent = "Selecciona un producto y escribe un motivo de al menos 3 caracteres.";
    return;
  }
  const id = obraEditorialActiva.id;
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-vincular-edicion-obra"), "Vinculando…", async () => {
    try {
      obraEditorialActiva = await postEditorialIdempotente(
        "VINCULO_EDICION_OBRA_" + id,
        "/editorial/obras/" + encodeURIComponent(id) + "/ediciones",
        { producto_id: productoId, motivo }
      );
      $("inp-obra-edicion-motivo").value = "";
      productosCatalogoOpciones = [];
      await prepararOpcionesObraEditorial();
      pintarObraEditorialActiva();
      await cargarObrasEditoriales();
      toast("Edición vinculada a la obra.", "ok");
    } catch (error) {
      $("obra-editorial-detalle-error").textContent = error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

function abrirDesvinculacionEdicion(edicion) {
  if (!obraEditorialActiva) return;
  const obraId = obraEditorialActiva.id;
  abrirAccionEditorial({
    titulo: "Desvincular " + texto(edicion.sku),
    ayuda: "El producto permanecerá en el catálogo; sólo se retirará su vínculo con esta obra.",
    textoBoton: "Desvincular edición",
    ejecutar: async ({ motivo }) => {
      obraEditorialActiva = await postEditorialIdempotente(
        "DESVINCULO_EDICION_" + obraId + "_" + edicion.id,
        "/editorial/obras/" + encodeURIComponent(obraId)
          + "/ediciones/" + encodeURIComponent(edicion.id) + "/desvinculacion",
        { motivo }
      );
      productosCatalogoOpciones = [];
      await prepararOpcionesObraEditorial();
      pintarObraEditorialActiva();
      await cargarObrasEditoriales();
      toast("Edición desvinculada.", "ok");
    },
  });
}

async function abrirColaboradorEditorial(id = null) {
  if (!esSupervisor() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  try {
    colaboradorEditorialActivo = id
      ? await api("/editorial/colaboradores/" + encodeURIComponent(id))
      : null;
    const colaborador = colaboradorEditorialActivo;
    $("colaborador-editorial-modal-titulo").textContent = colaborador
      ? "Editar colaborador" : "Nuevo colaborador";
    $("btn-guardar-colaborador-editorial").textContent = colaborador
      ? "Guardar cambios" : "Guardar colaborador";
    $("inp-colaborador-editorial-id").value = texto(colaborador && colaborador.id);
    $("inp-colaborador-editorial-nombre-legal").value = texto(colaborador && colaborador.nombre_legal);
    $("inp-colaborador-editorial-nombre-publico").value = texto(colaborador && colaborador.nombre_publico);
    $("inp-colaborador-editorial-email").value = texto(colaborador && colaborador.email);
    $("inp-colaborador-editorial-telefono").value = texto(colaborador && colaborador.telefono);
    $("inp-colaborador-editorial-fiscal").value = texto(colaborador && colaborador.identificador_fiscal);
    $("chk-colaborador-editorial-activo").checked = colaborador ? colaborador.activo !== false : true;
    $("inp-colaborador-editorial-notas").value = texto(colaborador && colaborador.notas);
    $("colaborador-editorial-error").textContent = "";
    abrirModal("modal-colaborador-editorial");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-nuevo-colaborador-editorial").addEventListener("click", () =>
  void abrirColaboradorEditorial()
);

$("form-colaborador-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const id = numero($("inp-colaborador-editorial-id").value, 0);
  const nombreLegal = $("inp-colaborador-editorial-nombre-legal").value.trim();
  if (nombreLegal.length < 2) {
    $("colaborador-editorial-error").textContent = "El nombre legal debe tener al menos 2 caracteres.";
    return;
  }
  const body = {
    nombre_legal: nombreLegal,
    nombre_publico: opcionalEditorial($("inp-colaborador-editorial-nombre-publico").value),
    email: opcionalEditorial($("inp-colaborador-editorial-email").value),
    telefono: opcionalEditorial($("inp-colaborador-editorial-telefono").value),
    identificador_fiscal: opcionalEditorial($("inp-colaborador-editorial-fiscal").value),
    notas: opcionalEditorial($("inp-colaborador-editorial-notas").value),
  };
  if (id) body.activo = $("chk-colaborador-editorial-activo").checked;
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-guardar-colaborador-editorial"), "Guardando…", async () => {
    try {
      const guardado = id
        ? await api("/editorial/colaboradores/" + encodeURIComponent(id), { method: "PATCH", body })
        : await postEditorialIdempotente(
          "ALTA_COLABORADOR_EDITORIAL",
          "/editorial/colaboradores",
          body
        );
      colaboradorEditorialActivo = guardado;
      cerrarModal($("modal-colaborador-editorial"), true);
      await Promise.all([
        cargarColaboradoresEditoriales({ reiniciar: !id }),
        cargarOpcionesColaboradoresEditoriales(),
      ]);
      if (obraEditorialActiva && $("modal-obra-editorial-detalle").classList.contains("open")) {
        actualizarOpcionesDetalleObra();
      }
      toast(id ? "Colaborador actualizado." : "Colaborador editorial creado.", "ok");
    } catch (error) {
      $("colaborador-editorial-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function cargarColaboradoresContratoPorObra(obraId, seleccionado = null) {
  const select = $("sel-contrato-editorial-colaborador");
  select.disabled = true;
  select.replaceChildren(opcion("", obraId ? "Cargando equipo…" : "Selecciona primero una obra"));
  if (!obraId) return;
  try {
    const obra = obraEditorialActiva && numero(obraEditorialActiva.id) === numero(obraId)
      ? obraEditorialActiva
      : await api("/editorial/obras/" + encodeURIComponent(obraId));
    const equipo = (obra.colaboradores || []).filter((item) => item.colaborador_activo !== false);
    select.replaceChildren(opcion("", "Selecciona un colaborador"));
    for (const item of equipo) {
      select.appendChild(opcion(
        item.colaborador_editorial_id,
        texto(item.nombre_publico || item.nombre_legal) + " · " + rotuloEditorial(item.rol)
      ));
    }
    if (seleccionado && Array.from(select.options).some((item) => item.value === texto(seleccionado))) {
      select.value = texto(seleccionado);
    }
  } catch (error) {
    select.replaceChildren(opcion("", "No fue posible cargar el equipo"));
    $("contrato-editorial-error").textContent = error.message;
  } finally {
    select.disabled = Boolean($("inp-contrato-editorial-id").value);
  }
}

async function abrirFormularioContratoEditorial(contrato = null, obraPreseleccionada = null) {
  if (!esAdmin() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  try {
    if (!obrasEditorialesOpciones.length) await cargarOpcionesObrasEditoriales();
    contratoEditorialActivo = contrato || null;
    const edicion = Boolean(contrato);
    $("contrato-editorial-modal-titulo").textContent = edicion ? "Editar contrato" : "Nuevo contrato";
    $("btn-guardar-contrato-editorial").textContent = edicion ? "Guardar cambios" : "Guardar contrato";
    $("inp-contrato-editorial-id").value = texto(contrato && contrato.id);
    const obraId = contrato ? contrato.obra_editorial_id : obraPreseleccionada;
    $("sel-contrato-editorial-obra").value = texto(obraId);
    $("sel-contrato-editorial-obra").disabled = edicion;
    $("sel-contrato-editorial-tipo").value = texto(contrato && contrato.tipo, "EDICION");
    $("inp-contrato-editorial-territorio").value = texto(contrato && contrato.territorio, "México");
    $("inp-contrato-editorial-idioma").value = texto(contrato && contrato.idioma_derechos, "Todos");
    $("chk-contrato-editorial-exclusividad").checked = Boolean(contrato && contrato.exclusividad);
    $("inp-contrato-editorial-desde").value = fechaParaInput(contrato && contrato.vigente_desde)
      || new Date().toISOString().slice(0, 10);
    $("inp-contrato-editorial-hasta").value = fechaParaInput(contrato && contrato.vigente_hasta);
    $("sel-contrato-editorial-base").value = texto(contrato && contrato.base_regalia, "VENTA_NETA");
    $("inp-contrato-editorial-porcentaje").value = texto(contrato && contrato.porcentaje_regalia);
    $("inp-contrato-editorial-anticipo").value = texto(contrato && contrato.anticipo, "0");
    $("inp-contrato-editorial-moneda").value = texto(contrato && contrato.moneda, "MXN");
    $("sel-contrato-editorial-periodicidad").value = texto(
      contrato && contrato.periodicidad_liquidacion,
      "SEMESTRAL"
    );
    $("inp-contrato-editorial-derechos").value = texto(contrato && contrato.derechos);
    $("inp-contrato-editorial-notas").value = texto(contrato && contrato.notas);
    $("contrato-editorial-error").textContent = "";
    await cargarColaboradoresContratoPorObra(
      obraId,
      contrato && contrato.colaborador_editorial_id
    );
    $("sel-contrato-editorial-colaborador").disabled = edicion;
    abrirModal("modal-contrato-editorial");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("sel-contrato-editorial-obra").addEventListener("change", (evento) => {
  void cargarColaboradoresContratoPorObra(numero(evento.currentTarget.value, 0));
});
$("btn-nuevo-contrato-editorial").addEventListener("click", () =>
  void abrirFormularioContratoEditorial(null, obraEditorialActiva && obraEditorialActiva.id)
);

$("form-contrato-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esAdmin() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const id = numero($("inp-contrato-editorial-id").value, 0);
  const obraId = numero($("sel-contrato-editorial-obra").value, 0);
  const colaboradorId = numero($("sel-contrato-editorial-colaborador").value, 0);
  const porcentaje = Number($("inp-contrato-editorial-porcentaje").value);
  const anticipo = Number($("inp-contrato-editorial-anticipo").value);
  const desde = $("inp-contrato-editorial-desde").value;
  const hasta = $("inp-contrato-editorial-hasta").value;
  const derechos = $("inp-contrato-editorial-derechos").value.trim();
  if (!obraId || !colaboradorId || !Number.isFinite(porcentaje) || porcentaje < 0
    || porcentaje > 100 || !Number.isFinite(anticipo) || anticipo < 0
    || derechos.length < 3 || (hasta && hasta < desde)) {
    $("contrato-editorial-error").textContent = "Revisa obra, colaborador, derechos, fechas e importes.";
    return;
  }
  const body = {
    tipo: $("sel-contrato-editorial-tipo").value,
    derechos,
    territorio: $("inp-contrato-editorial-territorio").value.trim(),
    idioma_derechos: $("inp-contrato-editorial-idioma").value.trim(),
    exclusividad: $("chk-contrato-editorial-exclusividad").checked,
    vigente_desde: desde,
    vigente_hasta: hasta || null,
    base_regalia: $("sel-contrato-editorial-base").value,
    porcentaje_regalia: porcentaje,
    anticipo,
    moneda: $("inp-contrato-editorial-moneda").value.trim().toUpperCase(),
    periodicidad_liquidacion: $("sel-contrato-editorial-periodicidad").value,
    notas: opcionalEditorial($("inp-contrato-editorial-notas").value),
  };
  if (!id) {
    body.obra_editorial_id = obraId;
    body.colaborador_editorial_id = colaboradorId;
  }
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-guardar-contrato-editorial"), "Guardando…", async () => {
    try {
      contratoEditorialActivo = id
        ? await api("/editorial/contratos/" + encodeURIComponent(id), { method: "PATCH", body })
        : await postEditorialIdempotente(
          "ALTA_CONTRATO_EDITORIAL",
          "/editorial/contratos",
          body
        );
      cerrarModal($("modal-contrato-editorial"), true);
      await cargarContratosEditoriales({ reiniciar: !id });
      pintarContratoEditorialActivo();
      abrirModal("modal-contrato-editorial-detalle");
      if (obraEditorialActiva && numero(obraEditorialActiva.id) === numero(obraId)) {
        obraEditorialActiva = await api("/editorial/obras/" + encodeURIComponent(obraId));
        pintarObraEditorialActiva();
      }
      toast(id ? "Contrato actualizado." : "Contrato editorial creado.", "ok");
    } catch (error) {
      $("contrato-editorial-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function abrirContratoEditorial(id) {
  if (!esSupervisor()) return;
  try {
    contratoEditorialActivo = await api("/editorial/contratos/" + encodeURIComponent(id));
    pintarContratoEditorialActivo();
    abrirModal("modal-contrato-editorial-detalle");
  } catch (error) {
    toast(error.message, "err");
  }
}

function pintarContratoEditorialActivo() {
  const contrato = contratoEditorialActivo;
  if (!contrato) return;
  $("contrato-editorial-detalle-titulo").textContent = "Contrato " + texto(contrato.folio);
  pintarResumenEditorial($("contrato-editorial-resumen"), [
    ["Estado", rotuloEditorial(contrato.estado)],
    ["Obra", contrato.obra_titulo || contrato.obra_titulo_actual],
    ["Colaborador", contrato.colaborador_nombre || contrato.colaborador_nombre_actual],
    ["Tipo", rotuloEditorial(contrato.tipo)],
    ["Regalía", numero(contrato.porcentaje_regalia).toFixed(4).replace(/\.?0+$/, "") + "% sobre " + rotuloEditorial(contrato.base_regalia)],
    ["Anticipo", fmt(contrato.anticipo) + " " + texto(contrato.moneda)],
    ["Vigencia", fechaEditorial(contrato.vigente_desde) + " – " + fechaEditorial(contrato.vigente_hasta)],
    ["Liquidación", rotuloEditorial(contrato.periodicidad_liquidacion)],
    ["Territorio", contrato.territorio],
    ["Exclusividad", contrato.exclusividad ? "Sí" : "No"],
  ]);
  $("contrato-editorial-derechos").textContent = texto(contrato.derechos);
  $("contrato-editorial-detalle-error").textContent = "";
  $("btn-editar-contrato-editorial").classList.toggle(
    "hidden",
    !esAdmin() || contrato.estado !== "BORRADOR"
  );
  $("btn-transicionar-contrato-editorial").classList.toggle(
    "hidden",
    !esAdmin() || !(TRANSICIONES_CONTRATO_EDITORIAL[contrato.estado] || []).length
  );
  pintarTransicionesEditoriales(
    $("contrato-editorial-transiciones-body"),
    contrato.transiciones
  );
}

$("btn-editar-contrato-editorial").addEventListener("click", () => {
  if (!contratoEditorialActivo || !esAdmin() || contratoEditorialActivo.estado !== "BORRADOR") return;
  cerrarModal($("modal-contrato-editorial-detalle"), true);
  void abrirFormularioContratoEditorial(contratoEditorialActivo);
});

$("btn-transicionar-contrato-editorial").addEventListener("click", () => {
  if (!contratoEditorialActivo || !esAdmin()) return;
  const id = contratoEditorialActivo.id;
  abrirAccionEditorial({
    titulo: "Cambiar estado de " + texto(contratoEditorialActivo.folio),
    estados: TRANSICIONES_CONTRATO_EDITORIAL[contratoEditorialActivo.estado] || [],
    ejecutar: async ({ estado, motivo }) => {
      contratoEditorialActivo = await postEditorialIdempotente(
        "TRANSICION_CONTRATO_" + id,
        "/editorial/contratos/" + encodeURIComponent(id) + "/transiciones",
        { estado, motivo }
      );
      pintarContratoEditorialActivo();
      await cargarContratosEditoriales();
      if (obraEditorialActiva
        && numero(obraEditorialActiva.id) === numero(contratoEditorialActivo.obra_editorial_id)) {
        obraEditorialActiva = await api(
          "/editorial/obras/" + encodeURIComponent(obraEditorialActiva.id)
        );
        pintarObraEditorialActiva();
      }
      toast("Estado del contrato actualizado.", "ok");
    },
  });
});

/* Tirajes y costos de producción */
function actualizarSelectoresProveedoresTiraje() {
  const activos = proveedoresOpcionesCompra
    .filter((proveedor) => proveedor.activo !== false)
    .sort((a, b) => texto(a.nombre).localeCompare(texto(b.nombre), "es"));
  for (const id of ["sel-tiraje-costo-inicial-proveedor", "sel-costo-tiraje-editorial-proveedor"]) {
    reponerOpciones($(id), "Sin proveedor", activos, (proveedor) => texto(proveedor.nombre));
  }
}

async function prepararOpcionesTiraje() {
  const tareas = [];
  if (!obrasEditorialesOpciones.length) tareas.push(cargarOpcionesObrasEditoriales());
  if (!proveedoresOpcionesCompra.length) tareas.push(cargarOpcionesProveedoresCompra());
  await Promise.all(tareas);
  actualizarSelectoresProveedoresTiraje();
}

async function cargarEdicionesTirajePorObra(obraId, seleccionada = null) {
  const select = $("sel-tiraje-editorial-producto");
  select.disabled = true;
  select.replaceChildren(opcion("", obraId ? "Cargando ediciones…" : "Selecciona primero una obra"));
  if (!obraId) return;
  try {
    const obra = obraEditorialActiva && numero(obraEditorialActiva.id) === numero(obraId)
      ? obraEditorialActiva
      : await api("/editorial/obras/" + encodeURIComponent(obraId));
    select.replaceChildren(opcion("", "Selecciona una edición"));
    for (const producto of (obra.ediciones || []).filter((item) => item.activo !== false)) {
      select.appendChild(opcion(
        producto.id,
        texto(producto.sku) + " · " + texto(producto.titulo)
          + (producto.isbn ? " · ISBN " + texto(producto.isbn) : "")
      ));
    }
    if (seleccionada && Array.from(select.options).some((item) => item.value === texto(seleccionada))) {
      select.value = texto(seleccionada);
    }
  } catch (error) {
    select.replaceChildren(opcion("", "No fue posible cargar las ediciones"));
    $("tiraje-editorial-error").textContent = error.message;
  } finally {
    select.disabled = Boolean($("inp-tiraje-editorial-id").value);
  }
}

async function cargarTirajesEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || tirajesEditorialesCargaEnCurso) return;
  if (reiniciar) tirajesEditorialesPagina = 1;
  tirajesEditorialesCargaEnCurso = true;
  filaVacia($("editorial-tirajes-body"), 9, "Cargando tirajes…");
  actualizarPaginacionEditorial("tirajes");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-tiraje-q").value.trim(),
      page: texto(tirajesEditorialesPagina),
      limit: "30",
    });
    if ($("sel-editorial-tiraje-estado").value) {
      parametros.set("estado", $("sel-editorial-tiraje-estado").value);
    }
    const respuesta = await api("/editorial/tirajes?" + parametros.toString());
    tirajesEditoriales = extraerLista(respuesta, "tirajes");
    tirajesEditorialesHaySiguiente = tirajesEditoriales.length === 30;
    pintarTirajesEditoriales();
  } catch (error) {
    filaVacia($("editorial-tirajes-body"), 9, error.message);
  } finally {
    tirajesEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("tirajes");
  }
}

function pintarTirajesEditoriales() {
  const tbody = $("editorial-tirajes-body");
  tbody.replaceChildren();
  for (const tiraje of tirajesEditoriales) {
    const obra = document.createElement("td");
    obra.append(nodo("strong", "", tiraje.obra_titulo));
    obra.append(nodo("small", "tabla-detalle", tiraje.obra_folio));
    const producto = document.createElement("td");
    producto.append(nodo("strong", "", tiraje.producto_titulo));
    producto.append(nodo("small", "tabla-detalle", tiraje.producto_sku));
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(tiraje.estado));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirTirajeEditorial(tiraje.id));
    acciones.appendChild(boton);
    const cantidad = numero(tiraje.cantidad);
    const total = numero(tiraje.costo_capturado);
    const tr = document.createElement("tr");
    tr.append(
      celda(tiraje.folio),
      celda(fechaEditorial(tiraje.fecha_programada)),
      obra,
      producto,
      celda(cantidad),
      celda(fmt(total) + " " + texto(tiraje.moneda)),
      celda(cantidad ? fmt(total / cantidad) : fmt(0)),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!tirajesEditoriales.length) filaVacia(tbody, 9, "No hay tirajes para este filtro.");
}

$("form-editorial-tirajes-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarTirajesEditoriales({ reiniciar: true });
});
$("btn-refrescar-tirajes-editoriales").addEventListener("click", () =>
  void cargarTirajesEditoriales()
);
$("sel-tiraje-editorial-obra").addEventListener("change", (evento) => {
  void cargarEdicionesTirajePorObra(numero(evento.currentTarget.value, 0));
});

async function abrirFormularioTirajeEditorial(tiraje = null) {
  if (!esSupervisor() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  try {
    await prepararOpcionesTiraje();
    tirajeEditorialActivo = tiraje || null;
    const edicion = Boolean(tiraje);
    $("tiraje-editorial-modal-titulo").textContent = edicion ? "Editar tiraje" : "Nuevo tiraje";
    $("btn-guardar-tiraje-editorial").textContent = edicion ? "Guardar cambios" : "Guardar tiraje";
    $("inp-tiraje-editorial-id").value = texto(tiraje && tiraje.id);
    $("sel-tiraje-editorial-obra").value = texto(tiraje && tiraje.obra_editorial_id);
    $("sel-tiraje-editorial-obra").disabled = edicion;
    $("inp-tiraje-editorial-cantidad").value = texto(tiraje && tiraje.cantidad);
    $("inp-tiraje-editorial-fecha").value = fechaParaInput(tiraje && tiraje.fecha_programada)
      || new Date().toISOString().slice(0, 10);
    $("inp-tiraje-editorial-moneda").value = texto(tiraje && tiraje.moneda, "MXN");
    $("inp-tiraje-editorial-notas").value = texto(tiraje && tiraje.notas);
    $("tiraje-editorial-costo-inicial").classList.toggle("hidden", edicion);
    $("inp-tiraje-costo-inicial-concepto").required = !edicion;
    $("inp-tiraje-costo-inicial-monto").required = !edicion;
    $("sel-tiraje-costo-inicial-tipo").value = "IMPRESION";
    $("inp-tiraje-costo-inicial-concepto").value = "";
    $("sel-tiraje-costo-inicial-proveedor").value = "";
    $("inp-tiraje-costo-inicial-referencia").value = "";
    $("inp-tiraje-costo-inicial-monto").value = "";
    $("tiraje-editorial-error").textContent = "";
    await cargarEdicionesTirajePorObra(
      tiraje && tiraje.obra_editorial_id,
      tiraje && tiraje.producto_id
    );
    $("sel-tiraje-editorial-producto").disabled = edicion;
    abrirModal("modal-tiraje-editorial");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-nuevo-tiraje-editorial").addEventListener("click", () =>
  void abrirFormularioTirajeEditorial()
);

function leerCostoTiraje({ inicial = false } = {}) {
  const prefijo = inicial ? "tiraje-costo-inicial" : "costo-tiraje-editorial";
  const tipo = $("sel-" + prefijo + "-tipo").value;
  const concepto = $("inp-" + prefijo + "-concepto").value.trim();
  const proveedorId = numero($("sel-" + prefijo + "-proveedor").value, 0);
  const referencia = $("inp-" + prefijo + "-referencia").value.trim();
  const monto = Number($("inp-" + prefijo + "-monto").value);
  if (concepto.length < 2 || !Number.isFinite(monto) || monto <= 0) {
    throw new Error("Cada costo necesita un concepto y un monto mayor que cero.");
  }
  return {
    tipo,
    concepto,
    proveedor_id: proveedorId || null,
    referencia: referencia || null,
    monto,
  };
}

$("form-tiraje-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const id = numero($("inp-tiraje-editorial-id").value, 0);
  const obraId = numero($("sel-tiraje-editorial-obra").value, 0);
  const productoId = numero($("sel-tiraje-editorial-producto").value, 0);
  const cantidad = Number($("inp-tiraje-editorial-cantidad").value);
  if (!obraId || !productoId || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 1000000) {
    $("tiraje-editorial-error").textContent = "Selecciona obra y edición, y revisa la cantidad.";
    return;
  }
  const body = {
    cantidad,
    fecha_programada: $("inp-tiraje-editorial-fecha").value,
    moneda: $("inp-tiraje-editorial-moneda").value.trim().toUpperCase(),
    notas: opcionalEditorial($("inp-tiraje-editorial-notas").value),
  };
  try {
    if (!id) {
      body.obra_editorial_id = obraId;
      body.producto_id = productoId;
      body.costos = [leerCostoTiraje({ inicial: true })];
    }
  } catch (error) {
    $("tiraje-editorial-error").textContent = error.message;
    return;
  }
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-guardar-tiraje-editorial"), "Guardando…", async () => {
    try {
      tirajeEditorialActivo = id
        ? await api("/editorial/tirajes/" + encodeURIComponent(id), { method: "PATCH", body })
        : await postEditorialIdempotente("ALTA_TIRAJE_EDITORIAL", "/editorial/tirajes", body);
      cerrarModal($("modal-tiraje-editorial"), true);
      await cargarTirajesEditoriales({ reiniciar: !id });
      pintarTirajeEditorialActivo();
      abrirModal("modal-tiraje-editorial-detalle");
      toast(id ? "Tiraje actualizado." : "Tiraje editorial creado.", "ok");
    } catch (error) {
      $("tiraje-editorial-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function abrirTirajeEditorial(id) {
  if (!esSupervisor()) return;
  try {
    await prepararOpcionesTiraje();
    tirajeEditorialActivo = await api("/editorial/tirajes/" + encodeURIComponent(id));
    pintarTirajeEditorialActivo();
    abrirModal("modal-tiraje-editorial-detalle");
  } catch (error) {
    toast(error.message, "err");
  }
}

function limpiarFormularioCostoTiraje() {
  $("inp-costo-tiraje-editorial-id").value = "";
  $("sel-costo-tiraje-editorial-tipo").value = "IMPRESION";
  $("inp-costo-tiraje-editorial-concepto").value = "";
  $("sel-costo-tiraje-editorial-proveedor").value = "";
  $("inp-costo-tiraje-editorial-referencia").value = "";
  $("inp-costo-tiraje-editorial-monto").value = "";
  $("btn-guardar-costo-tiraje-editorial").textContent = "Agregar costo";
  $("btn-cancelar-edicion-costo-tiraje").classList.add("hidden");
}

function pintarTirajeEditorialActivo() {
  const tiraje = tirajeEditorialActivo;
  if (!tiraje) return;
  $("tiraje-editorial-detalle-titulo").textContent = "Tiraje " + texto(tiraje.folio);
  pintarResumenEditorial($("tiraje-editorial-resumen"), [
    ["Estado", rotuloEditorial(tiraje.estado)],
    ["Obra", tiraje.obra_titulo],
    ["Edición", texto(tiraje.producto_sku) + " · " + texto(tiraje.producto_titulo)],
    ["Programado", fechaEditorial(tiraje.fecha_programada)],
    ["Ejemplares", numero(tiraje.cantidad)],
    ["Costo total", fmt(tiraje.costo_capturado) + " " + texto(tiraje.moneda)],
    ["Costo unitario", fmt(tiraje.costo_unitario_estimado)],
    ["Existencia actual", numero(tiraje.stock_actual)],
  ]);
  $("tiraje-editorial-aviso").textContent = tiraje.estado === "CONFIRMADO"
    ? "Este tiraje ya ingresó " + numero(tiraje.cantidad) + " ejemplares al inventario."
    : tiraje.estado === "CANCELADO"
      ? "El tiraje fue cancelado sin modificar el inventario."
      : "Al confirmar se ingresarán los ejemplares y se aplicará el costo unitario calculado.";
  const borrador = tiraje.estado === "BORRADOR";
  $("btn-editar-tiraje-editorial").classList.toggle("hidden", !borrador);
  $("btn-confirmar-tiraje-editorial").classList.toggle("hidden", !borrador);
  $("btn-cancelar-tiraje-editorial").classList.toggle("hidden", !borrador);
  $("tiraje-editorial-costos-bloque").querySelector("form").classList.toggle("hidden", !borrador);
  $("tiraje-editorial-detalle-error").textContent = "";
  limpiarFormularioCostoTiraje();

  const tbody = $("tiraje-editorial-costos-body");
  tbody.replaceChildren();
  for (const costo of tiraje.costos || []) {
    const acciones = document.createElement("td");
    if (borrador) {
      const editar = nodo("button", "btn btn-outline", "Editar");
      editar.type = "button";
      editar.addEventListener("click", () => editarCostoTiraje(costo));
      const quitar = nodo("button", "btn btn-danger", "Quitar");
      quitar.type = "button";
      quitar.addEventListener("click", () => void eliminarCostoTiraje(costo, quitar));
      acciones.append(editar, quitar);
    }
    const tr = document.createElement("tr");
    tr.append(
      celda(rotuloEditorial(costo.tipo)),
      celda(costo.concepto),
      celda(costo.proveedor_nombre || "—"),
      celda(costo.referencia || "—"),
      celda(fmt(costo.monto)),
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!(tiraje.costos || []).length) filaVacia(tbody, 6, "No hay costos capturados.");
  pintarTransicionesEditoriales(
    $("tiraje-editorial-transiciones-body"),
    tiraje.transiciones
  );
}

function editarCostoTiraje(costo) {
  $("inp-costo-tiraje-editorial-id").value = texto(costo.id);
  $("sel-costo-tiraje-editorial-tipo").value = costo.tipo;
  $("inp-costo-tiraje-editorial-concepto").value = texto(costo.concepto);
  $("sel-costo-tiraje-editorial-proveedor").value = texto(costo.proveedor_id);
  $("inp-costo-tiraje-editorial-referencia").value = texto(costo.referencia);
  $("inp-costo-tiraje-editorial-monto").value = texto(costo.monto);
  $("btn-guardar-costo-tiraje-editorial").textContent = "Guardar costo";
  $("btn-cancelar-edicion-costo-tiraje").classList.remove("hidden");
}

$("btn-cancelar-edicion-costo-tiraje").addEventListener("click", limpiarFormularioCostoTiraje);

$("form-costo-tiraje-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!tirajeEditorialActivo || tirajeEditorialActivo.estado !== "BORRADOR"
    || editorialOperacionEnCurso) return;
  let body;
  try {
    body = leerCostoTiraje();
  } catch (error) {
    $("tiraje-editorial-detalle-error").textContent = error.message;
    return;
  }
  const costoId = numero($("inp-costo-tiraje-editorial-id").value, 0);
  const tirajeId = tirajeEditorialActivo.id;
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-guardar-costo-tiraje-editorial"), "Guardando…", async () => {
    try {
      tirajeEditorialActivo = costoId
        ? await api(
          "/editorial/tirajes/" + encodeURIComponent(tirajeId)
            + "/costos/" + encodeURIComponent(costoId),
          { method: "PATCH", body }
        )
        : await postEditorialIdempotente(
          "COSTO_TIRAJE_" + tirajeId,
          "/editorial/tirajes/" + encodeURIComponent(tirajeId) + "/costos",
          body
        );
      pintarTirajeEditorialActivo();
      await cargarTirajesEditoriales();
      toast(costoId ? "Costo actualizado." : "Costo agregado.", "ok");
    } catch (error) {
      $("tiraje-editorial-detalle-error").textContent = error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function eliminarCostoTiraje(costo, boton) {
  if (!tirajeEditorialActivo || tirajeEditorialActivo.estado !== "BORRADOR"
    || editorialOperacionEnCurso) return;
  if (!confirm("¿Quitar este costo del tiraje?")) return;
  const tirajeId = tirajeEditorialActivo.id;
  editorialOperacionEnCurso = true;
  await conBotonOcupado(boton, "Quitando…", async () => {
    try {
      tirajeEditorialActivo = await api(
        "/editorial/tirajes/" + encodeURIComponent(tirajeId)
          + "/costos/" + encodeURIComponent(costo.id),
        { method: "DELETE" }
      );
      pintarTirajeEditorialActivo();
      await cargarTirajesEditoriales();
      toast("Costo retirado.", "ok");
    } catch (error) {
      $("tiraje-editorial-detalle-error").textContent = error.message;
    }
  });
  editorialOperacionEnCurso = false;
}

$("btn-editar-tiraje-editorial").addEventListener("click", () => {
  if (!tirajeEditorialActivo || tirajeEditorialActivo.estado !== "BORRADOR") return;
  cerrarModal($("modal-tiraje-editorial-detalle"), true);
  void abrirFormularioTirajeEditorial(tirajeEditorialActivo);
});

$("btn-confirmar-tiraje-editorial").addEventListener("click", () => {
  if (!tirajeEditorialActivo || tirajeEditorialActivo.estado !== "BORRADOR") return;
  const id = tirajeEditorialActivo.id;
  abrirAccionEditorial({
    titulo: "Confirmar " + texto(tirajeEditorialActivo.folio),
    ayuda: "Esta operación ingresará los ejemplares al inventario y ya no podrá revertirse desde el tiraje.",
    textoBoton: "Confirmar e ingresar",
    ejecutar: async ({ motivo }) => {
      tirajeEditorialActivo = await postEditorialIdempotente(
        "CONFIRMACION_TIRAJE_" + id,
        "/editorial/tirajes/" + encodeURIComponent(id) + "/confirmacion",
        { motivo }
      );
      pintarTirajeEditorialActivo();
      productosCatalogoOpciones = [];
      await cargarTirajesEditoriales();
      toast("Tiraje confirmado e inventario actualizado.", "ok");
    },
  });
});

$("btn-cancelar-tiraje-editorial").addEventListener("click", () => {
  if (!tirajeEditorialActivo || tirajeEditorialActivo.estado !== "BORRADOR") return;
  const id = tirajeEditorialActivo.id;
  abrirAccionEditorial({
    titulo: "Cancelar " + texto(tirajeEditorialActivo.folio),
    ayuda: "La cancelación de un borrador no modifica el inventario.",
    textoBoton: "Cancelar tiraje",
    ejecutar: async ({ motivo }) => {
      tirajeEditorialActivo = await postEditorialIdempotente(
        "CANCELACION_TIRAJE_" + id,
        "/editorial/tirajes/" + encodeURIComponent(id) + "/cancelacion",
        { motivo }
      );
      pintarTirajeEditorialActivo();
      await cargarTirajesEditoriales();
      toast("Tiraje cancelado.", "ok");
    },
  });
});

/* Regalías y liquidaciones */
async function cargarOpcionesContratosRegalia() {
  contratosEditorialesOpciones = await obtenerOpcionesEditoriales(
    "/editorial/contratos",
    "contratos"
  );
  reponerOpciones(
    $("sel-liquidacion-regalia-contrato"),
    "Selecciona un contrato",
    contratosEditorialesOpciones.filter((contrato) => contrato.estado !== "BORRADOR"),
    (contrato) => texto(contrato.folio) + " · " + texto(contrato.colaborador_nombre)
      + " · " + texto(contrato.obra_titulo)
  );
}

async function cargarRegaliasEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || regaliasEditorialesCargaEnCurso) return;
  if (reiniciar) regaliasEditorialesPagina = 1;
  regaliasEditorialesCargaEnCurso = true;
  filaVacia($("editorial-regalias-body"), 9, "Cargando liquidaciones…");
  filaVacia($("editorial-regalias-estado-cuenta-body"), 7, "Cargando estado de cuenta…");
  actualizarPaginacionEditorial("regalias");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-regalia-q").value.trim(),
      page: texto(regaliasEditorialesPagina),
      limit: "30",
    });
    if ($("sel-editorial-regalia-estado").value) {
      parametros.set("estado", $("sel-editorial-regalia-estado").value);
    }
    const [lista, cuenta] = await Promise.all([
      api("/editorial/regalias/liquidaciones?" + parametros.toString()),
      api("/editorial/regalias/estado-cuenta"),
    ]);
    liquidacionesRegalias = extraerLista(lista, "liquidaciones");
    estadosCuentaRegalias = extraerLista(cuenta, "estados_cuenta");
    regaliasEditorialesHaySiguiente = liquidacionesRegalias.length === 30;
    pintarRegaliasEditoriales();
    pintarEstadosCuentaRegalias();
  } catch (error) {
    filaVacia($("editorial-regalias-body"), 9, error.message);
    filaVacia($("editorial-regalias-estado-cuenta-body"), 7, error.message);
  } finally {
    regaliasEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("regalias");
  }
}

function pintarEstadosCuentaRegalias() {
  const tbody = $("editorial-regalias-estado-cuenta-body");
  tbody.replaceChildren();
  for (const cuenta of estadosCuentaRegalias) {
    const contrato = document.createElement("td");
    contrato.append(nodo("strong", "", cuenta.contrato_folio));
    contrato.append(nodo("small", "tabla-detalle", rotuloEditorial(cuenta.contrato_estado)));
    const tr = document.createElement("tr");
    tr.append(
      contrato,
      celda(cuenta.colaborador_nombre),
      celda(cuenta.obra_titulo),
      celda(fmt(cuenta.anticipo_pendiente) + " " + texto(cuenta.moneda)),
      celda(fmt(cuenta.importe_pendiente) + " " + texto(cuenta.moneda)),
      celda(fmt(cuenta.importe_pagado) + " " + texto(cuenta.moneda)),
      celda(fmt(cuenta.saldo_a_favor_editorial) + " " + texto(cuenta.moneda))
    );
    tbody.appendChild(tr);
  }
  if (!estadosCuentaRegalias.length) filaVacia(tbody, 7, "No hay contratos con estado de cuenta.");
}

function pintarRegaliasEditoriales() {
  const tbody = $("editorial-regalias-body");
  tbody.replaceChildren();
  for (const liquidacion of liquidacionesRegalias) {
    const periodo = fechaEditorial(liquidacion.periodo_desde) + " – "
      + fechaEditorial(liquidacion.periodo_hasta) + " (fin exclusivo)";
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(liquidacion.estado));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirLiquidacionRegalia(liquidacion.id));
    acciones.appendChild(boton);
    const tr = document.createElement("tr");
    tr.append(
      celda(liquidacion.folio),
      celda(periodo),
      celda(liquidacion.contrato_folio),
      celda(liquidacion.colaborador_nombre),
      celda(numero(liquidacion.unidades_netas)),
      celda(fmt(liquidacion.regalia_bruta) + " " + texto(liquidacion.moneda)),
      celda(fmt(liquidacion.importe_pagable) + " " + texto(liquidacion.moneda)),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!liquidacionesRegalias.length) filaVacia(tbody, 9, "No hay liquidaciones para este filtro.");
}

$("form-editorial-regalias-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarRegaliasEditoriales({ reiniciar: true });
});
$("btn-refrescar-regalias-editoriales").addEventListener("click", () =>
  void cargarRegaliasEditoriales()
);

function fechaLocalIso(fecha) {
  const year = fecha.getFullYear();
  const month = texto(fecha.getMonth() + 1).padStart(2, "0");
  const day = texto(fecha.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function abrirAltaLiquidacionRegalia() {
  if (!esAdmin() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  try {
    await cargarOpcionesContratosRegalia();
    const hoy = new Date();
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    $("sel-liquidacion-regalia-contrato").value = "";
    $("inp-liquidacion-regalia-desde").value = fechaLocalIso(inicio);
    $("inp-liquidacion-regalia-hasta").value = fechaLocalIso(fin);
    $("inp-liquidacion-regalia-zona").value = "America/Mexico_City";
    $("inp-liquidacion-regalia-notas").value = "";
    $("liquidacion-regalia-error").textContent = "";
    abrirModal("modal-liquidacion-regalia");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-nueva-liquidacion-regalia").addEventListener("click", () =>
  void abrirAltaLiquidacionRegalia()
);

$("form-liquidacion-regalia").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esAdmin() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const contratoId = numero($("sel-liquidacion-regalia-contrato").value, 0);
  const desde = $("inp-liquidacion-regalia-desde").value;
  const hasta = $("inp-liquidacion-regalia-hasta").value;
  if (!contratoId || !desde || !hasta || hasta <= desde) {
    $("liquidacion-regalia-error").textContent = "Selecciona un contrato y un periodo válido.";
    return;
  }
  const body = {
    contrato_editorial_id: contratoId,
    periodo_desde: desde,
    periodo_hasta: hasta,
    zona_horaria: $("inp-liquidacion-regalia-zona").value.trim(),
    notas: opcionalEditorial($("inp-liquidacion-regalia-notas").value),
  };
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-generar-liquidacion-regalia"), "Generando…", async () => {
    try {
      liquidacionRegaliaActiva = await postEditorialIdempotente(
        "ALTA_LIQUIDACION_REGALIA",
        "/editorial/regalias/liquidaciones",
        body
      );
      cerrarModal($("modal-liquidacion-regalia"), true);
      await cargarRegaliasEditoriales({ reiniciar: true });
      pintarLiquidacionRegaliaActiva();
      abrirModal("modal-liquidacion-regalia-detalle");
      toast("Liquidación de regalías generada.", "ok");
    } catch (error) {
      $("liquidacion-regalia-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function abrirLiquidacionRegalia(id) {
  if (!esSupervisor()) return;
  try {
    liquidacionRegaliaActiva = await api(
      "/editorial/regalias/liquidaciones/" + encodeURIComponent(id)
    );
    pintarLiquidacionRegaliaActiva();
    abrirModal("modal-liquidacion-regalia-detalle");
  } catch (error) {
    toast(error.message, "err");
  }
}

function pintarLiquidacionRegaliaActiva() {
  const liquidacion = liquidacionRegaliaActiva;
  if (!liquidacion) return;
  $("liquidacion-regalia-detalle-titulo").textContent = "Regalías " + texto(liquidacion.folio);
  pintarResumenEditorial($("liquidacion-regalia-resumen"), [
    ["Estado", rotuloEditorial(liquidacion.estado)],
    ["Contrato", liquidacion.contrato_folio],
    ["Obra", liquidacion.obra_titulo],
    ["Colaborador", liquidacion.colaborador_nombre],
    ["Periodo", fechaEditorial(liquidacion.periodo_desde) + " – " + fechaEditorial(liquidacion.periodo_hasta)],
    ["Unidades netas", numero(liquidacion.unidades_netas)],
    ["Base", fmt(liquidacion.base_regalia_total)],
    ["Regalía bruta", fmt(liquidacion.regalia_bruta)],
    ["Anticipo aplicado", fmt(liquidacion.anticipo_aplicado)],
    ["Saldo editorial aplicado", fmt(liquidacion.saldo_editorial_aplicado)],
    ["Importe pagable", fmt(liquidacion.importe_pagable) + " " + texto(liquidacion.moneda)],
    ["Versión", numero(liquidacion.version)],
  ]);
  $("liquidacion-regalia-notas").textContent = texto(liquidacion.notas);
  $("liquidacion-regalia-notas").classList.toggle("hidden", !liquidacion.notas);
  $("liquidacion-regalia-detalle-error").textContent = "";
  const transiciones = TRANSICIONES_LIQUIDACION_REGALIA[liquidacion.estado] || [];
  $("btn-transicionar-liquidacion-regalia").classList.toggle(
    "hidden",
    !esAdmin() || !transiciones.length
  );
  const tbody = $("liquidacion-regalia-detalle-body");
  tbody.replaceChildren();
  for (const linea of liquidacion.detalle || []) {
    const producto = document.createElement("td");
    producto.append(nodo("strong", "", linea.producto_titulo));
    producto.append(nodo("small", "tabla-detalle", linea.producto_sku));
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(linea.fecha_evento)),
      celda(texto(linea.canal) + " · " + rotuloEditorial(linea.tipo_evento)),
      celda(linea.evento_clave),
      producto,
      celda(numero(linea.cantidad_neta)),
      celda(fmt(linea.base_regalia)),
      celda(numero(linea.porcentaje_regalia).toFixed(4).replace(/\.?0+$/, "") + "%"),
      celda(fmt(linea.importe_regalia))
    );
    tbody.appendChild(tr);
  }
  if (!(liquidacion.detalle || []).length) {
    filaVacia(tbody, 8, "No hubo ventas aplicables en el periodo.");
  }
  pintarTransicionesEditoriales(
    $("liquidacion-regalia-transiciones-body"),
    liquidacion.transiciones
  );
}

$("btn-transicionar-liquidacion-regalia").addEventListener("click", () => {
  if (!liquidacionRegaliaActiva || !esAdmin()) return;
  const id = liquidacionRegaliaActiva.id;
  abrirAccionEditorial({
    titulo: "Cambiar estado de " + texto(liquidacionRegaliaActiva.folio),
    estados: TRANSICIONES_LIQUIDACION_REGALIA[liquidacionRegaliaActiva.estado] || [],
    referencia: true,
    ayuda: "La referencia sólo es obligatoria al marcar la liquidación como pagada.",
    ejecutar: async ({ estado, motivo, referencia }) => {
      if (estado === "PAGADA" && !referencia) {
        throw new Error("La referencia de pago es obligatoria.");
      }
      liquidacionRegaliaActiva = await postEditorialIdempotente(
        "TRANSICION_REGALIA_" + id,
        "/editorial/regalias/liquidaciones/" + encodeURIComponent(id) + "/transiciones",
        {
          estado,
          motivo,
          referencia: estado === "PAGADA" ? referencia : null,
        }
      );
      pintarLiquidacionRegaliaActiva();
      await cargarRegaliasEditoriales();
      toast("Estado de la liquidación actualizado.", "ok");
    },
  });
});

/* Consignaciones y distribución editorial */
function actualizarSelectorClientesConsignacion() {
  const select = $("sel-consignacion-editorial-cliente");
  if (!select) return;
  const elegibles = clientesOpciones.filter((cliente) =>
    cliente.activo !== false
    && cliente.segmento_precio === "MAYOREO"
    && ["LIBRERIA", "DISTRIBUIDOR", "INSTITUCION"].includes(cliente.tipo_comercial)
  );
  reponerOpciones(
    select,
    "Selecciona una librería, distribuidor o institución",
    elegibles,
    (cliente) => texto(cliente.nombre) + " · " + rotuloTipoComercial(cliente.tipo_comercial)
  );
}

function actualizarSelectorProductosConsignacion() {
  reponerOpciones(
    $("sel-consignacion-editorial-producto"),
    "Selecciona un producto",
    productosCatalogoOpciones.filter((producto) => producto.activo !== false),
    (producto) => texto(producto.sku) + " · " + texto(producto.titulo)
      + " · disponibles " + numero(producto.stock_disponible)
  );
}

async function prepararOpcionesConsignacion() {
  const tareas = [];
  if (!clientesOpciones.length) tareas.push(cargarOpcionesClientes());
  if (!productosCatalogoOpciones.length) tareas.push(cargarProductosCatalogoOpciones());
  await Promise.all(tareas);
  actualizarSelectorClientesConsignacion();
  actualizarSelectorProductosConsignacion();
}

$("sel-cliente-tipo").addEventListener("change", (evento) => {
  if (evento.currentTarget.value !== "CONSUMIDOR") $("sel-cliente-segmento").value = "MAYOREO";
});

async function cargarConsignacionesEditoriales({ reiniciar = false } = {}) {
  if (!esSupervisor() || consignacionesEditorialesCargaEnCurso) return;
  if (reiniciar) consignacionesEditorialesPagina = 1;
  consignacionesEditorialesCargaEnCurso = true;
  filaVacia($("editorial-consignaciones-body"), 11, "Cargando consignaciones…");
  actualizarPaginacionEditorial("consignaciones");
  try {
    const parametros = new URLSearchParams({
      q: $("inp-editorial-consignacion-q").value.trim(),
      page: texto(consignacionesEditorialesPagina),
      limit: "30",
    });
    if ($("sel-editorial-consignacion-estado").value) {
      parametros.set("estado", $("sel-editorial-consignacion-estado").value);
    }
    if ($("sel-editorial-consignacion-tipo").value) {
      parametros.set("tipo_comercial", $("sel-editorial-consignacion-tipo").value);
    }
    const respuesta = await api("/editorial/consignaciones?" + parametros.toString());
    consignacionesEditoriales = extraerLista(respuesta, "consignaciones");
    consignacionesEditorialesHaySiguiente = consignacionesEditoriales.length === 30;
    pintarConsignacionesEditoriales();
  } catch (error) {
    filaVacia($("editorial-consignaciones-body"), 11, error.message);
  } finally {
    consignacionesEditorialesCargaEnCurso = false;
    actualizarPaginacionEditorial("consignaciones");
  }
}

function pintarConsignacionesEditoriales() {
  const tbody = $("editorial-consignaciones-body");
  tbody.replaceChildren();
  for (const consignacion of consignacionesEditoriales) {
    const cliente = document.createElement("td");
    cliente.append(nodo("strong", "", consignacion.cliente_nombre));
    if (consignacion.referencia) {
      cliente.append(nodo("small", "tabla-detalle", "Ref. " + texto(consignacion.referencia)));
    }
    const estado = document.createElement("td");
    estado.appendChild(chipEstadoEditorial(consignacion.estado));
    const acciones = document.createElement("td");
    const boton = nodo("button", "btn btn-outline", "Ver");
    boton.type = "button";
    boton.addEventListener("click", () => void abrirConsignacionEditorial(consignacion.id));
    acciones.appendChild(boton);
    const tr = document.createElement("tr");
    tr.append(
      celda(consignacion.folio),
      celda(hora(consignacion.creado_en)),
      cliente,
      celda(rotuloTipoComercial(consignacion.tipo_comercial)),
      celda(numero(consignacion.unidades_enviadas)),
      celda(numero(consignacion.unidades_vendidas)),
      celda(numero(consignacion.unidades_devueltas)),
      celda(numero(consignacion.unidades_pendientes)),
      celda(fmt(consignacion.valor_enviado) + " " + texto(consignacion.moneda)),
      estado,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!consignacionesEditoriales.length) {
    filaVacia(tbody, 11, "No hay consignaciones para este filtro.");
  }
}

$("form-editorial-consignaciones-filtros").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void cargarConsignacionesEditoriales({ reiniciar: true });
});
$("btn-refrescar-consignaciones-editoriales").addEventListener("click", () =>
  void cargarConsignacionesEditoriales()
);

function pintarLineasNuevaConsignacion() {
  const tbody = $("consignacion-editorial-lineas-body");
  tbody.replaceChildren();
  for (const linea of consignacionEditorialLineas) {
    const cantidadTd = document.createElement("td");
    const cantidad = nodo("input", "inp inp-cantidad");
    cantidad.type = "number";
    cantidad.min = "1";
    cantidad.max = "999";
    cantidad.step = "1";
    cantidad.value = texto(linea.cantidad);
    cantidad.setAttribute("aria-label", "Cantidad de " + texto(linea.producto.titulo));
    cantidad.addEventListener("change", () => {
      const nueva = Number(cantidad.value);
      if (Number.isInteger(nueva) && nueva >= 1 && nueva <= 999) linea.cantidad = nueva;
      else cantidad.value = texto(linea.cantidad);
    });
    cantidadTd.appendChild(cantidad);
    const acciones = document.createElement("td");
    const quitar = nodo("button", "btn btn-danger", "Quitar");
    quitar.type = "button";
    quitar.addEventListener("click", () => {
      consignacionEditorialLineas = consignacionEditorialLineas.filter((item) =>
        numero(item.producto.id) !== numero(linea.producto.id)
      );
      pintarLineasNuevaConsignacion();
    });
    acciones.appendChild(quitar);
    const tr = document.createElement("tr");
    tr.append(
      celda(linea.producto.sku),
      celda(linea.producto.titulo),
      celda(numero(linea.producto.stock_disponible)),
      cantidadTd,
      acciones
    );
    tbody.appendChild(tr);
  }
  if (!consignacionEditorialLineas.length) filaVacia(tbody, 5, "Agrega al menos un libro.");
}

async function abrirAltaConsignacionEditorial() {
  if (!esSupervisor() || editorialOperacionEnCurso || intentoEditorialOperacion) return;
  try {
    await prepararOpcionesConsignacion();
    consignacionEditorialLineas = [];
    $("sel-consignacion-editorial-cliente").value = "";
    $("inp-consignacion-editorial-envio").value = fechaLocalIso(new Date());
    $("inp-consignacion-editorial-limite").value = "";
    $("inp-consignacion-editorial-moneda").value = "MXN";
    $("inp-consignacion-editorial-referencia").value = "";
    $("inp-consignacion-editorial-notas").value = "";
    $("sel-consignacion-editorial-producto").value = "";
    $("inp-consignacion-editorial-cantidad").value = "1";
    $("consignacion-editorial-error").textContent = "";
    pintarLineasNuevaConsignacion();
    abrirModal("modal-consignacion-editorial");
  } catch (error) {
    toast(error.message, "err");
  }
}

$("btn-nueva-consignacion-editorial").addEventListener("click", () =>
  void abrirAltaConsignacionEditorial()
);

$("btn-agregar-linea-consignacion").addEventListener("click", () => {
  const productoId = numero($("sel-consignacion-editorial-producto").value, 0);
  const cantidad = Number($("inp-consignacion-editorial-cantidad").value);
  const producto = productosCatalogoOpciones.find((item) => numero(item.id) === productoId);
  if (!producto || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
    $("consignacion-editorial-error").textContent = "Selecciona un producto y una cantidad válida.";
    return;
  }
  const existente = consignacionEditorialLineas.find((item) => numero(item.producto.id) === productoId);
  if (existente) existente.cantidad = Math.min(999, existente.cantidad + cantidad);
  else consignacionEditorialLineas.push({ producto, cantidad });
  $("consignacion-editorial-error").textContent = "";
  $("sel-consignacion-editorial-producto").value = "";
  $("inp-consignacion-editorial-cantidad").value = "1";
  pintarLineasNuevaConsignacion();
});

$("form-consignacion-editorial").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!esSupervisor() || editorialOperacionEnCurso) return;
  const formulario = evento.currentTarget;
  if (!formulario.checkValidity()) {
    formulario.reportValidity();
    return;
  }
  const clienteId = numero($("sel-consignacion-editorial-cliente").value, 0);
  const envio = $("inp-consignacion-editorial-envio").value;
  const limite = $("inp-consignacion-editorial-limite").value;
  if (!clienteId || !consignacionEditorialLineas.length || (limite && limite < envio)) {
    $("consignacion-editorial-error").textContent = "Selecciona un consignatario, agrega libros y revisa las fechas.";
    return;
  }
  const body = {
    cliente_id: clienteId,
    fecha_envio_programada: envio,
    fecha_limite: limite || null,
    moneda: $("inp-consignacion-editorial-moneda").value.trim().toUpperCase(),
    referencia: opcionalEditorial($("inp-consignacion-editorial-referencia").value),
    notas: opcionalEditorial($("inp-consignacion-editorial-notas").value),
    items: consignacionEditorialLineas.map((linea) => ({
      producto_id: numero(linea.producto.id),
      cantidad: numero(linea.cantidad),
    })),
  };
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-guardar-consignacion-editorial"), "Creando…", async () => {
    try {
      consignacionEditorialActiva = await postEditorialIdempotente(
        "ALTA_CONSIGNACION_EDITORIAL",
        "/editorial/consignaciones",
        body
      );
      cerrarModal($("modal-consignacion-editorial"), true);
      await cargarConsignacionesEditoriales({ reiniciar: true });
      pintarConsignacionEditorialActiva();
      abrirModal("modal-consignacion-editorial-detalle");
      toast("Borrador de consignación creado con precios de mayoreo vigentes.", "ok");
    } catch (error) {
      $("consignacion-editorial-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

async function abrirConsignacionEditorial(id) {
  if (!esSupervisor()) return;
  try {
    consignacionEditorialActiva = await api(
      "/editorial/consignaciones/" + encodeURIComponent(id)
    );
    pintarConsignacionEditorialActiva();
    abrirModal("modal-consignacion-editorial-detalle");
  } catch (error) {
    toast(error.message, "err");
  }
}

function pintarConsignacionEditorialActiva() {
  const consignacion = consignacionEditorialActiva;
  if (!consignacion) return;
  const resumen = consignacion.resumen || {};
  $("consignacion-editorial-detalle-titulo").textContent = "Consignación " + texto(consignacion.folio);
  pintarResumenEditorial($("consignacion-editorial-resumen"), [
    ["Estado", rotuloEditorial(consignacion.estado)],
    ["Consignatario", consignacion.cliente_nombre],
    ["Tipo", rotuloTipoComercial(consignacion.tipo_comercial)],
    ["Envío programado", fechaEditorial(consignacion.fecha_envio_programada)],
    ["Fecha límite", fechaEditorial(consignacion.fecha_limite)],
    ["Enviadas", numero(resumen.unidades_enviadas)],
    ["Vendidas", numero(resumen.unidades_vendidas)],
    ["Devueltas", numero(resumen.unidades_devueltas)],
    ["Pendientes", numero(resumen.unidades_pendientes)],
    ["Valor enviado", fmt(resumen.valor_enviado) + " " + texto(consignacion.moneda)],
    ["Venta reportada", fmt(resumen.venta_reportada) + " " + texto(consignacion.moneda)],
    ["Referencia", consignacion.referencia || "—"],
  ]);
  const avisos = {
    BORRADOR: "El borrador aún no mueve existencias. Confirma el envío cuando los libros salgan físicamente.",
    ENVIADA: "Los ejemplares están fuera de tienda y siguen siendo propiedad de la editorial.",
    PARCIAL: "Hay ventas o devoluciones registradas y todavía quedan unidades por conciliar.",
    LIQUIDADA: "Todas las unidades fueron vendidas o devueltas. Esto no representa por sí mismo un pago recibido.",
    CERRADA: "El expediente quedó cerrado después de conciliar todas las unidades.",
    CANCELADA: "El borrador fue cancelado sin modificar inventario.",
  };
  $("consignacion-editorial-aviso").textContent = avisos[consignacion.estado] || "";
  const borrador = consignacion.estado === "BORRADOR";
  const operable = ["ENVIADA", "PARCIAL"].includes(consignacion.estado)
    && numero(resumen.unidades_pendientes) > 0;
  $("btn-enviar-consignacion-editorial").classList.toggle("hidden", !borrador);
  $("btn-cancelar-consignacion-editorial").classList.toggle("hidden", !borrador);
  $("btn-registrar-venta-consignacion").classList.toggle("hidden", !operable);
  $("btn-registrar-devolucion-consignacion").classList.toggle("hidden", !operable);
  $("btn-cerrar-consignacion-editorial").classList.toggle(
    "hidden",
    !esAdmin() || consignacion.estado !== "LIQUIDADA"
  );
  $("consignacion-editorial-detalle-error").textContent = "";

  const detalles = $("consignacion-editorial-detalle-body");
  detalles.replaceChildren();
  for (const linea of consignacion.detalles || []) {
    const producto = document.createElement("td");
    producto.append(nodo("strong", "", linea.producto_titulo));
    if (linea.producto_isbn) producto.append(nodo("small", "tabla-detalle", "ISBN " + texto(linea.producto_isbn)));
    const tr = document.createElement("tr");
    tr.append(
      celda(linea.producto_sku),
      producto,
      celda(numero(linea.cantidad_enviada)),
      celda(numero(linea.cantidad_vendida)),
      celda(numero(linea.cantidad_devuelta)),
      celda(numero(linea.cantidad_pendiente)),
      celda(fmt(linea.precio_unitario)),
      celda(fmt(linea.importe_enviado)),
      celda(numero(linea.stock_tienda_actual)),
      celda(numero(linea.stock_consignado_actual))
    );
    detalles.appendChild(tr);
  }
  if (!(consignacion.detalles || []).length) filaVacia(detalles, 10, "Sin libros consignados.");

  const operaciones = $("consignacion-editorial-operaciones-body");
  operaciones.replaceChildren();
  for (const operacion of consignacion.operaciones || []) {
    const unidades = (operacion.detalles || []).reduce(
      (total, linea) => total + numero(linea.cantidad),
      0
    );
    const tr = document.createElement("tr");
    tr.append(
      celda(hora(operacion.creado_en)),
      celda(rotuloEditorial(operacion.tipo)),
      celda(operacion.referencia || "—"),
      celda(unidades),
      celda(fmt(operacion.total)),
      celda(operacion.motivo),
      celda(operacion.usuario)
    );
    operaciones.appendChild(tr);
  }
  if (!(consignacion.operaciones || []).length) filaVacia(operaciones, 7, "Sin operaciones registradas.");
  pintarTransicionesEditoriales(
    $("consignacion-editorial-transiciones-body"),
    consignacion.transiciones
  );
}

function abrirOperacionConsignacion(tipo) {
  if (!consignacionEditorialActiva || !["ENVIADA", "PARCIAL"].includes(consignacionEditorialActiva.estado)) return;
  const venta = tipo === "VENTA";
  $("operacion-consignacion-titulo").textContent = venta
    ? "Reportar venta de consignación" : "Registrar devolución a tienda";
  $("inp-operacion-consignacion-tipo").value = tipo;
  $("inp-operacion-consignacion-referencia").value = "";
  $("inp-operacion-consignacion-referencia").required = venta;
  $("inp-operacion-consignacion-motivo").value = "";
  $("operacion-consignacion-cantidad-titulo").textContent = venta ? "Vendidas" : "Devueltas";
  $("btn-confirmar-operacion-consignacion").textContent = venta
    ? "Registrar venta" : "Registrar devolución";
  $("operacion-consignacion-error").textContent = "";
  const tbody = $("operacion-consignacion-lineas-body");
  tbody.replaceChildren();
  for (const linea of (consignacionEditorialActiva.detalles || []).filter((item) =>
    numero(item.cantidad_pendiente) > 0
  )) {
    const producto = document.createElement("td");
    producto.append(nodo("strong", "", linea.producto_titulo));
    producto.append(nodo("small", "tabla-detalle", linea.producto_sku));
    const cantidadTd = document.createElement("td");
    const input = nodo("input", "inp inp-cantidad");
    input.type = "number";
    input.min = "0";
    input.max = texto(numero(linea.cantidad_pendiente));
    input.step = "1";
    input.value = "0";
    input.dataset.productoId = texto(linea.producto_id);
    input.setAttribute("aria-label", (venta ? "Vendidas de " : "Devueltas de ") + texto(linea.producto_titulo));
    cantidadTd.appendChild(input);
    const tr = document.createElement("tr");
    tr.append(producto, celda(numero(linea.cantidad_pendiente)), cantidadTd);
    tbody.appendChild(tr);
  }
  abrirModal("modal-operacion-consignacion");
}

$("btn-registrar-venta-consignacion").addEventListener("click", () =>
  abrirOperacionConsignacion("VENTA")
);
$("btn-registrar-devolucion-consignacion").addEventListener("click", () =>
  abrirOperacionConsignacion("DEVOLUCION")
);

$("form-operacion-consignacion").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!consignacionEditorialActiva || editorialOperacionEnCurso) return;
  const tipo = $("inp-operacion-consignacion-tipo").value;
  const referencia = $("inp-operacion-consignacion-referencia").value.trim();
  const motivo = $("inp-operacion-consignacion-motivo").value.trim();
  const items = [...$("operacion-consignacion-lineas-body").querySelectorAll("input[data-producto-id]")]
    .map((input) => ({
      producto_id: numero(input.dataset.productoId),
      cantidad: Number(input.value),
      maximo: Number(input.max),
    }))
    .filter((item) => item.cantidad > 0);
  if (motivo.length < 3 || (tipo === "VENTA" && !referencia)
    || !items.length || items.some((item) =>
      !Number.isInteger(item.cantidad) || item.cantidad < 1 || item.cantidad > item.maximo
    )) {
    $("operacion-consignacion-error").textContent = "Escribe el motivo, completa la referencia cuando corresponda y captura cantidades válidas.";
    return;
  }
  const id = consignacionEditorialActiva.id;
  const body = {
    motivo,
    referencia: referencia || null,
    items: items.map(({ producto_id, cantidad }) => ({ producto_id, cantidad })),
  };
  editorialOperacionEnCurso = true;
  await conBotonOcupado($("btn-confirmar-operacion-consignacion"), "Registrando…", async () => {
    try {
      const segmento = tipo === "VENTA" ? "ventas" : "devoluciones";
      consignacionEditorialActiva = await postEditorialIdempotente(
        tipo + "_CONSIGNACION_" + id,
        "/editorial/consignaciones/" + encodeURIComponent(id) + "/" + segmento,
        body
      );
      cerrarModal($("modal-operacion-consignacion"), true);
      pintarConsignacionEditorialActiva();
      productosCatalogoOpciones = [];
      await cargarConsignacionesEditoriales();
      toast(tipo === "VENTA" ? "Venta consignada registrada." : "Devolución ingresada a tienda.", "ok");
    } catch (error) {
      $("operacion-consignacion-error").textContent = intentoEditorialOperacion
        ? error.message + " La clave se conservó; reintenta sin modificar los datos."
        : error.message;
    }
  });
  editorialOperacionEnCurso = false;
});

$("btn-enviar-consignacion-editorial").addEventListener("click", () => {
  if (!consignacionEditorialActiva || consignacionEditorialActiva.estado !== "BORRADOR") return;
  const id = consignacionEditorialActiva.id;
  abrirAccionEditorial({
    titulo: "Confirmar envío de " + texto(consignacionEditorialActiva.folio),
    referencia: true,
    ayuda: "Se descontarán las unidades de la existencia disponible en tienda y se registrarán como consignadas.",
    textoBoton: "Confirmar envío",
    ejecutar: async ({ motivo, referencia }) => {
      consignacionEditorialActiva = await postEditorialIdempotente(
        "ENVIO_CONSIGNACION_" + id,
        "/editorial/consignaciones/" + encodeURIComponent(id) + "/envio",
        { motivo, referencia }
      );
      pintarConsignacionEditorialActiva();
      productosCatalogoOpciones = [];
      await cargarConsignacionesEditoriales();
      toast("Envío confirmado; inventario tienda y consignado actualizados.", "ok");
    },
  });
});

$("btn-cancelar-consignacion-editorial").addEventListener("click", () => {
  if (!consignacionEditorialActiva || consignacionEditorialActiva.estado !== "BORRADOR") return;
  const id = consignacionEditorialActiva.id;
  abrirAccionEditorial({
    titulo: "Cancelar " + texto(consignacionEditorialActiva.folio),
    ayuda: "El borrador se cancelará sin modificar existencias.",
    textoBoton: "Cancelar borrador",
    ejecutar: async ({ motivo }) => {
      consignacionEditorialActiva = await postEditorialIdempotente(
        "CANCELACION_CONSIGNACION_" + id,
        "/editorial/consignaciones/" + encodeURIComponent(id) + "/cancelacion",
        { motivo }
      );
      pintarConsignacionEditorialActiva();
      await cargarConsignacionesEditoriales();
      toast("Consignación cancelada sin mover inventario.", "ok");
    },
  });
});

$("btn-cerrar-consignacion-editorial").addEventListener("click", () => {
  if (!consignacionEditorialActiva || !esAdmin()
    || consignacionEditorialActiva.estado !== "LIQUIDADA") return;
  const id = consignacionEditorialActiva.id;
  abrirAccionEditorial({
    titulo: "Cerrar expediente " + texto(consignacionEditorialActiva.folio),
    ayuda: "El cierre sólo confirma que todas las unidades ya fueron conciliadas.",
    textoBoton: "Cerrar expediente",
    ejecutar: async ({ motivo }) => {
      consignacionEditorialActiva = await postEditorialIdempotente(
        "CIERRE_CONSIGNACION_" + id,
        "/editorial/consignaciones/" + encodeURIComponent(id) + "/cierre",
        { motivo }
      );
      pintarConsignacionEditorialActiva();
      await cargarConsignacionesEditoriales();
      toast("Expediente de consignación cerrado.", "ok");
    },
  });
});

void restaurarSesion();
