# Control de verificación — Librería REM

Última actualización: 22 de septiembre de 2026.

Este registro distingue código existente de comportamiento comprobado. Un bloque sólo entra en la lista cuando su flujo crítico fue ejecutado y pasó sus pruebas. Si un cambio posterior afecta un bloque aprobado, deberá marcarse como reabierto y volver a probarse.

## FUNCIONES VERIFICADAS

### Bloque 0 — Auditoría y arranque limpio

- Instalación reproducible con `npm.cmd ci`.
- Inicialización y repetición segura de la base con las migraciones `001` a `019`.
- Inicio de desarrollo y producción con comprobación previa de PostgreSQL.
- Frontend, API, disponibilidad de base de datos, CORS y apagado controlado.
- Pruebas de integración obligatorias: no se omiten si PostgreSQL no está disponible.
- Auditoría de dependencias sin vulnerabilidades conocidas.

Estado: **VERIFICADO**.

### Bloque 1 — Autenticación y usuarios

- Inicio de sesión correcto con email normalizado y contraseña bcrypt.
- Rechazo uniforme de contraseña incorrecta, correo inexistente y usuario inactivo.
- Sesión por pestaña restaurada tras recargar y revalidada mediante `/api/auth/me`.
- Cierre local que elimina token, contraseña y estado operativo del usuario anterior.
- JWT limitado a `HS256`; rechazo de token ausente, malformado, expirado o con otro algoritmo.
- Estado activo y rol consultados en PostgreSQL en cada petición protegida.
- Acceso administrativo a usuarios limitado a `ADMIN`; rechazo de `SUPERVISOR` y `CAJERO`.
- Alta de usuario con contraseña de 12 a 72 caracteres y máximo 72 bytes UTF-8.
- Límite de intentos aplicado sólo al login, sin bloquear revalidaciones legítimas de sesión.
- Contenido dinámico del frontend insertado sin APIs de HTML no escapado.

Estado: **VERIFICADO**.

### Bloque 2 — Apertura y estado de caja

- Apertura atómica con usuario, caja, fondo inicial y fecha exactos.
- Un único movimiento de apertura conciliado con el fondo de la sesión.
- Rechazo de caja inexistente o inactiva y de importes ausentes, negativos, fuera de rango o con más de dos decimales.
- Protección contra aperturas duplicadas secuenciales y concurrentes.
- Rollback total si falla el registro del movimiento de apertura.
- Estado completo para el operador o supervisor y datos monetarios ocultos a otro cajero.
- Lectura consistente de totales y movimientos bajo una misma instantánea PostgreSQL.
- Recuperación automática de la caja propia al recargar o abrir una ventana nueva.
- Selección por usuario recordada durante la pestaña y protección frente a respuestas atrasadas al alternar cajas.
- Coherencia de fechas de apertura/cierre y unicidad de movimientos de apertura/cierre reforzadas por la migración `018`.

Estado: **VERIFICADO**.

### Bloque 3 — Productos e inventario

- Alta transaccional de productos con la existencia inicial registrada una sola vez en el kardex.
- Edición de la ficha sin permitir cambios directos de stock ni crear movimientos de inventario espurios.
- Consulta por detalle y búsqueda por título, autor, editorial, SKU, código de barras e ISBN visible o normalizado.
- ISBN con dígito verificador válido y unicidad por su forma normalizada.
- Precio, costo e IVA limitados a dos decimales; SKU, título, código e importes protegidos también en PostgreSQL por la migración `019`.
- Productos sin stock consultables con saldo físico, reservado y disponible en cero.
- Ajustes positivos y negativos con motivo, usuario, idempotencia, bloqueo por fila y rechazo de saldos negativos o inferiores a las reservas.
- Costo oculto a `CAJERO`; altas, ediciones y ajustes limitados a `ADMIN` y `SUPERVISOR`.
- Paginación y filtros validados, orden estable y búsqueda literal que no interpreta `%` o `_` como comodines.
- Renderizado dinámico con nodos de texto, sin APIs de inserción de HTML no escapado.

Estado: **VERIFICADO**.

### Bloque 4 — Carrito y preparación de venta

- Búsqueda exacta por código o ISBN y búsqueda general protegidas contra respuestas atrasadas, incluidas las que llegan después de cerrar sesión.
- Productos repetidos consolidados en una sola partida; aumento, reducción y eliminación con actualización inmediata del carrito.
- Subtotal sin IVA, descuento, IVA y total calculados por el motor común de precios del servidor, sin cálculos paralelos en el navegador.
- Máximo de 100 productos distintos y 999 unidades por producto, validado de forma coherente en frontend y cotización de precios.
- Rechazo de productos inactivos, inexistentes o sin disponibilidad; la existencia disponible incluye las reservas activas.
- Nueva cotización obligatoria después de cambiar cantidades o inventario; el cobro permanece bloqueado mientras el carrito esté vacío, desactualizado o exceda la disponibilidad.
- Actualización del stock mostrado después de ajustes de inventario y protección adicional del cobro mediante la validación transaccional ya existente.
- Contenido de productos renderizado como texto, sin ejecutar etiquetas o atributos proporcionados por datos comerciales.

Estado: **VERIFICADO**.

### Bloque 5 — Cobro

- Cobro en efectivo exacto o con sobrepago, con cambio calculado y comparado en centavos para evitar errores de redondeo.
- Rechazo de importes negativos, ausentes, no numéricos, con más de dos decimales o fuera del rango monetario admitido.
- Tarjeta y transferencia registradas como métodos no efectivos, con instrucciones distintas para confirmar externamente la aprobación de la terminal o la recepción de la transferencia.
- Recalculo autoritativo de subtotal, IVA y total en el servidor, con límite de 100 partidas distintas y protección frente a desbordamientos monetarios.
- Protección contra doble clic e idempotencia de la solicitud; una respuesta incierta o una recarga conserva la misma clave y permite recuperar el cobro sin duplicar la venta.
- Caja y sesión de caja fijadas desde el inicio del intento de cobro; la selección de caja permanece bloqueada mientras el cobro está en curso o pendiente de recuperación.
- Cancelación antes de confirmar sin escrituras en la base de datos y con conservación del carrito.
- Venta, partidas, inventario y movimiento de caja dentro de una transacción; rollback completo ante un fallo y reintento seguro con la misma clave idempotente.

Estado: **VERIFICADO**.

### Bloque 6 — Registro transaccional de la venta

- Venta, partidas, inventario, kardex, movimiento de caja e idempotencia confirmados dentro de una única transacción PostgreSQL.
- Asociación exacta y persistente de la venta y su movimiento con usuario, caja y sesión de caja.
- Registro conciliado de productos, cantidades, precios de lista, descuentos, precio final, IVA, importes, método de pago, fecha y totales.
- Descuento de inventario y creación de un movimiento de kardex por producto, con el mismo usuario y el saldo físico resultante.
- Un solo movimiento de caja por venta, por el total cobrado y con el método de pago correspondiente.
- Rollback completo comprobado ante un fallo al insertar el movimiento de caja; el mismo intento puede reanudarse sin registros parciales.
- Idempotencia y concurrencia comprobadas: una repetición devuelve la misma venta y dos ventas por la última unidad no pueden consumirla dos veces.
- La consulta histórica usa las copias de SKU y título almacenadas al vender; editar posteriormente el producto ya no altera el registro visible de la venta.

Estado: **VERIFICADO**.

### Bloque 7 — Ticket

- Ticket generado desde la venta confirmada por el servidor, con marca, folio, fecha, caja, cajero, cliente, partidas, cantidades, precios, descuentos, subtotal, IVA, total y método de pago.
- En efectivo muestra el importe recibido y el cambio; con tarjeta no inventa esos importes.
- El contenido comercial se inserta como texto, sin interpretar etiquetas proporcionadas en el título de un producto.
- La copia imprimible conserva el mismo contenido que el ticket visible, la alineación de sus líneas y un ancho de 80 mm; al imprimir se oculta el resto de la aplicación.
- Comprobación en navegador con dos ventas reales contra un esquema PostgreSQL aislado: efectivo con cambio y tarjeta. Folios, cajero, caja, importes, método y partidas coincidieron entre pantalla y base de datos. La previsualización CSS de impresión se revisó visualmente y no hubo errores de consola.

Estado: **VERIFICADO**. No se probó una impresora física; la comprobación cubre la presentación imprimible del navegador.

### Bloque 8 — Movimientos de caja

- Ventas, cancelaciones, devoluciones, ingresos, retiros y apertura se concilian por sesión y método de pago; el efectivo esperado suma sólo ventas en efectivo e ingresos, y resta retiros y reversos en efectivo.
- Ingresos y retiros manuales limitados a `ADMIN` y `SUPERVISOR`, con concepto, importe positivo en centavos, usuario, caja, sesión y fecha persistidos. Se rechazan importes fuera de rango y retiros superiores al efectivo disponible.
- Reintentos manuales protegidos por clave idempotente y transacción: la misma solicitud recupera un solo movimiento incluso después de cerrar la sesión; una clave con otros datos se rechaza. Movimientos concurrentes de retiro se serializan por sesión.
- La pantalla permite registrar ambos tipos, identifica al responsable y el método de pago en los últimos 20 movimientos, bloquea el doble clic y conserva una operación incierta para recuperarla tras recargar sin duplicarla.
- Pruebas con PostgreSQL aislado: conciliación de ventas en efectivo y tarjeta, ingreso y retiro entre dos cajas; permisos, validaciones, sobregiro, sesión cerrada, concurrencia y rollback ante un error de base de datos. Navegador: ingreso, retiro, sobregiro, recarga y recuperación de un ingreso demorado, con una sola fila persistida y sin errores de consola.

Estado: **VERIFICADO**. La vista de sesión muestra los últimos 20 movimientos; el historial paginado completo está en reportes administrativos.

### Bloque 9 — Cierre y corte de caja

- El corte concilia fondo inicial, ventas por medio de pago, devoluciones, ingresos y retiros; persiste efectivo esperado, contado y diferencia, junto con usuario, caja, sesión y fecha de cierre.
- El cierre y su movimiento de caja se confirman en una sola transacción. Un fallo de base de datos revierte todo el corte y permite reintentar la misma operación.
- La clave idempotente impide duplicados por doble clic, reintento o respuesta perdida. La interfaz conserva un cierre incierto y permite recuperarlo tras recargar, sin habilitar otras operaciones mientras está pendiente.
- Se rechazan importes inválidos y el corte de una sesión ajena. Dos cierres concurrentes de la misma sesión no generan dos cortes. Una caja cerrada impide ventas posteriores.
- El último corte queda visible para su responsable o personal privilegiado, incluso después de recargar, sin exponerlo a otro cajero. La pantalla muestra la diferencia y sus componentes.
- Comprobación en navegador contra PostgreSQL aislado: apertura con $100, corte con $95, diferencia de -$5, cierre visible y persistencia del resumen tras recargar.

Estado: **VERIFICADO**. La prueba de cadena completa se registra en la sección siguiente.

### Prueba integral final — Operación completa

- Una sola sesión ejecutó login, apertura de caja, búsqueda por código, cotización del carrito, cobro en efectivo, venta persistida, descuento de inventario, movimiento de caja, ticket, consulta histórica y corte.
- Prueba automatizada contra PostgreSQL aislado: dos libros de $116, subtotal $200, IVA $32, total $232, pago $300, cambio $68 y stock de 5 a 3. El folio, partidas, usuario, caja, sesión y método coincidieron entre API y tablas de venta, kardex y caja. El corte calculó $332 esperados, $330 contados y una diferencia de -$2; confirmó una sola sesión cerrada y rechazó otra venta.
- La misma secuencia se ejecutó en navegador con datos temporales: ticket V-00000001, venta reciente, existencias, kardex y resumen de caja coincidieron con PostgreSQL. Tras el corte y la recarga, la caja siguió cerrada y el cobro quedó deshabilitado. No hubo errores de consola.
- El esquema y servidor temporales se retiraron tras la comprobación. No se utilizaron datos de operación real ni se probó una impresora física.

Estado: **VERIFICADO**. El núcleo definido en este protocolo cumple la condición de **BETA FUNCIONAL**; no equivale a paridad con SICAR X ni a certificación de producción.

## Evidencia vigente

- Prueba específica de autenticación y usuarios: **9/9 aprobadas**.
- Prueba específica de apertura y estado de caja: **9/9 aprobadas**.
- Prueba específica de productos e inventario: **6/6 aprobadas**.
- Prueba específica de carrito y preparación de venta: **6/6 aprobadas**.
- Prueba específica de cobro: **7/7 aprobadas**.
- Prueba específica de registro transaccional de la venta: **2/2 aprobadas**.
- Ticket en navegador: **2 ventas y presentación imprimible comprobadas**; aserciones de datos de ticket añadidas a la prueba integral de venta.
- Prueba específica de movimientos de caja: **5/5 aprobadas**.
- Prueba específica de cierre y corte de caja: **4/4 aprobadas**.
- Prueba integral final de una sesión continua: **1/1 aprobada**.
- Regresión dirigida de venta, cobro, caja, precios, pedidos, inventario e idempotencia: **38/38 aprobadas**.
- Regresión integral acumulada vigente: **160/160 aprobadas, 0 fallos, 0 omitidas**. La prueba adicional cubre el registro persistente de errores sin credenciales ni cuerpos de solicitud.
- Pruebas en navegador: autenticación; recuperación de caja; alternancia multicaja; validación del fondo; alta y búsqueda de producto; consolidación de duplicados; aumento, reducción y vaciado del carrito; subtotal, descuento, IVA y total; rechazo de producto inactivo o sin stock; bloqueo al reducirse la existencia; carrera entre búsquedas; respuesta posterior al logout; contenido comercial tratado como texto; validación de importes; efectivo exacto y con cambio; tarjeta; transferencia; cancelación antes de confirmar; doble clic; recuperación del mismo cobro tras recargar; registro visible de venta, caja e inventario; y conservación del título histórico después de editar el producto, aprobadas en un navegador controlado contra un esquema PostgreSQL aislado y sin errores de consola.
- PostgreSQL: sin migraciones pendientes y sin esquemas temporales de prueba residuales.
- Dependencias de producción: **0 vulnerabilidades reportadas**.

## Estado del protocolo

| Puerta | Estado |
|---|---|
| Bloque 0 — Auditoría y arranque | Verificado |
| Bloque 1 — Autenticación y usuarios | Verificado |
| Bloque 2 — Apertura y estado de caja | Verificado |
| Bloque 3 — Productos e inventario | Verificado |
| Bloque 4 — Carrito y preparación de venta | Verificado |
| Bloque 5 — Cobro | Verificado |
| Bloque 6 — Registro transaccional de la venta | Verificado |
| Bloque 7 — Ticket | Verificado |
| Bloque 8 — Movimientos de caja | Verificado |
| Bloque 9 — Cierre y corte de caja | Verificado |
| Prueba integral final | Verificada |

- Avance implementado: **100%** (11 de 11 puertas del protocolo).
- Avance verificado: **100%** (11 de 11 puertas del protocolo).
- Beta funcional: **Sí**, dentro del alcance de este protocolo.

## Limitación aceptada del Bloque 1

El logout elimina la sesión guardada en el navegador, pero no mantiene una lista de revocación de JWT en el servidor. Un token que hubiese sido copiado fuera del navegador conserva su vigencia hasta `JWT_EXPIRES`. Desactivar al usuario invalida el acceso en la siguiente petición porque el backend consulta PostgreSQL cada vez.

## Siguiente acción autorizada

Mantener la regresión de las 11 puertas en cualquier cambio futuro. Si se modifica un bloque aprobado o una dependencia suya, marcarlo como **REABIERTO — REQUIERE NUEVA VERIFICACIÓN**, repetir sus pruebas y la prueba integral antes de volver a aprobarlo. No se autoriza despliegue ni incorporación de funciones fuera de alcance por este registro.

## FASE 2 — Integración y preparación operativa


### Bloque 10 — Integración continua

**Fecha:** 22 de septiembre de 2026.

**Estado inicial:** El proyecto no tenía flujo de CI, repositorio Git, rama activa ni remoto configurado.

**Evidencia automatizada:** En esta sesión, la suite local vigente terminó con **160 pruebas aprobadas, 0 fallidas y 0 omitidas** en aproximadamente 233 segundos. En GitHub Actions, la corrida de `push` sobre `main` [35734820573](https://github.com/AlanEstradaCarrillo/Rem-Libreria/actions/runs/35734820573) terminó con **160/160 aprobadas, 0 fallidas y 0 omitidas** (39,4 segundos de pruebas). La PR temporal [#1](https://github.com/AlanEstradaCarrillo/Rem-Libreria/pull/1) mostró un fallo deliberado en [35734894689](https://github.com/AlanEstradaCarrillo/Rem-Libreria/actions/runs/35734894689); tras retirar la prueba temporal, tanto `push` [35735142752](https://github.com/AlanEstradaCarrillo/Rem-Libreria/actions/runs/35735142752) como `pull_request` [35735154446](https://github.com/AlanEstradaCarrillo/Rem-Libreria/actions/runs/35735154446) volvieron a verde, esta última con **160/160 aprobadas, 0 fallidas y 0 omitidas** (47,5 segundos de pruebas). La PR se cerró sin fusionar y sin cambios netos respecto a `main`.

**Evidencia técnica ejecutada:** Se añadió `.github/workflows/ci.yml` con eventos `push` y `pull_request`, permisos mínimos `contents: read`, PostgreSQL 18.6 aislado con health check, instalación limpia `npm ci`, Node 24 y `npm test`. El repositorio privado `AlanEstradaCarrillo/Rem-Libreria` recibió los **117 archivos** del proyecto; se compararon sus SHA de blob con los archivos locales y no hubo diferencias. `backend/.env`, dependencias instaladas y archivos de log no se publicaron. Las corridas reales confirmaron arranque del servicio PostgreSQL, instalación limpia y ejecución de la suite. La carpeta local aún no tiene `.git` ni remoto configurado porque Git local no tiene autenticación para este repositorio privado; la publicación se realizó mediante la conexión autorizada de GitHub.

**Evidencia externa necesaria:** Falta configurar y comprobar una regla de protección de `main` que exija el check `Integración con PostgreSQL`. La conexión de GitHub disponible devuelve **403, Resource not accessible by integration** al consultar la protección de rama y no ofrece una operación administrativa para configurarla. Se requiere una persona con permisos de administración del repositorio. La autenticación de Git local también requiere intervención del titular si se desea usar `git push` desde esta carpeta.

**Riesgos pendientes:** CI funciona en `push` y `pull_request`, pero sin protección comprobada de `main` aún podría incorporarse un cambio que no pase la suite. La carpeta local no está vinculada con la historia Git remota para futuros envíos por CLI.

**Estado:** 🟡 **PENDIENTE DE VERIFICACIÓN EXTERNA**.

**Siguiente acción:** Un administrador debe configurar la protección de `main` con el check `Integración con PostgreSQL` obligatorio y confirmar que un PR rojo no puede fusionarse. Después se repetirá la reconciliación de este bloque. Para trabajo futuro desde esta carpeta, autenticar Git local y vincularlo a la historia remota sin sobrescribirla.

**Fase 2 implementada:** 1/6 bloques.

**Fase 2 verificada técnicamente:** 0/6 bloques.

**Pendientes externos:** 1 — protección de rama con permiso de administración.

**Listo para staging:** No.

**Listo para producción:** No.


### Bloque 11 — Hardening y preparación de producción

**Fecha:** 22 de septiembre de 2026.

**Estado inicial:** Existían migraciones versionadas con checksum y transacción por archivo, pero no había un procedimiento ejecutable de respaldo/restauración, ensayo real de restore ni registro persistente de errores del servidor. El archivo de ejemplo de variables no documentaba una ruta de log.

**Evidencia revisada:** `backend/src/config/db.js`, `backend/src/scripts/migrate-db.js`, `backend/src/scripts/init-db.js`, `backend/database/schema.sql`, las 19 migraciones, `backend/.env.example`, las pruebas de integración y los binarios PostgreSQL 18.6 disponibles localmente.

**Problemas encontrados:** No se podía demostrar que un backup pudiera restaurarse conservando datos y migraciones; los errores se enviaban únicamente a la terminal; no existía una barrera explícita para evitar que un ensayo de restore apuntara por accidente a la base operativa.

**Riesgos:** La base local utiliza la cuenta `postgres`; en producción debe existir una cuenta de aplicación con privilegios mínimos y una cuenta separada para administración/backup. Todavía no se conocen el proveedor, la política de retención, el modo SSL ni el destino persistente de logs de producción.

**Cambios realizados:**

- Se añadió `backend/src/scripts/backup-restore-check.js`, protegido por confirmación explícita, que crea una base temporal con nombre validado, aplica esquema y migraciones, inserta un dato centinela, ejecuta `pg_dump` custom, destruye sólo esa base, ejecuta `pg_restore` en una base temporal nueva, comprueba el dato, los checksums y que no haya migraciones pendientes, y elimina los recursos temporales.
- Se añadieron los scripts `ops:backup-restore` en backend y raíz, sin incorporar respaldos ni secretos al repositorio.
- Se añadió `backend/src/utils/observability.js`; el handler HTTP, el pool PostgreSQL, el healthcheck y los errores de arranque/apagado registran JSONL mediante `ERROR_LOG_FILE`, sin copiar cuerpos, encabezados ni credenciales.
- Se documentó el procedimiento de backup, restore, migraciones y logs en `docs/operacion/bloque-11-hardening.md` y se incorporó `ERROR_LOG_FILE` a `backend/.env.example`.

**Archivos modificados:** `.env.example`, `package.json` raíz, `README.md`, `backend/package.json`, `backend/src/config/db.js`, `backend/src/app.js`, `backend/src/server.js`, `backend/src/utils/errors.js`, `backend/src/utils/observability.js`, `backend/src/scripts/backup-restore-check.js`, `backend/test/helpers/integration-env.js`, `backend/test/integration/observability.test.js`, `docs/operacion/bloque-11-hardening.md`.

### Verificación automatizada

- `node --check` sobre todos los archivos JavaScript modificados: aprobado.
- Prueba de observabilidad: **1/1 aprobada**; un error HTTP quedó persistido y el registro no incluyó credenciales ni cuerpos.
- Suite completa: **160/160 aprobadas, 0 fallidas, 0 omitidas**, aproximadamente 118 segundos.

### Verificación técnica ejecutada

- `npm.cmd run ops:backup-restore` ejecutado contra PostgreSQL local 18.6 con una base temporal generada por el script: **aprobado**. Se conservaron el dato centinela, las **19 migraciones** y la ausencia de pendientes después de destruir y restaurar la base temporal.
- El ensayo usó únicamente una base con nombre `libra_pos_backup_test_*`; se eliminó al finalizar. No se destruyó ni modificó `libra_pos`.
- Las migraciones existentes siguen aplicándose con bloqueo advisory, checksum SHA-256 y transacción por archivo; el procedimiento de fallo y recuperación quedó documentado.

### Verificación externa necesaria

- Ejecutar el mismo ensayo en staging o en un entorno equivalente al proveedor real.
- Confirmar cuenta de aplicación con privilegios mínimos, SSL real, destino/retención de backups y volumen o sumidero persistente de logs.
- Comprobar una restauración operativa con el proveedor sin usar datos de producción no autorizados.

### Suite completa

**Total:** 160  
**Aprobadas:** 160  
**Fallidas:** 0  
**Omitidas:** 0

### Regresiones comprobadas

La suite completa volvió a comprobar autenticación, caja multicaja, ventas, cobros, inventario, kardex, cancelaciones, devoluciones, pedidos, tienda pública, tickets y corte. No se detectaron regresiones.

### Problemas restantes

El bloque técnico local está completo, pero falta la validación del entorno real de producción (credenciales, SSL, backup gestionado, retención y persistencia de logs).

### Estado final

🟡 **PENDIENTE DE VERIFICACIÓN EXTERNA**.

### Siguiente acción

Obtener la configuración del proveedor/staging y repetir el ensayo de respaldo, restauración, logs y migraciones allí. Mientras esas puertas externas sigan abiertas, no declarar producción lista.

**Fase 2 implementada:** 2/6 bloques.

**Fase 2 verificada técnicamente:** 0/6 bloques cerrados; Bloque 11 cuenta con evidencia técnica local completa, pero permanece amarillo por sus puertas externas.

**Pendientes externos:** 2 — ejecución real de CI/protección de rama (Bloque 10) y configuración/ensayo de producción equivalente (Bloque 11).

**Listo para staging:** No.

**Listo para producción:** No.

### Bloque 12 — Requisitos fiscales y datos personales

**Fecha:** 22 de septiembre de 2026.

**Estado inicial:** El sistema ya almacena datos personales y snapshots operativos de clientes y contactos, pero no existe una decisión de negocio sobre facturación desde el POS, régimen fiscal, PAC, retención o política de privacidad.

**Evidencia revisada:** `backend/database/migrations/005_clientes_pedidos_reservas.sql`, `013_clientes_cotizaciones_mayoreo.sql`, `014_editorial_obras_contratos.sql`, `017_editorial_consignaciones.sql`, las rutas autenticadas de clientes y pedidos, y los formularios de checkout, clientes, proveedores y colaboradores editoriales.

**Problemas encontrados:** No existe flujo CFDI ni tabla de factura; el RFC del proveedor y el `identificador_fiscal` editorial no representan facturación de clientes. Las reglas de acceso y conservación de datos requieren una decisión del negocio antes de endurecerlas.

**Riesgos:** Implementar un PAC, campos fiscales o retenciones sin conocer el régimen y el proceso actual podría generar facturas incorrectas, duplicadas o datos personales innecesarios. Los snapshots y respaldos requieren una política explícita de anonimización, retención y acceso.

**Cambios realizados:** No se modificó lógica ni configuración fiscal. Se documentó el inventario de datos, el estado técnico y las decisiones pendientes en `docs/operacion/bloque-12-fiscal-datos.md`.

### Verificación automatizada

No aplica: este bloque no autoriza aún código fiscal y no se añadieron migraciones ni rutas nuevas.

### Verificación técnica ejecutada

La inspección confirmó que los datos personales están almacenados en las tablas y snapshots indicados, y que las rutas requieren autenticación; la suite de 160 pruebas sigue verde tras los cambios de Bloque 11.

### Verificación externa necesaria

Decisión del negocio/asesoría fiscal sobre régimen, necesidad de CFDI, PAC, datos requeridos, relación ticket-factura, aviso de privacidad, accesos, retención y eliminación.

### Suite completa

**Total:** 160  
**Aprobadas:** 160  
**Fallidas:** 0  
**Omitidas:** 0

### Regresiones comprobadas

No se modificó la aplicación; la suite completa ya ejecutada mantiene autenticación, POS, caja, inventario, pedidos y tienda pública sin regresiones.

### Problemas restantes

Falta la decisión externa. No se puede diseñar ni verificar CFDI, captura fiscal de clientes o política definitiva de datos personales.

### Estado final

🟡 **PENDIENTE DE VERIFICACIÓN EXTERNA**.

### Siguiente acción

Recabar las decisiones del negocio y elaborar la especificación aprobada. Hasta entonces no implementar CFDI ni ampliar la captura de datos fiscales.

**Fase 2 implementada:** 3/6 bloques.

**Fase 2 verificada técnicamente:** 0/6 bloques cerrados.

**Pendientes externos:** 3 — CI/protección de rama, hardening del proveedor y decisiones fiscales/datos personales.

**Listo para staging:** No.

**Listo para producción:** No.


### Bloque 13 — Staging y validación operativa

**Fecha:** 22 de septiembre de 2026.

**Estado inicial:** El flujo integral y la presentación imprimible ya están comprobados localmente contra PostgreSQL aislado, pero no existe un entorno staging separado ni una impresora física disponible para validación.

**Evidencia revisada:** `frontend/styles.css` (`#print-area` y `@media print`), `frontend/app.js` (generación e impresión del ticket), `package.json`, `backend/.env.example`, `README.md` y la suite integral de 160 pruebas.

**Problemas encontrados:** No hay proveedor/URL de staging, base separada administrada, remoto Git ni Docker en el proyecto; por tanto no puede demostrarse un despliegue equivalente a producción desde esta sesión. La impresión física tampoco puede afirmarse por inspección de CSS.

**Riesgos:** Probar contra una base o dominio de producción contaminaría datos reales; reutilizar secretos o canales de WhatsApp sería inseguro. El layout de 80 mm puede requerir ajuste según la impresora real.

**Cambios realizados:** No se modificó lógica ni configuración de despliegue. Se documentó el checklist y el smoke test en `docs/operacion/bloque-13-staging.md`.

### Verificación automatizada

La suite existente permanece en **160/160 aprobadas** y la prueba integral local ya cubre login, caja, venta, inventario, ticket, movimiento y cierre sobre un esquema temporal. Esta evidencia no sustituye staging.

### Verificación técnica ejecutada

Se inspeccionó y confirmó la ruta de impresión de 80 mm, el `@media print` y la generación del ticket; no se realizó un despliegue ni se conectó hardware real.

### Verificación externa necesaria

Entorno staging separado con configuración equivalente, smoke test completo y confirmación humana de impresora térmica (ancho, corte, legibilidad y códigos).

### Suite completa

**Total:** 160  
**Aprobadas:** 160  
**Fallidas:** 0  
**Omitidas:** 0

### Regresiones comprobadas

No se modificó la aplicación; la suite integral vigente sigue cubriendo el núcleo POS, inventario, pedidos y tienda.

### Problemas restantes

Faltan infraestructura y validación humana externas. No se autoriza declarar staging ni producción listos.

### Estado final

🟡 **PENDIENTE DE VERIFICACIÓN EXTERNA**.

### Siguiente acción

Definir el proveedor/URL y base de staging, configurar secretos separados, ejecutar el smoke test y solicitar la prueba física de impresión. No desplegar desde esta sesión.

**Fase 2 implementada:** 4/6 bloques.

**Fase 2 verificada técnicamente:** 0/6 bloques cerrados.

**Pendientes externos:** 4 — CI, hardening del proveedor, decisiones fiscales/datos personales y staging/impresora.

**Listo para staging:** No.

**Listo para producción:** No.
