"use strict";

const API = location.protocol === "file:" ? "http://localhost:4000/api/tienda" : "/api/tienda";
const CART_KEY = "libreria-rem:tienda:carrito:v1";
const TOKEN_KEY = "libreria-rem:tienda:token:v1";
const LAST_ORDER_KEY = "libreria-rem:tienda:ultimo-pedido:v1";
const PAGE_SIZE = 12;

let configuracion = { nombre: "Librería REM", moneda: "MXN", tipos_entrega: ["ENVIO", "RECOLECCION"] };
let categorias = [];
let productos = [];
let pagina = 1;
let hayPaginaSiguiente = false;
let catalogoVersion = 0;
let carrito = cargarCarrito();
let cotizacion = null;
let cotizacionFirma = "";
let cotizacionError = "";
let cotizacionEnCurso = false;
let cotizacionVersion = 0;
let detalleVersion = 0;
let pedidoIntento = null;
let pedidoEnCurso = false;
let pedidoConsultado = null;
let consultaEnCurso = false;
let cancelacionIntento = null;
let cancelacionEnCurso = false;
let tokenCarrito = obtenerTokenCarrito();

const $ = (id) => document.getElementById(id);
const texto = (valor, defecto = "") => valor == null ? defecto : String(valor);
const numero = (valor, defecto = 0) => {
  const resultado = Number(valor);
  return Number.isFinite(resultado) ? resultado : defecto;
};
const dinero = (valor) => new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: configuracion.moneda || "MXN",
}).format(numero(valor));

function nodo(etiqueta, clase, contenido) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (contenido !== undefined) elemento.textContent = texto(contenido);
  return elemento;
}

function claveAleatoria() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let indice = 0; indice < bytes.length; indice++) bytes[indice] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function leerAlmacen(clave) {
  try { return localStorage.getItem(clave); } catch (_) { return null; }
}

function guardarAlmacen(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch (_) { /* almacenamiento no disponible */ }
}

function obtenerTokenCarrito() {
  const existente = leerAlmacen(TOKEN_KEY);
  if (existente && /^[A-Za-z0-9._:-]{16,200}$/.test(existente)) return existente;
  const nuevo = claveAleatoria();
  guardarAlmacen(TOKEN_KEY, nuevo);
  return nuevo;
}

function cargarCarrito() {
  try {
    const guardado = JSON.parse(leerAlmacen(CART_KEY) || "[]");
    if (!Array.isArray(guardado)) return [];
    return guardado.filter((item) =>
      Number.isInteger(Number(item.producto_id)) && Number(item.producto_id) > 0
      && Number.isInteger(Number(item.cantidad)) && Number(item.cantidad) > 0
    ).map((item) => ({
      producto_id: Number(item.producto_id),
      slug: texto(item.slug),
      titulo: texto(item.titulo, "Producto"),
      imagen: urlHttp(item.imagen),
      disponible: Math.max(0, numero(item.disponible)),
      cantidad: Number(item.cantidad),
    }));
  } catch (_) { return []; }
}

function guardarCarrito() {
  guardarAlmacen(CART_KEY, JSON.stringify(carrito));
}

function urlHttp(valor) {
  if (!valor) return "";
  try {
    const url = new URL(String(valor));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}

function colocarImagen(contenedor, url, alternativo, clase) {
  const segura = urlHttp(url);
  if (!segura) {
    contenedor.appendChild(nodo("div", (clase || "") + " image-placeholder", "📚"));
    return;
  }
  const imagen = document.createElement("img");
  imagen.className = clase || "";
  imagen.src = segura;
  imagen.alt = texto(alternativo, "Portada del libro");
  imagen.loading = "lazy";
  imagen.referrerPolicy = "no-referrer";
  imagen.addEventListener("error", () => {
    imagen.replaceWith(nodo("div", (clase || "") + " image-placeholder", "📚"));
  }, { once: true });
  contenedor.appendChild(imagen);
}

function toast(mensaje, tipo) {
  const aviso = nodo("div", "toast " + (tipo || ""), mensaje);
  $("toasts").appendChild(aviso);
  setTimeout(() => aviso.remove(), 4000);
}

async function api(ruta, { method = "GET", body, usarToken = false, idempotencia = "" } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (usarToken) headers["X-Cart-Token"] = tokenCarrito;
  if (idempotencia) headers["Idempotency-Key"] = idempotencia;
  const respuesta = await fetch(API + ruta, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let datos = null;
  try { datos = await respuesta.json(); } catch (_) { /* respuesta sin JSON */ }
  if (!respuesta.ok) {
    const error = new Error(datos && datos.error ? datos.error : "No fue posible completar la solicitud.");
    error.status = respuesta.status;
    error.data = datos;
    throw error;
  }
  return datos;
}

function extraerLista(respuesta, propiedad) {
  if (Array.isArray(respuesta)) return respuesta;
  if (respuesta && Array.isArray(respuesta[propiedad])) return respuesta[propiedad];
  if (respuesta && Array.isArray(respuesta.resultados)) return respuesta.resultados;
  return [];
}

function normalizarProducto(producto) {
  return {
    ...producto,
    id: numero(producto && producto.id),
    slug: texto(producto && producto.slug),
    titulo: texto(producto && producto.titulo, "Libro"),
    autor: texto(producto && producto.autor),
    editorial: texto(producto && producto.editorial),
    categoria: texto(producto && producto.categoria, "Sin categoría"),
    descripcion: texto(producto && producto.descripcion_comercial),
    imagen: urlHttp(producto && producto.imagen_principal),
    precio_lista: numero(producto && (producto.precio_lista ?? producto.precio_unitario)),
    descuento_unitario: numero(producto && producto.descuento_unitario),
    precio_unitario: numero(producto && (producto.precio_unitario ?? producto.precio_lista)),
    disponible: Math.max(0, numero(producto && producto.disponible)),
  };
}

function actualizarBloqueoPagina() {
  document.body.classList.toggle("no-scroll", Boolean(document.querySelector(".overlay:not(.hidden)")));
}

function abrirCapa(id, focoId) {
  const capa = $(id);
  capa.classList.remove("hidden");
  actualizarBloqueoPagina();
  const foco = focoId ? $(focoId) : capa.querySelector("button, input, select, textarea, a");
  if (foco) setTimeout(() => foco.focus(), 0);
}

function cerrarCapa(capa) {
  if (pedidoEnCurso && capa.id === "modal-checkout") return;
  if (cancelacionEnCurso && capa.id === "modal-pedido") return;
  capa.classList.add("hidden");
  actualizarBloqueoPagina();
}

document.querySelectorAll(".overlay").forEach((capa) => {
  capa.addEventListener("mousedown", (evento) => {
    if (evento.target === capa) cerrarCapa(capa);
  });
  capa.querySelectorAll("[data-close]").forEach((boton) => {
    boton.addEventListener("click", () => cerrarCapa(capa));
  });
});

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  const abiertas = Array.from(document.querySelectorAll(".overlay:not(.hidden)"));
  if (abiertas.length) cerrarCapa(abiertas[abiertas.length - 1]);
});

async function cargarConfiguracion() {
  try {
    const respuesta = await api("/config");
    configuracion = { ...configuracion, ...(respuesta || {}) };
    $("config-nombre").textContent = texto(configuracion.nombre, "Librería REM");
    document.title = texto(configuracion.nombre, "Librería REM") + " · Tienda en línea";
    const entregas = Array.isArray(configuracion.tipos_entrega) ? configuracion.tipos_entrega : [];
    $("config-entregas").textContent = entregas.includes("ENVIO") && entregas.includes("RECOLECCION")
      ? "Envío y recolección en tienda disponibles."
      : entregas.includes("ENVIO") ? "Envío disponible." : "Recolección en tienda disponible.";
  } catch (error) {
    $("config-entregas").textContent = "Consulta las opciones de entrega al crear tu pedido.";
  }
}

async function cargarCategorias() {
  try {
    categorias = extraerLista(await api("/categorias"), "categorias");
    const select = $("sel-categoria");
    const anterior = select.value;
    select.replaceChildren();
    const todas = nodo("option", "", "Todas las categorías");
    todas.value = "";
    select.appendChild(todas);
    for (const categoria of categorias) {
      const opcion = nodo("option", "", texto(categoria.nombre));
      opcion.value = texto(categoria.slug);
      select.appendChild(opcion);
    }
    if (Array.from(select.options).some((opcion) => opcion.value === anterior)) select.value = anterior;
  } catch (error) {
    toast(error.message, "error");
  }
}

async function cargarCatalogo() {
  const version = ++catalogoVersion;
  $("catalogo-estado").textContent = "Cargando catálogo…";
  $("productos-grid").replaceChildren();
  $("btn-pagina-anterior").disabled = true;
  $("btn-pagina-siguiente").disabled = true;
  try {
    const parametros = new URLSearchParams({
      page: texto(pagina),
      limit: texto(PAGE_SIZE),
    });
    const busqueda = $("inp-busqueda").value.trim();
    const categoria = $("sel-categoria").value;
    if (busqueda) parametros.set("q", busqueda);
    if (categoria) parametros.set("categoria_slug", categoria);
    const respuesta = await api("/productos?" + parametros.toString());
    if (version !== catalogoVersion) return;
    productos = extraerLista(respuesta, "productos").map(normalizarProducto);
    pagina = Math.max(1, numero(respuesta && respuesta.page, pagina));
    const total = respuesta && respuesta.total != null ? numero(respuesta.total) : null;
    hayPaginaSiguiente = total == null
      ? productos.length === PAGE_SIZE
      : pagina * numero(respuesta.limit, PAGE_SIZE) < total;
    if (!productos.length && pagina > 1) {
      pagina--;
      await cargarCatalogo();
      return;
    }
    pintarCatalogo();
  } catch (error) {
    if (version !== catalogoVersion) return;
    $("catalogo-estado").textContent = error.message;
    $("productos-grid").appendChild(nodo("p", "empty-state", "No fue posible cargar los libros."));
  }
}

function pintarPrecio(contenedor, producto) {
  if (producto.descuento_unitario > 0 && producto.precio_lista > producto.precio_unitario) {
    contenedor.append(
      nodo("del", "list-price", dinero(producto.precio_lista)),
      nodo("strong", "current-price", dinero(producto.precio_unitario))
    );
  } else {
    contenedor.appendChild(nodo("strong", "current-price", dinero(producto.precio_unitario)));
  }
}

function pintarCatalogo() {
  const grid = $("productos-grid");
  grid.replaceChildren();
  for (const producto of productos) {
    const tarjeta = nodo("article", "product-card");
    const portada = nodo("button", "product-cover", "");
    portada.type = "button";
    portada.setAttribute("aria-label", "Ver " + producto.titulo);
    colocarImagen(portada, producto.imagen, "Portada de " + producto.titulo, "cover-image");
    portada.addEventListener("click", () => abrirDetalleProducto(producto.slug));

    const contenido = nodo("div", "product-content");
    contenido.append(
      nodo("span", "category-label", producto.categoria),
      nodo("h3", "", producto.titulo),
      nodo("p", "author", producto.autor || producto.editorial || "Librería REM")
    );
    const precio = nodo("div", "price");
    pintarPrecio(precio, producto);
    const disponibilidad = nodo(
      "p",
      producto.disponible > 0 ? "availability available" : "availability unavailable",
      producto.disponible > 0 ? "Disponible: " + producto.disponible : "Agotado"
    );
    const acciones = nodo("div", "card-actions");
    const detalle = nodo("button", "button button-outline", "Ver detalle");
    detalle.type = "button";
    detalle.addEventListener("click", () => abrirDetalleProducto(producto.slug));
    const agregar = nodo("button", "button button-primary", "Agregar");
    agregar.type = "button";
    agregar.disabled = producto.disponible < 1;
    agregar.addEventListener("click", () => agregarAlCarrito(producto));
    acciones.append(detalle, agregar);
    contenido.append(precio, disponibilidad, acciones);
    tarjeta.append(portada, contenido);
    grid.appendChild(tarjeta);
  }
  if (!productos.length) grid.appendChild(nodo("p", "empty-state", "No encontramos libros para esta búsqueda."));
  $("catalogo-estado").textContent = productos.length
    ? productos.length + " libro" + (productos.length === 1 ? "" : "s") + " en esta página."
    : "Sin resultados.";
  $("pagina-label").textContent = "Página " + pagina;
  $("btn-pagina-anterior").disabled = pagina <= 1;
  $("btn-pagina-siguiente").disabled = !hayPaginaSiguiente;
}

async function abrirDetalleProducto(slug) {
  if (!slug) return;
  const version = ++detalleVersion;
  $("producto-modal-titulo").textContent = "Detalle del libro";
  $("producto-detalle").replaceChildren(nodo("p", "status-line", "Cargando detalle…"));
  abrirCapa("modal-producto");
  try {
    const respuesta = await api("/productos/" + encodeURIComponent(slug));
    if (version !== detalleVersion) return;
    pintarDetalleProducto(normalizarProducto(respuesta), respuesta && respuesta.imagenes);
  } catch (error) {
    if (version === detalleVersion) $("producto-detalle").replaceChildren(nodo("p", "form-error", error.message));
  }
}

function pintarDetalleProducto(producto, imagenes) {
  const contenedor = $("producto-detalle");
  contenedor.replaceChildren();
  $("producto-modal-titulo").textContent = producto.titulo;
  const galeria = nodo("div", "detail-gallery");
  const listaImagenes = Array.isArray(imagenes) ? imagenes : [];
  if (listaImagenes.length) {
    for (const imagen of listaImagenes) {
      colocarImagen(galeria, imagen.url, imagen.texto_alternativo || ("Portada de " + producto.titulo), "detail-image");
    }
  } else {
    colocarImagen(galeria, producto.imagen, "Portada de " + producto.titulo, "detail-image");
  }
  const informacion = nodo("div", "detail-info");
  informacion.append(
    nodo("span", "category-label", producto.categoria),
    nodo("h3", "", producto.titulo),
    nodo("p", "author", producto.autor || producto.editorial || ""),
    nodo("p", "description", producto.descripcion || "Consulta disponibilidad y agrégalo a tu carrito.")
  );
  const precio = nodo("div", "price price-large");
  pintarPrecio(precio, producto);
  const disponible = nodo("p", producto.disponible > 0 ? "availability available" : "availability unavailable",
    producto.disponible > 0 ? "Disponible: " + producto.disponible : "Agotado");
  const agregar = nodo("button", "button button-primary", "Agregar al carrito");
  agregar.type = "button";
  agregar.disabled = producto.disponible < 1;
  agregar.addEventListener("click", () => {
    agregarAlCarrito(producto);
    cerrarCapa($("modal-producto"));
    abrirCapa("drawer-carrito");
  });
  informacion.append(precio, disponible, agregar);
  contenedor.append(galeria, informacion);
}

function firmaCarrito() {
  return JSON.stringify(carrito.map((item) => ({
    producto_id: numero(item.producto_id),
    cantidad: numero(item.cantidad),
  })));
}

function cotizacionVigente() {
  return Boolean(
    carrito.length && cotizacion && !cotizacionEnCurso
    && cotizacionFirma === firmaCarrito() && Array.isArray(cotizacion.lineas)
  );
}

function carritoBloqueado() {
  if (!pedidoIntento) return false;
  toast("Hay un pedido pendiente de confirmación. Reinténtalo antes de cambiar el carrito.", "error");
  return true;
}

function agregarAlCarrito(producto) {
  if (carritoBloqueado()) return;
  const existente = carrito.find((item) => item.producto_id === producto.id);
  if (existente) {
    if (existente.cantidad >= producto.disponible) return toast("No hay más unidades disponibles.", "error");
    existente.cantidad++;
    existente.disponible = producto.disponible;
  } else {
    if (producto.disponible < 1) return toast("Este libro está agotado.", "error");
    carrito.push({
      producto_id: producto.id,
      slug: producto.slug,
      titulo: producto.titulo,
      imagen: producto.imagen,
      disponible: producto.disponible,
      cantidad: 1,
    });
  }
  guardarCarrito();
  pintarCarrito();
  void cotizarCarrito();
  toast("Libro agregado al carrito.", "ok");
}

function cambiarCantidad(productoId, delta) {
  if (carritoBloqueado()) return;
  const indice = carrito.findIndex((item) => item.producto_id === productoId);
  if (indice < 0) return;
  const item = carrito[indice];
  const nueva = item.cantidad + delta;
  if (nueva <= 0) carrito.splice(indice, 1);
  else if (delta > 0 && nueva > item.disponible) toast("No hay más unidades disponibles.", "error");
  else item.cantidad = nueva;
  guardarCarrito();
  pintarCarrito();
  void cotizarCarrito();
}

function quitarDelCarrito(productoId) {
  if (carritoBloqueado()) return;
  carrito = carrito.filter((item) => item.producto_id !== productoId);
  guardarCarrito();
  pintarCarrito();
  void cotizarCarrito();
}

async function cotizarCarrito() {
  const firma = firmaCarrito();
  const version = ++cotizacionVersion;
  cotizacion = null;
  cotizacionFirma = "";
  cotizacionError = "";
  if (!carrito.length) {
    cotizacionEnCurso = false;
    pintarCarrito();
    return false;
  }
  cotizacionEnCurso = true;
  pintarCarrito();
  try {
    const respuesta = await api("/cotizar", {
      method: "POST",
      body: { items: carrito.map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad })) },
    });
    if (version !== cotizacionVersion || firma !== firmaCarrito()) return false;
    const lineas = extraerLista(respuesta, "lineas");
    const mapa = new Map(lineas.map((linea) => [numero(linea.producto_id), linea]));
    if (lineas.length !== carrito.length || carrito.some((item) => {
      const linea = mapa.get(item.producto_id);
      return !linea || numero(linea.cantidad) !== item.cantidad;
    })) throw new Error("La cotización no corresponde al carrito actual.");
    for (const item of carrito) {
      const linea = mapa.get(item.producto_id);
      if (linea && linea.disponible != null) item.disponible = Math.max(0, numero(linea.disponible));
    }
    guardarCarrito();
    const insuficiente = carrito.find((item) => {
      const linea = mapa.get(item.producto_id);
      return linea && (
        linea.disponible_suficiente === false
        || (linea.disponible != null && numero(linea.disponible) < item.cantidad)
      );
    });
    if (insuficiente) {
      throw new Error("Disponibilidad insuficiente de " + insuficiente.titulo + ". Ajusta la cantidad.");
    }
    cotizacion = respuesta;
    cotizacionFirma = firma;
    return true;
  } catch (error) {
    if (version === cotizacionVersion && firma === firmaCarrito()) cotizacionError = error.message;
    return false;
  } finally {
    if (version === cotizacionVersion && firma === firmaCarrito()) {
      cotizacionEnCurso = false;
      pintarCarrito();
    }
  }
}

function lineaCotizada(productoId) {
  if (!cotizacionVigente()) return null;
  return cotizacion.lineas.find((linea) => numero(linea.producto_id) === productoId) || null;
}

function pintarCarrito() {
  const contenedor = $("carrito-items");
  contenedor.replaceChildren();
  for (const item of carrito) {
    const linea = lineaCotizada(item.producto_id);
    const fila = nodo("article", "cart-item");
    const portada = nodo("div", "cart-thumb");
    colocarImagen(portada, item.imagen, "Portada de " + item.titulo, "thumb-image");
    const info = nodo("div", "cart-info");
    info.append(nodo("h3", "", item.titulo));
    const controles = nodo("div", "quantity-controls");
    const menos = nodo("button", "quantity-button", "−");
    menos.type = "button";
    menos.setAttribute("aria-label", "Quitar una unidad de " + item.titulo);
    menos.addEventListener("click", () => cambiarCantidad(item.producto_id, -1));
    const cantidad = nodo("strong", "", item.cantidad);
    const mas = nodo("button", "quantity-button", "+");
    mas.type = "button";
    mas.setAttribute("aria-label", "Agregar una unidad de " + item.titulo);
    mas.disabled = item.cantidad >= item.disponible;
    mas.addEventListener("click", () => cambiarCantidad(item.producto_id, 1));
    controles.append(menos, cantidad, mas);
    const precio = nodo("div", "cart-price");
    precio.append(
      nodo("span", "", linea ? dinero(linea.precio_unitario) + " c/u" : "Precio pendiente"),
      nodo("strong", "", linea ? dinero(linea.importe) : "…")
    );
    info.append(controles, precio);
    const quitar = nodo("button", "icon-button remove-button", "×");
    quitar.type = "button";
    quitar.setAttribute("aria-label", "Quitar " + item.titulo);
    quitar.addEventListener("click", () => quitarDelCarrito(item.producto_id));
    fila.append(portada, info, quitar);
    contenedor.appendChild(fila);
  }
  if (!carrito.length) contenedor.appendChild(nodo("p", "empty-state", "Tu carrito está vacío."));

  const unidades = carrito.reduce((total, item) => total + item.cantidad, 0);
  $("carrito-badge").textContent = texto(unidades);
  $("carrito-badge").setAttribute("aria-label", unidades + " artículo" + (unidades === 1 ? "" : "s"));
  $("carrito-descuento").textContent = dinero(cotizacionVigente() ? cotizacion.descuento : 0);
  $("carrito-total").textContent = dinero(cotizacionVigente() ? cotizacion.total : 0);
  const estado = $("carrito-cotizacion");
  if (!carrito.length) estado.textContent = "El carrito está vacío.";
  else if (cotizacionEnCurso) estado.textContent = "Confirmando precios y disponibilidad…";
  else if (cotizacionError) estado.textContent = "No se pudo cotizar: " + cotizacionError;
  else if (cotizacionVigente()) estado.textContent = "Precios y disponibilidad confirmados.";
  else estado.textContent = "Cotización pendiente.";
  estado.className = "status-line "
    + (cotizacionError ? "status-error" : cotizacionVigente() ? "status-ok" : "");
  $("btn-reintentar-cotizacion").classList.toggle("hidden", !cotizacionError || cotizacionEnCurso);
  $("btn-iniciar-checkout").disabled = !cotizacionVigente() || pedidoEnCurso;
  pintarResumenCheckout();
}

$("form-busqueda").addEventListener("submit", (evento) => {
  evento.preventDefault();
  pagina = 1;
  void cargarCatalogo();
});

$("btn-limpiar-busqueda").addEventListener("click", () => {
  $("inp-busqueda").value = "";
  $("sel-categoria").value = "";
  pagina = 1;
  void cargarCatalogo();
});

$("sel-categoria").addEventListener("change", () => {
  pagina = 1;
  void cargarCatalogo();
});

$("btn-pagina-anterior").addEventListener("click", () => {
  if (pagina <= 1) return;
  pagina--;
  void cargarCatalogo();
  document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" });
});

$("btn-pagina-siguiente").addEventListener("click", () => {
  if (!hayPaginaSiguiente) return;
  pagina++;
  void cargarCatalogo();
  document.getElementById("catalogo").scrollIntoView({ behavior: "smooth" });
});

$("btn-abrir-carrito").addEventListener("click", () => {
  pintarCarrito();
  abrirCapa("drawer-carrito");
  if (carrito.length && !cotizacionVigente() && !cotizacionEnCurso) void cotizarCarrito();
});

$("btn-reintentar-cotizacion").addEventListener("click", () => void cotizarCarrito());

/* CHECKOUT_Y_PEDIDOS */
function aplicarTiposEntrega() {
  const permitidos = Array.isArray(configuracion.tipos_entrega) && configuracion.tipos_entrega.length
    ? configuracion.tipos_entrega : ["ENVIO", "RECOLECCION"];
  const select = $("checkout-entrega");
  Array.from(select.options).forEach((opcion) => {
    opcion.disabled = !permitidos.includes(opcion.value);
    opcion.hidden = opcion.disabled;
  });
  if (!permitidos.includes(select.value)) {
    select.value = permitidos.includes("RECOLECCION") ? "RECOLECCION" : permitidos[0];
  }
  actualizarEntrega();
}

function actualizarEntrega() {
  const esEnvio = $("checkout-entrega").value === "ENVIO";
  $("grupo-checkout-direccion").classList.toggle("hidden", !esEnvio);
  $("checkout-direccion").required = esEnvio;
}

function pintarResumenCheckout() {
  const contenedor = $("checkout-items");
  contenedor.replaceChildren();
  const mapa = cotizacionVigente()
    ? new Map(cotizacion.lineas.map((linea) => [numero(linea.producto_id), linea]))
    : new Map();
  for (const item of carrito) {
    const linea = mapa.get(item.producto_id);
    const fila = nodo("div", "checkout-line");
    fila.append(
      nodo("span", "", item.cantidad + " × " + item.titulo),
      nodo("strong", "", linea ? dinero(linea.importe) : "…")
    );
    contenedor.appendChild(fila);
  }
  if (!carrito.length) contenedor.appendChild(nodo("p", "empty-state", "Sin artículos."));
  $("checkout-descuento").textContent = dinero(cotizacionVigente() ? cotizacion.descuento : 0);
  $("checkout-total").textContent = dinero(cotizacionVigente() ? cotizacion.total : 0);
}

function actualizarBloqueoCheckout() {
  const congelado = Boolean(pedidoIntento);
  document.querySelectorAll("#form-checkout input, #form-checkout select, #form-checkout textarea").forEach((campo) => {
    campo.disabled = pedidoEnCurso || congelado;
  });
  $("btn-confirmar-pedido").disabled = pedidoEnCurso;
  $("btn-confirmar-pedido").textContent = pedidoEnCurso
    ? "Creando pedido…" : congelado ? "Reintentar pedido" : "Crear pedido";
  const aviso = $("checkout-intento");
  aviso.classList.toggle("hidden", !congelado);
  aviso.textContent = congelado
    ? "La confirmación anterior quedó pendiente. Reintenta para obtener el mismo pedido sin duplicarlo."
    : "";
}

async function abrirCheckout() {
  if (!carrito.length) return toast("Tu carrito está vacío.", "error");
  if (!pedidoIntento) await cotizarCarrito();
  if (!cotizacionVigente()) return toast(cotizacionError || "No hay una cotización vigente.", "error");
  cerrarCapa($("drawer-carrito"));
  pintarResumenCheckout();
  actualizarEntrega();
  actualizarBloqueoCheckout();
  $("checkout-error").textContent = "";
  abrirCapa("modal-checkout", pedidoIntento ? "btn-confirmar-pedido" : "checkout-nombre");
}

function construirPedido() {
  const nombre = $("checkout-nombre").value.trim();
  const telefono = $("checkout-telefono").value.trim();
  const email = $("checkout-email").value.trim();
  const tipoEntrega = $("checkout-entrega").value;
  const direccion = $("checkout-direccion").value.trim();
  const notas = $("checkout-notas").value.trim();
  if (nombre.length < 2) throw new Error("Escribe el nombre completo.");
  if (telefono.length < 7) throw new Error("Escribe un teléfono válido.");
  if (email && !$("checkout-email").validity.valid) throw new Error("Revisa el correo electrónico.");
  if (!["ENVIO", "RECOLECCION"].includes(tipoEntrega)) throw new Error("Selecciona una forma de entrega.");
  if (tipoEntrega === "ENVIO" && direccion.length < 5) throw new Error("Escribe la dirección de entrega.");
  const cliente = { nombre, telefono };
  if (email) cliente.email = email;
  if (tipoEntrega === "ENVIO") cliente.direccion = direccion;
  const body = {
    cliente,
    tipo_entrega: tipoEntrega,
    items: carrito.map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad })),
  };
  if (notas) body.notas = notas;
  return body;
}

function extraerPedido(respuesta) {
  return respuesta && respuesta.pedido ? respuesta.pedido : respuesta;
}

$("btn-iniciar-checkout").addEventListener("click", () => void abrirCheckout());
$("checkout-entrega").addEventListener("change", actualizarEntrega);

$("form-checkout").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (pedidoEnCurso) return;
  $("checkout-error").textContent = "";
  pedidoEnCurso = true;
  actualizarBloqueoCheckout();
  let pedidoCreado = null;
  try {
    if (!pedidoIntento) {
      await cotizarCarrito();
      if (!cotizacionVigente()) throw new Error(cotizacionError || "No hay una cotización vigente.");
      pedidoIntento = {
        clave: claveAleatoria(),
        body: construirPedido(),
        firma_carrito: firmaCarrito(),
      };
    }
    if (pedidoIntento.firma_carrito !== firmaCarrito()) {
      throw new Error("El carrito cambió después de iniciar el pedido.");
    }
    const respuesta = await api("/pedidos", {
      method: "POST",
      usarToken: true,
      idempotencia: pedidoIntento.clave,
      body: pedidoIntento.body,
    });
    pedidoCreado = extraerPedido(respuesta);
    if (!pedidoCreado || !pedidoCreado.folio) throw new Error("El servidor no devolvió el folio del pedido.");
    pedidoIntento = null;
    carrito = [];
    guardarCarrito();
    cotizacion = null;
    cotizacionFirma = "";
    cotizacionError = "";
    cotizacionVersion++;
    guardarAlmacen(LAST_ORDER_KEY, texto(pedidoCreado.folio));
    $("form-checkout").reset();
    aplicarTiposEntrega();
    pintarCarrito();
  } catch (error) {
    if (error.status && error.status < 500) {
      pedidoIntento = null;
      void cotizarCarrito();
    }
    $("checkout-error").textContent = pedidoIntento
      ? error.message + " Puedes reintentar con la misma clave sin duplicar el pedido."
      : error.message;
  } finally {
    pedidoEnCurso = false;
    actualizarBloqueoCheckout();
  }
  if (pedidoCreado) {
    cerrarCapa($("modal-checkout"));
    mostrarPedido(pedidoCreado, true);
    toast("Pedido " + texto(pedidoCreado.folio) + " creado.", "ok");
  }
});

const ETIQUETAS_ESTADO = Object.freeze({
  PENDIENTE: "Pendiente",
  RESERVADO: "Stock reservado",
  LISTO: "Listo para entregar",
  COMPLETADO: "Completado",
  CANCELADO: "Cancelado",
  EXPIRADO: "Expirado",
});

function fechaHora(valor) {
  if (!valor) return "—";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleString("es-MX", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function estadoSeguro(valor) {
  const estado = texto(valor).toUpperCase();
  return Object.prototype.hasOwnProperty.call(ETIQUETAS_ESTADO, estado) ? estado : "PENDIENTE";
}

function detallePedido(pedido) {
  if (Array.isArray(pedido.detalle)) return pedido.detalle;
  if (Array.isArray(pedido.items)) return pedido.items;
  return [];
}

function pintarLineasPedido(contenedor, pedido) {
  const lineas = detallePedido(pedido);
  const lista = nodo("div", "order-lines");
  for (const linea of lineas) {
    const cantidad = numero(linea.cantidad);
    const precioLista = numero(linea.precio_lista, numero(linea.precio_unitario));
    const precioFinal = numero(linea.precio_unitario, precioLista);
    const fila = nodo("div", "order-line");
    const descripcion = nodo("div", "");
    descripcion.append(
      nodo("strong", "", texto(linea.producto_titulo ?? linea.titulo, "Producto")),
      nodo("small", "", cantidad + " × " + dinero(precioFinal))
    );
    const importe = linea.importe != null ? numero(linea.importe) : cantidad * precioFinal;
    fila.append(descripcion, nodo("strong", "", dinero(importe)));
    if (precioLista > precioFinal) {
      fila.appendChild(nodo("small", "order-discount", "Lista " + dinero(precioLista) + " · descuento " + dinero(precioLista - precioFinal) + " c/u"));
    }
    lista.appendChild(fila);
  }
  if (!lineas.length) lista.appendChild(nodo("p", "empty-state", "El pedido no contiene detalle visible."));
  contenedor.appendChild(lista);
}

function mostrarPedido(pedido, confirmacion = false) {
  pedidoConsultado = pedido;
  const estado = estadoSeguro(pedido.estado);
  $("pedido-modal-titulo").textContent = confirmacion ? "Pedido confirmado" : "Pedido " + texto(pedido.folio);
  $("consulta-folio").value = texto(pedido.folio);
  $("pedido-error").textContent = "";

  const resultado = $("pedido-resultado");
  resultado.replaceChildren();
  const cabecera = nodo("section", "order-hero");
  cabecera.append(
    nodo("span", "order-status status-" + estado.toLowerCase(), ETIQUETAS_ESTADO[estado]),
    nodo("h3", "", texto(pedido.folio)),
    nodo("p", "", confirmacion
      ? "Tu pedido fue creado y el stock quedó reservado."
      : "Consulta actualizada del pedido.")
  );
  resultado.appendChild(cabecera);

  const datos = nodo("dl", "order-data");
  const pares = [
    ["Creado", fechaHora(pedido.creado_en)],
    ["Entrega", pedido.tipo_entrega === "ENVIO" ? "Envío" : "Recolección en tienda"],
    ["Cliente", texto(pedido.cliente_nombre)],
    ["Teléfono", texto(pedido.cliente_telefono)],
    ["Total", dinero(pedido.total)],
  ];
  if (pedido.expira_en && !["COMPLETADO", "CANCELADO", "EXPIRADO"].includes(estado)) {
    pares.push(["Reserva hasta", fechaHora(pedido.expira_en)]);
  }
  for (const [termino, valor] of pares) {
    datos.append(nodo("dt", "", termino), nodo("dd", "", valor));
  }
  resultado.appendChild(datos);
  pintarLineasPedido(resultado, pedido);

  const historial = Array.isArray(pedido.transiciones) ? pedido.transiciones : [];
  if (historial.length) {
    const bloque = nodo("section", "timeline");
    bloque.appendChild(nodo("h3", "", "Historial"));
    for (const transicion of historial) {
      const item = nodo("div", "timeline-item");
      item.append(
        nodo("strong", "", ETIQUETAS_ESTADO[estadoSeguro(transicion.estado_nuevo ?? transicion.estado)]),
        nodo("span", "", fechaHora(transicion.creado_en || transicion.fecha))
      );
      bloque.appendChild(item);
    }
    resultado.appendChild(bloque);
  }

  const whatsapp = $("pedido-whatsapp");
  const whatsappUrl = urlHttp(pedido.whatsapp_url);
  whatsapp.classList.toggle("hidden", !whatsappUrl);
  if (whatsappUrl) whatsapp.href = whatsappUrl;
  else whatsapp.removeAttribute("href");

  const cancelable = ["PENDIENTE", "RESERVADO", "LISTO"].includes(estado);
  $("pedido-cancelacion").classList.toggle("hidden", !cancelable);
  $("cancelacion-motivo").value = "";
  cancelacionIntento = null;
  actualizarBloqueoCancelacion();
  abrirCapa("modal-pedido", confirmacion ? "pedido-whatsapp" : "consulta-folio");
}

async function consultarPedido(folio) {
  const limpio = texto(folio).trim();
  if (!limpio) {
    $("pedido-error").textContent = "Escribe el folio del pedido.";
    return;
  }
  if (consultaEnCurso) return;
  consultaEnCurso = true;
  $("btn-consultar-folio").disabled = true;
  $("btn-consultar-folio").textContent = "Consultando…";
  $("pedido-error").textContent = "";
  try {
    const pedido = extraerPedido(await api("/pedidos/" + encodeURIComponent(limpio), { usarToken: true }));
    if (!pedido || !pedido.folio) throw new Error("No fue posible leer el pedido.");
    guardarAlmacen(LAST_ORDER_KEY, texto(pedido.folio));
    mostrarPedido(pedido, false);
  } catch (error) {
    pedidoConsultado = null;
    $("pedido-resultado").replaceChildren(nodo("p", "empty-state", "No se encontró un pedido propio con ese folio."));
    $("pedido-cancelacion").classList.add("hidden");
    $("pedido-whatsapp").classList.add("hidden");
    $("pedido-error").textContent = error.message;
  } finally {
    consultaEnCurso = false;
    $("btn-consultar-folio").disabled = false;
    $("btn-consultar-folio").textContent = "Consultar";
  }
}

$("btn-consultar-pedido").addEventListener("click", () => {
  const ultimo = leerAlmacen(LAST_ORDER_KEY) || "";
  $("consulta-folio").value = ultimo;
  $("pedido-error").textContent = "";
  if (!pedidoConsultado) {
    $("pedido-resultado").replaceChildren(nodo("p", "empty-state", "Captura el folio para consultar un pedido creado en este navegador."));
    $("pedido-cancelacion").classList.add("hidden");
    $("pedido-whatsapp").classList.add("hidden");
  }
  abrirCapa("modal-pedido", "consulta-folio");
  if (ultimo) void consultarPedido(ultimo);
});

$("form-consulta-pedido").addEventListener("submit", (evento) => {
  evento.preventDefault();
  void consultarPedido($("consulta-folio").value);
});

function actualizarBloqueoCancelacion() {
  const congelado = Boolean(cancelacionIntento);
  $("cancelacion-motivo").disabled = cancelacionEnCurso || congelado;
  $("btn-cancelar-pedido").disabled = cancelacionEnCurso;
  $("btn-cancelar-pedido").textContent = cancelacionEnCurso
    ? "Cancelando…" : congelado ? "Reintentar cancelación" : "Cancelar pedido";
}

$("form-cancelar-pedido").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!pedidoConsultado || cancelacionEnCurso) return;
  $("pedido-error").textContent = "";
  try {
    if (!cancelacionIntento) {
      const motivo = $("cancelacion-motivo").value.trim();
      if (motivo.length < 3) throw new Error("Escribe un motivo de al menos 3 caracteres.");
      if (!confirm("¿Cancelar este pedido y liberar sus unidades reservadas?")) return;
      cancelacionIntento = { clave: claveAleatoria(), body: { motivo } };
    }
    cancelacionEnCurso = true;
    actualizarBloqueoCancelacion();
    const folio = texto(pedidoConsultado.folio);
    const respuesta = await api("/pedidos/" + encodeURIComponent(folio) + "/cancelacion", {
      method: "POST",
      usarToken: true,
      idempotencia: cancelacionIntento.clave,
      body: cancelacionIntento.body,
    });
    let actualizado = extraerPedido(respuesta);
    try {
      actualizado = extraerPedido(await api("/pedidos/" + encodeURIComponent(folio), { usarToken: true }));
    } catch (_) { /* la cancelación ya fue confirmada */ }
    cancelacionIntento = null;
    if (actualizado && actualizado.folio) mostrarPedido(actualizado, false);
    else {
      pedidoConsultado = { ...pedidoConsultado, estado: "CANCELADO" };
      mostrarPedido(pedidoConsultado, false);
    }
    toast("Pedido cancelado y reserva liberada.", "ok");
  } catch (error) {
    if (error.status && error.status < 500) cancelacionIntento = null;
    $("pedido-error").textContent = cancelacionIntento
      ? error.message + " Reintenta para confirmar la misma cancelación."
      : error.message;
  } finally {
    cancelacionEnCurso = false;
    actualizarBloqueoCancelacion();
  }
});

async function iniciarTienda() {
  pintarCarrito();
  await Promise.all([cargarConfiguracion(), cargarCategorias()]);
  aplicarTiposEntrega();
  await cargarCatalogo();
  if (carrito.length) void cotizarCarrito();
}

void iniciarTienda();
