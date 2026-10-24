# Prompt de avance — Librería REM

Fecha de corte: 23 de octubre de 2026.

Este documento es la guía de trabajo para continuar el proyecto. Combina las normas de la Fase 2 con las recomendaciones del análisis inicial y muestra el estado de cada una con su evidencia. No es un registro de verificación: el registro oficial sigue siendo `VERIFICACION.md`, y ningún contador vive aquí.

## 1. Fuente de verdad y orden de evidencia

1. Evidencia ejecutada en la sesión actual.
2. `VERIFICACION.md`.
3. Este documento.
4. Resúmenes o afirmaciones de sesiones anteriores.

Si una prueba ejecutada contradice `VERIFICACION.md`, el bloque afectado pasa a **REABIERTO — REQUIERE NUEVA VERIFICACIÓN**, se corrige, se vuelve a verificar y solo entonces se actualiza el registro.

## 2. Punto de partida

- Rama de trabajo: `fase-2/prompt-avance`, creada desde `fix/editorial-royalties-fechas-fijas` (commit `a739628`).
- Pull request #2 abierto contra `main`, sin fusionar. `main` sigue en `1dd2e52`.
- Suite completa en la rama: **160 aprobadas, 0 fallidas, 0 omitidas** (23 de octubre de 2026, PostgreSQL 18.6, Node 24.19.0).
- CI de GitHub Actions: aprobado en `push` y `pull_request` para `a739628`.

## 3. Puerta de entrada a Fase 2

Fase 2 solo puede avanzar si se cumplen a la vez:

- los bloques 0 a 9 de Fase 1 están verificados según `VERIFICACION.md`;
- la prueba integral final está verificada;
- la suite completa pasa;
- no hay regresiones conocidas;
- `VERIFICACION.md` y la evidencia ejecutada son compatibles;
- el sistema conserva la condición de beta funcional dentro del alcance de Fase 1.

Estado actual: **cumplida en la rama de trabajo** (suite en verde y registro compatible). La corrección de la prueba de regalías está documentada como prueba modificada, con autorización. Queda pendiente fusionar esa rama en `main` para que el estado oficial lo refleje.

## 4. Normas de trabajo

- Prioridad: **correcto > verificado > estable > seguro > mantenible > rápido > nuevas funciones**.
- Estados permitidos por bloque:
  - ✅ **BLOQUE VERIFICADO**: todas las comprobaciones aplicables se ejecutaron y pasaron.
  - ❌ **BLOQUE NO VERIFICADO**: hay un fallo técnico, una prueba fallida o una regresión. No se avanza.
  - 🟡 **PENDIENTE DE VERIFICACIÓN EXTERNA**: el trabajo técnico está hecho, pero falta evidencia que solo puede aportar el titular o un tercero.
- Un bloque en 🟡 solo permite avanzar si todo su trabajo técnico pasó y el siguiente bloque no depende de la evidencia pendiente.
- Ciclo por bloque: inspección → diagnóstico → modificación → verificación local → suite completa → regresión → documentación → cierre.
- Un solo bloque activo a la vez.
- Las pruebas existentes son evidencia. No se modifican para que pasen; si una prueba previamente válida falla, se presume regresión. Solo se modifica cuando el requisito cambió deliberadamente, la prueba estaba objetivamente equivocada, o se sustituye por otra equivalente o superior. En cualquiera de esos casos se registra en `VERIFICACION.md`: prueba modificada, motivo, comportamiento anterior, comportamiento nuevo y autorización.
- Una función verificada que se modifica deja de darse por verificada hasta volver a probarla.
- Tipos de evidencia: automatizada (pruebas, compilación, endpoints), técnica ejecutada (respaldo y restauración reales, staging, smoke test, rollback) y externa o humana (impresora física, decisión fiscal, contratación de proveedor, validación del responsable del negocio). Nada se marca como ejecutado solo por haber inspeccionado código.
- Seguridad operativa: no destruir datos reales para probar; no subir credenciales reales al repositorio; no ejecutar migraciones destructivas sin respaldo; no declarar hardware, cumplimiento fiscal ni producción lista sin evidencia.

## 5. Recomendaciones del análisis inicial

Estado según el código y la suite de la rama, no según el zip de análisis original, que es anterior.

| Recomendación | Estado | Evidencia |
|---|---|---|
| Escapar HTML en el frontend | ✅ Verificado | `frontend/` no contiene `innerHTML` ni APIs equivalentes. Bloques 3, 4 y 7 de `VERIFICACION.md`. |
| Caja por sucursal o multicaja | ✅ Verificado | Migración `001`. Ventas, retiros e ingresos se asocian a la caja y sesión del usuario. Bloques 2 y 8. |
| Kárdex de inventario | ✅ Verificado | Migración `003`. Cada venta y ajuste genera movimiento. Bloques 3 y 6. |
| Permisos de caja | ✅ Verificado | Bloque 8: ingresos y retiros solo para ADMIN y SUPERVISOR. |
| Clientes, pedidos, devoluciones y cancelaciones | Implementado, probado por la suite | `clientes.routes.js`, `pedidos.routes.js`, `ventas.routes.js`. Pruebas: `clients-quotes-wholesale`, `customers-orders`, `order-pos`. No tienen bloque propio en el protocolo. |
| Tienda en línea con el mismo catálogo | Implementado, validación operativa pendiente | `tienda.routes.js`, migración `006`. Prueba: `storefront`. La validación real queda para Bloque 13. |
| Motor de precios y segmentos | Implementado, probado por la suite | Migraciones `004` y `013` (`segmento_precio`). Prueba: `pricing-catalog`. |
| Categorías y departamentos | Implementado, probado por la suite | `categorias.routes.js`, migración `004`. |
| Reportes | Implementado, probado por la suite | `reportes.routes.js`. Prueba: `reports`. |
| Permisos por función, más allá de roles | ❌ No implementado | Solo tres roles fijos, con restricción `CHECK` en el esquema. Requiere decisión de negocio sobre la matriz de permisos. |
| Pagos mixtos y varias monedas | ❌ No implementado | Cada venta tiene un único `metodo_pago`. Es una función nueva que reabre los bloques 5 y 6. |
| Varias sucursales con stock por sucursal y traspasos | ❌ No implementado | Hay varias cajas, pero no sucursales. Requiere saber si existe más de un punto físico. |
| CFDI 4.0 | ❌ No implementado | Bloque 12: decisión externa. No se implementa sin decisiones del negocio. |
| Editorial avanzada (contratos, tirajes, regalías, consignaciones) | Implementado, fuera de alcance | Existe en el código y tiene pruebas. No se amplía. |

## 6. Bloques de Fase 2

| Bloque | Trabajo técnico | Estado | Pendiente externo |
|---|---|---|---|
| 10 — Integración continua | Completo: flujo de CI, ejecución en `push` y `pull_request`, prueba de fallo controlado. | 🟡 | Protección de `main`. Requiere un plan de GitHub que admita protección en repositorios privados. |
| 11 — Hardening y producción | Completo en local: migraciones versionadas, observabilidad JSONL y ensayo de respaldo y restauración. El ensayo se volvió a ejecutar el 23 de octubre de 2026 y pasó, con 19 migraciones y datos conservados. | 🟡 | Ensayo en staging o en el proveedor real. Cuenta de aplicación con privilegios mínimos, SSL, retención de respaldos y destino persistente de logs. |
| 12 — Fiscal y datos personales | Solo documentación. No se implementó ninguna integración. | 🟡 | Decisiones de negocio: régimen fiscal, si hoy se factura y cómo, PAC, datos del cliente, aviso de privacidad, retención y eliminación. |
| 13 — Staging y validación operativa | Checklist y smoke test documentados. Impresión de 80 mm verificada en navegador. | 🟡 | Entorno staging separado. Prueba física de la impresora térmica: ancho, corte, legibilidad y códigos. |
| 14 — Despliegue controlado | No iniciado. | ⛔ Bloqueado | Depende de los bloques 10 a 13 en su parte externa. |
| 15 — Refactor controlado | No iniciado. | Opcional | Solo si una deuda técnica impide operar, desplegar, mantener, probar o asegurar el sistema. |

## 7. Decisiones que necesito del titular

1. **Fusionar PR #2** a `main`, y cuándo hacerlo.
2. **Protección de `main`:** elegir un plan de GitHub que lo permita, o aceptar operar sin esa protección.
3. **Sucursales:** ¿hay más de un punto de venta físico que comparta stock?
4. **Pagos mixtos y permisos por función:** son funciones nuevas. El protocolo las prohíbe antes de cerrar las puertas de producción; si se quieren ahora, hace falta una excepción explícita. Implican reabrir los bloques 1, 5 y 6. **Decisión del 23 de octubre de 2026: excepción autorizada solo para pagos mixtos.** Permisos por función y sucursales siguen fuera de alcance.
5. **Fiscal:** régimen de Librería REM, si hoy factura, cómo lo hace y si habrá PAC.
6. **Staging:** proveedor, URL y base de datos separada.
7. **Impresora térmica:** modelo, ancho del papel y prueba física.

## 8. Próximo paso técnico permitido

Sin decisiones pendientes del titular, el trabajo técnico restante es mínimo:

- Mantener la suite en verde en cada cambio.
- Documentar el ensayo de respaldo y restauración en `VERIFICACION.md`, Bloque 11, como evidencia técnica de la fecha.

La única excepción vigente es pagos mixtos (decisión 4, 23 de octubre de 2026). Su implementación reabre los bloques 5 a 9, incluido el 7 por el cambio en el ticket. Quedó implementada y reverificada el 23 de octubre de 2026, con la evidencia en `VERIFICACION.md`. No se implementa ninguna otra función nueva hasta cerrar las puertas de producción.

## 9. Cómo retomar

```bash
npm ci
npm test
```

Antes de cualquier cambio: leer `VERIFICACION.md`, ejecutar la suite, comparar resultados, confirmar la puerta de Fase 2 y registrar cualquier discrepancia. Si una función verificada se modifica, marcarla como **REABIERTO — REQUIERE NUEVA VERIFICACIÓN** hasta que vuelva a pasar sus pruebas.
