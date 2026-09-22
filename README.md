# Librería REM

Sistema integrado para librería con una sola fuente de datos para el punto de venta y la tienda en línea:

- frontend estático en HTML, CSS y JavaScript;
- backend CommonJS en Node.js y Express;
- base de datos PostgreSQL;
- POS con autenticación, permisos por rol, multicaja y sesiones de caja;
- ventas idempotentes, cancelaciones y devoluciones transaccionales;
- inventario común con existencias física, reservada, consignada y disponible, ajustes y kardex inmutable;
- reposición calculada con mínimos, objetivos y mercancía pendiente por recibir;
- conteos físicos auditables con capturas, detección de cambios y aplicación al kardex;
- catálogo administrable con categorías, publicación web, imágenes y descripciones comerciales;
- ficha bibliográfica estructurada e importación masiva CSV con previsualización auditable;
- precios y descuentos calculados por las mismas reglas para POS y web, con segmentos público y mayoreo;
- directorio de clientes, cotizaciones persistentes, pedidos, reservas atómicas de stock y estados de pedido;
- proveedores, órdenes de compra, recepciones parciales y devoluciones al proveedor;
- reportes conciliables de ventas, inventario, compras, pedidos y caja, con filtros y exportación CSV;
- gestión editorial de obras, colaboradores, contratos, tirajes, costos, regalías y liquidaciones;
- consignaciones a librerías y distribuidores dentro del mismo inventario y catálogo;
- tienda pública con carrito, entrega o recolección y seguimiento del pedido;
- aviso manual al cliente y enlace opcional de seguimiento por WhatsApp;
- cobro de pedidos web en el POS sin descontar el inventario dos veces;
- configuración para servir frontend y API desde un solo dominio.

El POS está disponible en `/` y la tienda pública en `/tienda.html`. Ambos consumen la misma API y las mismas tablas; no existe una sincronización separada o simulada.

## Estructura

```text
libra-pos/
├── backend/
│   ├── database/
│   │   ├── migrations/
│   │   │   ├── 001_multicaja_idempotencia.sql
│   │   │   ├── 002_cancelaciones_devoluciones.sql
│   │   │   ├── 003_inventario_kardex.sql
│   │   │   ├── 004_catalogo_precios.sql
│   │   │   ├── 005_clientes_pedidos_reservas.sql
│   │   │   ├── 006_tienda_publica.sql
│   │   │   ├── 007_multiples_pedidos_publicos.sql
│   │   │   ├── 008_reembolsos_no_efectivo.sql
│   │   │   ├── 009_proveedores_compras.sql
│   │   │   ├── 010_catalogo_bibliografico_importaciones.sql
│   │   │   ├── 011_reposicion_conteos.sql
│   │   │   ├── 012_reportes_operativos.sql
│   │   │   ├── 013_clientes_cotizaciones_mayoreo.sql
│   │   │   ├── 014_editorial_obras_contratos.sql
│   │   │   ├── 015_editorial_tirajes_costos.sql
│   │   │   ├── 016_editorial_regalias_liquidaciones.sql
│   │   │   ├── 017_editorial_consignaciones.sql
│   │   │   ├── 018_caja_apertura_estado.sql
│   │   │   └── 019_productos_integridad_busqueda.sql
│   │   └── schema.sql
│   ├── src/
│   │   ├── config/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── scripts/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── app.js
│   │   └── server.js
│   ├── test/
│   │   ├── helpers/
│   │   └── integration/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── app.js
│   ├── index.html
│   ├── styles.css
│   ├── tienda.html
│   ├── tienda.js
│   ├── tienda.css
│   └── package.json
├── .dockerignore
├── .gitignore
├── package-lock.json
├── package.json
├── README.md
└── zbpack.json
```

El frontend es JavaScript puro y no necesita compilación. Sus dependencias están vacías de forma intencional.

## Funcionalidad actual

### Punto de venta

- Inicio de sesión con sesión por pestaña, restauración segura al recargar y permisos reales para operaciones sensibles.
- Apertura, movimientos y cierre por usuario, caja y sesión exactos.
- Ingresos y retiros manuales con concepto, responsable, validación en centavos e idempotencia recuperable tras recargar; no se permite retirar más efectivo del disponible.
- Soporte para varias cajas sin mezclar sesiones ni movimientos.
- Recuperación automática de la caja abierta por el usuario al recargar o volver a abrir el POS, sin que respuestas atrasadas de otra caja reemplacen su estado.
- Venta con búsqueda por ISBN o código, carrito, ticket y descuento de stock.
- Protección contra doble clic y repetición de solicitudes mediante idempotencia.
- Cancelación total y devolución parcial transaccionales, con reversión coordinada de inventario y caja.
- Consulta de pedidos y carga de un pedido reservado a caja. El cobro consume la reserva existente y descuenta la existencia física una sola vez.

### Inventario, catálogo y pedidos

- Kardex inmutable con motivo, usuario y fecha.
- Ajustes de inventario auditables.
- Existencia física en tienda, reservada, consignada, disponible y propiedad total calculadas en PostgreSQL.
- Categorías, imágenes, descripciones comerciales y visibilidad específica para la tienda.
- Reglas compartidas de precios y descuentos para los canales `POS` y `WEB`.
- Clientes, pedidos internos o web, reservas atómicas y registro de transiciones de estado.
- Cancelación y expiración de pedidos con liberación transaccional de la reserva.

### Catálogo bibliográfico e importación

- ISBN-10 e ISBN-13 normalizados y validados, con detección de duplicados sin invalidar registros heredados.
- Ficha bibliográfica con subtítulo, edición, año, idioma, páginas, encuadernación, formato, colección, serie y volumen.
- Autores, traductores, ilustradores, editores y materias estructurados, manteniendo compatible el campo de autor del catálogo existente.
- Importación CSV para crear o actualizar por SKU, con plantilla descargable, previsualización, filtros por resultado y confirmación explícita.
- Auditoría inmutable de archivo, filas y resultados; la confirmación es transaccional, idempotente y detecta cambios concurrentes.
- La importación modifica únicamente datos de catálogo: nunca altera existencias, reservas, kardex, publicación, imágenes ni URL pública.

### Reposición y conteos físicos

- Políticas por producto con existencia mínima, objetivo y proveedor preferido, manteniendo un historial auditable de cada cambio.
- Sugerencias de reposición calculadas con la existencia disponible y las unidades pendientes de recibir en órdenes de compra abiertas.
- Envío de las sugerencias seleccionadas al formulario normal de órdenes de compra, sin crear un flujo de compras separado.
- Conteos en borrador con capturas inmutables por producto, usuario y fecha; capturar nunca modifica la existencia.
- Aplicación atómica solo cuando no hubo movimientos ni cambios de saldo desde la captura; si los hubo, se exige volver a contar.
- Diferencias aplicadas mediante movimientos `CONTEO` en el mismo kardex omnicanal, preservando las reservas de clientes.
- Cancelación y aplicación idempotentes, con permisos exclusivos para `ADMIN` y `SUPERVISOR`.

### Tienda en línea

- Catálogo público de productos publicados con fotos, categorías, precio y disponibilidad.
- Búsqueda, detalle de producto y carrito persistente en el navegador.
- Cotización en el servidor y creación idempotente de pedidos.
- Un mismo navegador puede crear varios pedidos manteniendo su propiedad privada mediante una credencial opaca.
- Entrega a domicilio o recolección en tienda.
- Consulta del estado y cancelación del pedido por el mismo carrito que lo creó.
- El operador puede abrir desde el pedido un aviso prellenado dirigido al WhatsApp del cliente.
- Cuando `STORE_WHATSAPP_NUMBER` está configurado, el cliente también puede abrir un enlace de seguimiento dirigido a la librería. La aplicación usa enlaces `wa.me`; no simula un envío automático ni requiere un proveedor externo.

### Proveedores y compras

- Proveedores con datos comerciales, contacto, búsqueda y baja lógica.
- Órdenes de compra auditables con costos, IVA, referencias y partidas inmutables.
- Recepciones parciales o totales que actualizan la existencia física y el último costo recibido.
- Cancelación de una orden emitida o de su remanente parcial sin revertir mercancía ya recibida.
- Devoluciones al proveedor ligadas a la recepción exacta, sin tomar unidades reservadas para clientes.
- Movimientos `RECEPCION_COMPRA` y `DEVOLUCION_PROVEEDOR` en el mismo kardex omnicanal.
- Permisos exclusivos para `ADMIN` y `SUPERVISOR`, reintentos idempotentes y protección de concurrencia.

### Reportes operativos

- Panel administrativo con reportes de ventas, inventario actual, compras, pedidos y caja, usando directamente los documentos y movimientos originales.
- Filtros por periodo inclusivo, caja, actor, operador, método, canal, estado, categoría y proveedor según el reporte.
- Ventas netas conciliadas con cancelaciones y devoluciones en la fecha, caja y usuario donde realmente ocurrieron.
- Inventario con existencias física, reservada, disponible y en tránsito, además de valuación y necesidad de reposición calculada con la misma fórmula operativa.
- Compras recibidas menos devoluciones al proveedor; las órdenes abiertas se muestran por separado como compromisos actuales.
- Pedidos separados de los ingresos: un importe solicitado no se considera venta hasta que existe el cobro vinculado.
- Caja con fondos de apertura, ventas por método, reversos, flujo de efectivo, cortes y sesiones abiertas, distinguiendo actor del movimiento y operador de sesión.
- Exportación CSV autenticada, protegida contra fórmulas de hoja de cálculo y limitada a 20,000 filas exactas por archivo.
- Acceso exclusivo para `ADMIN` y `SUPERVISOR`, lectura consistente de PostgreSQL y respuestas marcadas para no almacenarse en caché.

### Clientes, cotizaciones y mayoreo

- Directorio común de clientes activos o inactivos, con búsqueda, datos de contacto y baja lógica.
- Segmentos `PUBLICO` y `MAYOREO`; solo `ADMIN` y `SUPERVISOR` pueden asignar o modificar el segmento mayorista.
- Reglas de precio por segmento dentro del mismo motor que usa el POS y la tienda: no existe una lista ni una sincronización de precios separada.
- Selección de cliente registrado en el carrito del POS, cálculo del precio en servidor y asociación de la venta con una copia histórica del cliente y su segmento.
- Cotizaciones persistentes e idempotentes con cliente, partidas, precios, descuento, vigencia, notas e historial inmutable.
- Crear o cancelar una cotización nunca modifica el inventario; convertirla en pedido reserva el stock de forma atómica una sola vez.
- Conversión sin recalcular precios: el pedido conserva exactamente las partidas y valores aceptados en la cotización.
- Cancelación y procesamiento de vencimientos sin liberar unidades inexistentes, además de protección frente a conversiones concurrentes.
- Carga del pedido resultante en caja mediante el flujo normal de pedidos, evitando descontar el inventario dos veces.
- Interfaz segura sin inserción de contenido HTML procedente de clientes, productos o notas.

### Editorial, producción, regalías y distribución

- Área **Editorial** para `ADMIN` y `SUPERVISOR`, dividida en obras, colaboradores, contratos, tirajes, regalías y consignaciones.
- Expediente de obra con estado editorial, colaboradores por función y vínculo de una o varias ediciones del catálogo comercial.
- Directorio reutilizable de autores y demás colaboradores, con activación y baja lógica.
- Contratos editoriales administrados exclusivamente por `ADMIN`, con vigencia, condiciones económicas e historial de transiciones.
- Tirajes en borrador con proveedor, edición, cantidad y costos de producción desglosados; su confirmación incorpora las unidades al mismo inventario y kardex que usa el POS y la tienda.
- Cuentas y estados de regalías calculados desde eventos comerciales comunes de `POS`, `WEB` y `CONSIGNACION`, con emisión, pago, cancelación e historial auditable.
- Consignaciones para clientes comerciales de tipo librería, distribuidor o institución, con envío, reporte de venta, devolución de sobrantes, conciliación y cierre.
- El inventario distingue unidades en tienda y consignadas, pero ambas forman parte de la propiedad total; no existe un inventario paralelo ni una sincronización simulada.
- Todas las operaciones sensibles usan permisos de servidor, transacciones, claves de idempotencia y contenido de interfaz tratado como texto.

## Requisitos locales

- Node.js 24 LTS y npm 11.17.0, fijados en `package.json` para repetir el mismo entorno.
- PostgreSQL 15 o posterior.
- El comando `psql` disponible en la terminal, o pgAdmin para crear la base.

Descargas oficiales: [Node.js](https://nodejs.org/en/download) y [PostgreSQL para Windows](https://www.postgresql.org/download/windows/).

## Instalación local exacta en Windows

Abre PowerShell en la carpeta `libra-pos` y ejecuta:

```powershell
Copy-Item .\backend\.env.example .\backend\.env
npm.cmd ci
```

Si PowerShell bloquea los scripts de `npm`, usa `npm.cmd` en los comandos de esta guía, por ejemplo `npm.cmd ci` y `npm.cmd run dev`.

Genera un secreto JWT:

```powershell
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
```

Abre `backend\.env` y sustituye todos los valores que comienzan con `CAMBIA_`. Debe quedar con valores reales equivalentes a estos:

```dotenv
DATABASE_URL=postgresql://postgres:TU_PASSWORD_POSTGRES@localhost:5432/libra_pos
PGSSL=0
JWT_SECRET=PEGA_AQUI_EL_SECRETO_ALEATORIO
JWT_EXPIRES=8h
SEED_ADMIN_PASSWORD=UNA_CLAVE_ADMIN_DE_12_A_72_CARACTERES
SEED_CASHIER_PASSWORD=UNA_CLAVE_CAJA_DE_12_A_72_CARACTERES
PORT=4000
TRUST_PROXY=0
RESERVATION_TTL_MINUTES=30
# STORE_WHATSAPP_NUMBER=5210000000000
```

`STORE_WHATSAPP_NUMBER` es opcional. Usa únicamente dígitos, incluido el código de país, sin `+`, espacios ni guiones. El número del ejemplo es ficticio.

Si la contraseña de PostgreSQL contiene caracteres especiales como `@`, `:`, `/`, `?` o `#`, codifícalos para URL dentro de `DATABASE_URL`.

Crea la base vacía:

```powershell
psql -U postgres -c "CREATE DATABASE libra_pos;"
```

Si `psql` no está en `PATH`, ejecuta la misma sentencia `CREATE DATABASE libra_pos;` desde Query Tool de pgAdmin.

Crea el esquema, aplica las migraciones y genera los datos mínimos:

```powershell
npm.cmd run db:setup
```

Este comando es idempotente y hace dos cosas:

1. `db:init` crea o verifica el esquema base y aplica, en orden, las migraciones pendientes.
2. `db:seed` crea los roles `ADMIN`, `SUPERVISOR` y `CAJERO`, la caja `1`, `admin@libra.mx` y `caja@libra.mx`.

Las claves son las que configuraste en `SEED_ADMIN_PASSWORD` y `SEED_CASHIER_PASSWORD`. Si los usuarios ya existen, el seed no cambia sus contraseñas.

El POS conserva únicamente el token de acceso en `sessionStorage`: una recarga valida de nuevo el usuario activo y su rol con PostgreSQL, mientras que **Salir** elimina el token y la contraseña del formulario. El backend vuelve a consultar el estado y el rol en cada petición protegida, por lo que desactivar una cuenta o cambiar su rol surte efecto inmediato. El cierre es local al navegador; un token copiado fuera de la aplicación conserva su vigencia hasta expirar según `JWT_EXPIRES`.

En una base ya inicializada, aplica únicamente las migraciones nuevas con:

```powershell
npm.cmd run db:migrate
```

El ejecutor registra cada migración y su huella en `schema_migrations`; una migración aplicada no debe editarse después.

Arranca el entorno de desarrollo:

```powershell
npm.cmd run dev
```

Abre el POS en [http://localhost:4000](http://localhost:4000) y la tienda en [http://localhost:4000/tienda.html](http://localhost:4000/tienda.html). Para simular el arranque de producción local usa:

```powershell
npm.cmd start
```

Detén el servidor con `Ctrl+C`. Si Windows pregunta `¿Desea terminar el trabajo por lotes (S/N)?`, escribe `S` y presiona Enter.

Antes de abrir el puerto, el servidor comprueba que PostgreSQL responda. Si la base no está disponible, el arranque termina con un error claro en lugar de presentar la aplicación como lista.

## Pruebas

Con PostgreSQL disponible y `DATABASE_URL` configurada en `backend/.env`, ejecuta desde la raíz:

```powershell
npm.cmd test
```

Las pruebas de integración cubren autenticación, sesión, expiración y algoritmo de tokens, usuarios activos, cambios de rol, permisos y política de contraseñas. La apertura y recuperación de caja se comprueban con fondos y cajas inválidos, doble apertura secuencial y concurrente, rollback, permisos, persistencia, aislamiento multicaja e invariantes de PostgreSQL. La prueba integral final enlaza login, apertura, carrito, cobro, venta, inventario, ticket, consulta y cierre en una sola sesión. Los movimientos manuales se comprueban con conciliación multicaja, importes inválidos, permisos, sobregiro, idempotencia, concurrencia y fallo transaccional. El cierre y corte se comprueban con conciliación de medios de pago, diferencia, permisos, persistencia, idempotencia, concurrencia y rollback. La batería cubre además la preparación del carrito, consolidación de productos repetidos, límites de cantidades, totales, disponibilidad compartida y reservas; cobro en efectivo, tarjeta y transferencia, importes y cambio en centavos, límites monetarios y de partidas, cancelación previa, protección contra doble clic, recuperación tras recarga e idempotencia; registro integral de la venta con conciliación de encabezado, partidas, precios, inventario, kardex y caja, además de copias históricas de producto estables; cancelaciones, devoluciones por todos los medios de pago y concurrencia; kardex y ajustes, catálogo y precios, clientes, pedidos, tienda pública, cobro de pedidos en el POS, proveedores, órdenes de compra, recepciones y devoluciones al proveedor, ficha bibliográfica, importación CSV, políticas y sugerencias de reposición, conteos físicos, detección de capturas obsoletas y aplicación concurrente exacta. También verifica segmentos público y mayoreo resueltos en servidor, cotizaciones persistentes, copias históricas exactas, conversión con una sola reserva, cancelación y vencimiento sin movimientos de stock, cobro posterior sin doble salida y carreras entre conversiones. Comprueba asimismo la conciliación de los cinco reportes, filtros multicaja y por actor, separación de pedidos y compromisos, periodos con zona horaria, permisos, paginación y exportación CSV segura. Las suites editoriales validan obras, colaboradores, contratos, tirajes, costos, entradas de inventario, cuentas y liquidaciones de regalías, consignaciones, ventas, devoluciones, conciliación, permisos y carreras transaccionales. Una prueba de infraestructura adicional exige PostgreSQL, comprueba el endpoint de disponibilidad, el aislamiento CORS, el frontend servido y el fallo controlado de arranque sin base. Actualmente son **160 pruebas de integración**, todas ejecutadas contra un esquema PostgreSQL temporal y aislado que se elimina al finalizar.

## Migraciones versionadas

| Versión | Alcance |
|---|---|
| `001_multicaja_idempotencia` | Asociación exacta de usuario, caja y sesión; controles multicaja e idempotencia. |
| `002_cancelaciones_devoluciones` | Cancelaciones y devoluciones con sus reversiones transaccionales. |
| `003_inventario_kardex` | Existencias física, reservada y disponible; kardex y ajustes inmutables. |
| `004_catalogo_precios` | Catálogo comercial, categorías, imágenes y reglas compartidas de precios. |
| `005_clientes_pedidos_reservas` | Clientes, pedidos, transiciones de estado y reservas atómicas. |
| `006_tienda_publica` | Identidad opaca del carrito público y propiedad segura de pedidos web. |
| `007_multiples_pedidos_publicos` | Permite varios pedidos por credencial pública sin perder su aislamiento. |
| `008_reembolsos_no_efectivo` | Registra por separado devoluciones de tarjeta y transferencia en el estado y corte de caja. |
| `009_proveedores_compras` | Proveedores, órdenes de compra, recepciones, devoluciones y movimientos de inventario asociados. |
| `010_catalogo_bibliografico_importaciones` | Ficha bibliográfica estructurada, validación de ISBN e importaciones CSV previsualizadas, auditables e idempotentes. |
| `011_reposicion_conteos` | Políticas y sugerencias de reposición; conteos físicos capturados, auditados y aplicados al kardex con control de concurrencia. |
| `012_reportes_operativos` | Índices para reportes conciliables sobre ventas, inventario, compras, pedidos y caja, sin tablas acumuladas ni fuentes paralelas. |
| `013_clientes_cotizaciones_mayoreo` | Segmentos de cliente, reglas mayoristas, copias históricas en ventas y pedidos, cotizaciones inmutables y conversión atómica a reservas. |
| `014_editorial_obras_contratos` | Obras editoriales, colaboradores, ediciones vinculadas, contratos, condiciones económicas e historiales. |
| `015_editorial_tirajes_costos` | Tirajes, costos de producción, confirmación transaccional y entrada al inventario común. |
| `016_editorial_regalias_liquidaciones` | Eventos comerciales para regalías, cuentas por contrato, estados de cuenta y transiciones auditables. |
| `017_editorial_consignaciones` | Clasificación comercial de clientes, expedientes de consignación, inventario consignado y conciliación por movimientos. |
| `018_caja_apertura_estado` | Fechas coherentes por estado, apertura y cierre únicos por sesión, recuperación de la caja propia e índice de sesiones abiertas por usuario. |
| `019_productos_integridad_busqueda` | SKU, título, código e importes dentro del rango operativo incluso ante escrituras directas; búsqueda validada por identificadores y texto. |

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---:|---|
| `DATABASE_URL` | Sí | Cadena completa de conexión PostgreSQL. |
| `JWT_SECRET` | Sí | Firma de tokens de acceso. Usa un valor aleatorio largo. |
| `SEED_ADMIN_PASSWORD` | Solo al crear el admin | Contraseña inicial de `admin@libra.mx`. |
| `SEED_CASHIER_PASSWORD` | Solo al crear el cajero | Contraseña inicial de `caja@libra.mx`. |
| `PGSSL` | No | `1` activa TLS sin validar el certificado; `0` lo desactiva. |
| `JWT_EXPIRES` | No | Duración del token. Por defecto: `8h`. |
| `PORT` | No | Puerto local. Por defecto: `4000`; Zeabur lo inyecta. |
| `CORS_ORIGIN` | No | Orígenes externos permitidos, separados por coma. Si se omite, la aplicación funciona únicamente desde su mismo origen. |
| `TRUST_PROXY` | En Zeabur | Usa `1` detrás del proxy de la nube y `0` localmente. |
| `RESERVATION_TTL_MINUTES` | No | Vigencia de una reserva, entre 5 y 1440 minutos. Por defecto: `30`. |
| `STORE_WHATSAPP_NUMBER` | No | Número de la librería en formato internacional, solo dígitos; habilita el enlace de seguimiento. |

Nunca subas `backend/.env` al repositorio; ya está excluido mediante `.gitignore`. No compartas contraseñas ni secretos del archivo.

## Despliegue exacto en Zeabur

Esta sección queda como documentación para un despliegue futuro; seguirla modifica servicios externos.

### 1. Sube la carpeta a GitHub

Desde la raíz `libra-pos`:

```powershell
git init
git add .
git commit -m "Organiza Librería REM para despliegue"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Omite `git init` y `git remote add` si el repositorio ya existe.

### 2. Crea PostgreSQL

1. Crea un proyecto en Zeabur.
2. Selecciona **Add Service → Databases → PostgreSQL**.
3. Espera a que el servicio de PostgreSQL esté listo.

### 3. Despliega la aplicación

1. En el mismo proyecto selecciona **Add Service → GitHub**.
2. Autoriza GitHub y elige el repositorio.
3. Deja **Root Directory** en `/`. No uses `/backend`, porque el servidor necesita acceder también a la carpeta hermana `frontend`.
4. Zeabur detectará Node 24 y npm 11.17.0 desde `package.json`. `zbpack.json` indica `npm start`; no hay comando de build porque el frontend no se compila.

### 4. Configura las variables del servicio Node

En **Variables** agrega:

```dotenv
NODE_ENV=production
DATABASE_URL=${POSTGRES_CONNECTION_STRING}
PGSSL=0
JWT_SECRET=UN_SECRETO_ALEATORIO_LARGO_Y_UNICO
JWT_EXPIRES=8h
TRUST_PROXY=1
RESERVATION_TTL_MINUTES=30
STORE_WHATSAPP_NUMBER=5210000000000
SEED_ADMIN_PASSWORD=UNA_CLAVE_ADMIN_SEGURA_DE_12_A_72_CARACTERES
SEED_CASHIER_PASSWORD=UNA_CLAVE_CAJA_SEGURA_DE_12_A_72_CARACTERES
```

El número de WhatsApp mostrado es ficticio: sustitúyelo o elimina la variable. No definas `PORT`: Zeabur lo proporciona automáticamente.

La plantilla actual de PostgreSQL expone `POSTGRES_CONNECTION_STRING`. Si la pestaña **Variables** de tu servicio muestra otro nombre, inserta esa referencia mediante el selector de variables de Zeabur en lugar de escribir una conexión pública.

### 5. Inicializa PostgreSQL una sola vez

Cuando el despliegue Node haya terminado, abre la ejecución de comandos del servicio y ejecuta:

```powershell
npm run db:setup
```

Confirma en los logs los mensajes del esquema, las migraciones `001` a `019` y el seed. Después puedes retirar `SEED_ADMIN_PASSWORD` y `SEED_CASHIER_PASSWORD` de las variables del servicio: la aplicación no las usa durante su funcionamiento normal y el seed no sobrescribe usuarios existentes.

En actualizaciones posteriores que incluyan nuevas migraciones, ejecuta:

```powershell
npm run db:migrate
```

### 6. Publica y comprueba

1. En **Networking/Domains**, genera un dominio `.zeabur.app`.
2. Abre `https://TU_DOMINIO.zeabur.app/api/health`; debe responder un JSON con `"ok": true` y `"database": "ready"`.
3. Abre la raíz del dominio para usar el POS y `/tienda.html` para la tienda pública.
4. Inicia sesión con uno de los usuarios iniciales y la clave que configuraste.
5. Cada nuevo `git push` a la rama conectada volverá a desplegar la aplicación.

Documentación oficial de Zeabur: [Node.js](https://zeabur.com/docs/en-US/guides/nodejs), [integración con GitHub](https://zeabur.com/docs/en-US/deploy/methods/github-integration), [variables](https://zeabur.com/docs/en-US/deploy/config/environment-variables), [PostgreSQL](https://zeabur.com/templates/B20CX0), [ejecución de comandos](https://zeabur.com/docs/en-US/deploy/config/command-execution) y [dominios](https://zeabur.com/docs/en-US/deploy/networking/public-networking).

## Datos iniciales

`db:seed` crea únicamente lo necesario para el primer acceso: los tres roles, la caja `1` y los usuarios `admin@libra.mx` y `caja@libra.mx`. No agrega libros ni categorías ficticios. Al entrar por primera vez, carga categorías y productos desde el catálogo administrativo del POS.
