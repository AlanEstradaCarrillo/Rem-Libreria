# Prompt de trabajo — Librería REM

Fecha de corte: 23 de octubre de 2026.

Este documento define qué se trabaja, en qué orden, cómo se verifica y cuándo se detiene el trabajo para dejar un commit. Las normas de estados y de verificación están en `prompt-de-avance.md`; el registro oficial sigue siendo `VERIFICACION.md`.

## 1. Estado de partida

- `main` en `f5bfa38`: incluye la corrección de regalías (PR #2), y el prompt de avance, los pagos mixtos, la corrección del botón «Dividir pago» y la garantía de medios en la base (PR #3).
- Rama `fase-2/prompt-avance`: un commit sobre `main` (`5de5535`, corrección de sumas de migraciones), publicado en GitHub, sin PR abierto. Ese commit no está en `main`.
- Suite completa: 169 de 169 aprobadas.
- Base local `libra_pos`: migración 019, sin ventas, sin migraciones 020 y 021.

## 2. Objetivo

Dejar el POS en condiciones de usarse con dinero y datos reales en staging y después en producción, sin introducir funciones nuevas fuera de las excepciones autorizadas.

## 3. Prioridades

Se aplica el orden de `prompt-de-avance.md`, sección 4: correcto > verificado > estable > seguro > mantenible > rápido > nuevas funciones.

En la práctica:

1. Corrección de dinero e informes: lo que cambia cifras que el negocio usa.
2. Verificación de lo ya implementado en el navegador.
3. Estabilidad de la interfaz.
4. Housekeeping del repositorio y la documentación.
5. Lo que depende de decisiones o de terceros.

## 4. Backlog

### A. Técnico, ejecutable sin esperar a nadie

| ID | Tema | Bloques | Criterio de cierre |
|---|---|---|---|
| A1 | Reporte por método de pago: el filtro «Efectivo» excluye las ventas mixtas. Debe incluir su tramo en efectivo. | 8, 9 | Prueba que cuenta el tramo en efectivo de una venta mixta en el filtro por método. Suite verde. |
| A2 | Modal de cobro en modo mixto: el cambio del tramo en efectivo no se muestra (`calcularCambio` regresa temprano). | 5 | Verificación en navegador del cambio mostrado. Suite verde. |
| A3 | Verificación en navegador: cancelación y devolución de una venta mixta. | 5, 6, 8, 9 | Pasos en navegador con base temporal aislada. Filas de `movimiento_pagos` y totales de caja coinciden con la base. |
| A4 | Verificación en navegador: pago dividido con transferencia. | 5, 6 | Mismo criterio que A3. |
| A5 | Método de pruebas automatizadas para el cobro dividido. Hoy solo hay verificación manual. | 5 | Acordar herramienta. Si no hay una aprobada, documentar la lista de pasos manuales en `VERIFICACION.md`. |
| A6 | Actualizar `prompt-de-avance.md` y `VERIFICACION.md` tras cada cierre. | — | Estados y evidencia al día. |

### B. Externo: no se cierra desde aquí

| ID | Tema | Bloques | Quién lo aporta |
|---|---|---|---|
| B1 | Protección de `main` con el check de PostgreSQL obligatorio. Requiere un plan de GitHub que admita protección en repositorios privados. | 10 | Titular |
| B2 | Entorno de staging: proveedor, URL y base separada. | 11, 13 | Titular o proveedor |
| B3 | Cuenta de aplicación con privilegios mínimos, SSL real, retención de respaldos y destino persistente de logs. | 11 | Titular y proveedor |
| B4 | Smoke test completo en staging y rollback probado. | 13, 14 | Titular, con staging de B2 |
| B5 | Prueba física de la impresora térmica: ancho, corte, legibilidad y códigos. | 13 | Titular |
| B6 | Ensayo de migraciones 001 a 021 con una copia del respaldo real del negocio. Hoy solo hay datos sintéticos. | 11 | Titular |

### C. Decisiones de negocio: sin decisión no se implementan

| ID | Tema | Bloques | Efecto |
|---|---|---|---|
| C1 | Régimen fiscal, si Librería REM factura hoy, cómo, si habrá PAC y aviso de privacidad. | 12 | Sin decisión no se implementa CFDI ni captura fiscal. |
| C2 | ¿Hay más de un punto de venta físico con stock propio? | — | Define si se implementan sucursales, stock por sucursal y traspasos. |
| C3 | Permisos por función (matriz de permisos más allá de los tres roles). | — | Función nueva: requiere excepción explícita. |
| C4 | Varias monedas. | — | Función nueva: requiere excepción explícita. |
| C5 | Publicación de la tienda en línea con clientes reales. | 13, 14 | Depende de B2 y de C1. |

### D. Housekeeping con decisión pendiente

| ID | Tema | Quién decide |
|---|---|---|
| D1 | Mover el clon de trabajo de `C:\Users\Denox\AppData\Local\Temp\rem-rev\repo` a una carpeta permanente. Hoy el commit `5de5535` solo existe en esa copia local, aunque ya está publicado en GitHub. | Titular: confirma la ruta. |
| D2 | Abrir PR de `fase-2/prompt-avance` a `main`. | Titular |
| D3 | Aplicar las migraciones 020 y 021 a la base local `libra_pos`. Se puede migrar con el runner corregido o restablecer la base; la base no tiene datos de operación. | Titular |

### E. Fuera de alcance hasta cerrar las puertas de producción

Editorial avanzada (contratos, tirajes, regalías, consignaciones), dashboards, animaciones, rediseño visual, integraciones externas no necesarias y refactor del bloque 15. El refactor solo se justifica si una deuda técnica impide operar, desplegar, mantener, probar o asegurar el sistema.

## 5. Orden de ejecución

1. **A1 y A2.** Corrigen cifras del negocio y la interfaz de cobro mixto. Cada uno con su prueba y su commit local.
2. **A3 y A4.** Verificación en navegador de los flujos mixtos restantes, con base temporal aislada y eliminada al terminar.
3. **A5.** Acordar el método de prueba del frontend antes de automatizar nada.
4. **A6.** Al cerrar cada ítem.
5. Cuando solo queden B, C o D, el trabajo técnico termina y se reporta el estado.

Los ítems de D se proponen al titular; no se ejecutan sin su respuesta.

## 6. Modo de trabajo

- Un ítem a la vez. Cada ítem sigue el ciclo de `prompt-de-avance.md`: inspección, diagnóstico, modificación, verificación local, suite completa, regresión, registro en `VERIFICACION.md` y commit local.
- La suite completa se corre con `npm test` desde la raíz del repositorio.
- Cada commit lleva el trailer `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Para ensayos con datos se usan copias temporales. `libra_pos` no se modifica sin autorización.
- Las bases temporales y los servidores de verificación se eliminan o detienen al terminar la prueba.
- Un ítem solo se marca como verificado con evidencia ejecutada. Si una parte no se pudo ejecutar, el ítem queda como no verificado o pendiente, con la razón escrita.

### Lo que se hace sin preguntar

- Los ítems técnicos de la sección A.
- Commits locales de cada ítem cerrado.

### Lo que requiere autorización explícita en ese momento

- Publicar commits en `origin` (push).
- Abrir, fusionar o cerrar un PR.
- Cualquier cambio en `main` que no provenga de un PR.
- Migrar o modificar la base `libra_pos`.
- Implementar una función listada en C.
- Cualquier acción sobre datos reales o sobre una base que no sea temporal.

## 7. Punto de corte por presupuesto

El trabajo se organiza para que cada ítem cerrado deje un commit local.

Cuando el presupuesto de tokens de la sesión esté por agotarse, el agente:

1. Cierra el ítem en curso si está a punto de terminar; si no, lo deja en un commit con su estado real (no verificado o pendiente) y el paso exacto donde se detuvo.
2. Actualiza este documento y `VERIFICACION.md` con el estado de cada ítem tocado.
3. Termina el turno con un reporte: ítems cerrados, ítems pendientes, siguiente paso.

El umbral se fija en la aprobación de este documento. Propuesta: cuando quede menos del 10 % del presupuesto inicial de la sesión.

## 8. Criterios de cierre de un ítem

- Hay una prueba automatizada nueva o existente que cubre el cambio.
- La suite completa pasa.
- Si el cambio toca interfaz o datos, hay verificación ejecutada en navegador o en base temporal.
- `VERIFICACION.md` y `prompt-de-avance.md` están al día.
- Existe el commit local con su trailer.

## 9. Preguntas abiertas para el titular

1. ¿Apruebas el orden de la sección 5?
2. El presupuesto que mencionaste es de un millón de tokens, pero la sesión muestra 15 millones. ¿Qué límite quieres usar para el punto de corte?
3. ¿Qué ruta permanente quieres para el clon de trabajo (D1)?
4. ¿Abro el PR de `fase-2/prompt-avance` (D2)?
5. ¿Qué haces con la base local `libra_pos` (D3)?
