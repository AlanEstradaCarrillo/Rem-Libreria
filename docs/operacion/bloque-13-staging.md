# Bloque 13: staging y validación operativa

Este bloque no despliega nada. Define la comprobación que debe ejecutarse en un entorno separado antes de usar datos reales.

## Requisitos del entorno

- Servicio Node 24.x y npm 11.17.x.
- PostgreSQL separado del desarrollo y de producción.
- `DATABASE_URL`, `JWT_SECRET`, contraseñas de seed y `CORS_ORIGIN` propios de staging; nunca reutilizar valores de producción.
- `PGSSL` y `TRUST_PROXY` iguales a los que utilizará el proveedor real.
- Logs y backups de staging con destino separado.
- Dominio o URL de staging no pública para clientes mientras se prueba.

La aplicación actual puede servirse con `npm.cmd start`; el frontend estático se sirve desde la misma API y no requiere un build separado. El repositorio no contiene Docker y todavía no tiene un remoto Git, por lo que el despliegue reproducible de staging requiere una decisión de infraestructura externa.

## Smoke test requerido

Con datos sintéticos, ejecutar:

`LOGIN → APERTURA DE CAJA → PRODUCTO → CARRITO → COBRO → VENTA → INVENTARIO → TICKET → MOVIMIENTO → CIERRE DE CAJA`

Comprobar en la interfaz, API y PostgreSQL de staging que el usuario, caja, sesión, folio, importes, kardex, movimiento y corte coincidan. Repetir con dos cajas, un pago con cambio, una cancelación/devolución y un pedido web reservado. No conectar staging al WhatsApp o correo real sin autorización.

## Impresión térmica

La aplicación prepara `#print-area` a 80 mm, oculta el resto de la interfaz durante la impresión y genera el ticket desde la venta almacenada. La revisión técnica de CSS y navegador ya está cubierta; falta una prueba humana con la impresora real para confirmar ancho, corte, legibilidad y QR/código si se incorpora.

## Criterio de cierre

El bloque no puede declararse verificado hasta disponer de una URL/entorno de staging separado, ejecutar el smoke test completo y recibir confirmación humana de la impresión. No se utilizarán datos reales ni se modificará producción para obtener esta evidencia.
