# Bloque 12: decisiones fiscales y datos personales

Este documento no es una opinión legal ni declara que Librería REM cumpla por sí sola una obligación fiscal. Registra el estado técnico y las decisiones que debe confirmar la persona responsable del negocio antes de diseñar una integración.

## Datos que actualmente almacena el sistema

| Área | Datos | Ubicación técnica | Acceso actual |
|---|---|---|---|
| Usuarios | nombre, correo, hash de contraseña, rol, estado | `usuarios` | autenticación; administración de usuarios restringida por rol |
| Clientes | nombre, teléfono, correo, dirección, notas, segmento y tipo comercial | `clientes` | rutas autenticadas; alta general y cambios sensibles con ADMIN/SUPERVISOR |
| Pedidos web/POS | copia del nombre, teléfono, correo, dirección, notas, entrega y estado | `pedidos` y tablas de historial | creación según canal; consulta interna autenticada |
| Cotizaciones | snapshot del cliente y condiciones comerciales | `cotizaciones` y detalle | operación interna autenticada |
| Consignaciones | snapshot de librería/distribuidor/institución, contacto, dirección y referencia | `consignaciones_editoriales` | operación interna autenticada |
| Editorial | nombre legal, correo, teléfono, identificador fiscal y notas | `colaboradores_editoriales` | operación editorial autenticada |
| Proveedores | RFC, contacto, teléfono, correo y dirección | tablas de compras/proveedores | operación de compras autenticada |
| Backups | copia de las tablas anteriores | respaldo PostgreSQL | debe restringirse al personal autorizado y al proveedor de infraestructura |

Los snapshots se conservan para que una venta, pedido o documento histórico no cambie si después se edita el cliente. La auditoría debe definir cuándo se puede anonimizar un dato y cómo se conserva la integridad histórica.

## Estado fiscal actual

- El sistema genera tickets y registra ventas, pero no contiene tablas ni flujo de CFDI.
- No se conoce el régimen fiscal aplicable ni si Librería REM ya factura fuera del POS.
- No se ha seleccionado PAC, método de autenticación, ambiente de pruebas ni mecanismo de cancelación.
- `identificador_fiscal` de colaboradores y `RFC` de proveedores son campos operativos; no constituyen una integración fiscal para clientes ni una factura.

## Decisiones externas necesarias

La persona responsable del negocio y su asesoría fiscal deben confirmar, por escrito:

1. Régimen fiscal aplicable y si se requiere emitir CFDI desde el POS.
2. Si el ticket seguirá siendo independiente de la factura y cómo se relacionarán ambos documentos.
3. Proveedor/PAC, ambiente de pruebas, credenciales, certificados, cancelaciones y contingencia.
4. Datos mínimos que se solicitarán para facturar (incluido RFC y uso fiscal, si corresponde) y en qué momento del flujo.
5. Si la facturación permanecerá en un sistema externo, cómo se entregará el folio de venta sin duplicar importes.
6. Aviso de privacidad, base de legitimación/consentimiento, responsables de acceso, plazo de conservación y procedimiento de atención o eliminación.
7. Política de acceso por rol para teléfonos, correos, direcciones, RFC e historial de compras.
8. Cifrado, retención y destrucción de respaldos; acceso del proveedor cloud a esos datos; y retención/rotación de logs.

## Puerta de implementación

No se implementará CFDI, captura de RFC ni nuevas retenciones hasta recibir esas decisiones. Inventar un PAC, régimen, credencial o periodo de conservación produciría un flujo que podría ser incorrecto para el negocio.

Cuando las decisiones existan, se deberá crear primero una especificación aprobada y después una migración versionada, pruebas de datos mínimos, permisos, errores de proveedor, cancelación y no duplicación de facturas. La información real no se usará en pruebas; se emplearán datos sintéticos.
