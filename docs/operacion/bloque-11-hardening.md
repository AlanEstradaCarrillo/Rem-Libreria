# Operación segura: respaldo, restauración y errores

Esta guía forma parte de la preparación de Librería REM. Los respaldos no deben guardarse dentro del repositorio ni compartirse por correo o chat. Las contraseñas se proporcionan mediante el gestor de secretos del entorno, `PGPASSFILE` con permisos restringidos o variables protegidas del proveedor; nunca se escriben en estos documentos.

## Ensayo controlado local

El ensayo automatizado usa únicamente una base temporal cuyo nombre empieza con `libra_pos_backup_test_`. Requiere PostgreSQL disponible y la herramienta `pg_dump`/`pg_restore` de la misma versión del servidor.

Desde `outputs/libra-pos`:

```powershell
$env:BACKUP_RESTORE_CONFIRM = 'I_UNDERSTAND_THIS_USES_A_TEMPORARY_DATABASE'
npm.cmd run ops:backup-restore
Remove-Item Env:BACKUP_RESTORE_CONFIRM
```

En Windows, el script usa por defecto `C:\Program Files\PostgreSQL\18\bin`. Si las herramientas están en otra ubicación, define temporalmente `PG_BIN_DIR` con esa carpeta. El script crea la base temporal, aplica `schema.sql` y todas las migraciones versionadas, inserta un dato centinela, genera un respaldo custom, destruye únicamente la base temporal, la crea de nuevo, restaura el respaldo, valida el dato y confirma que no quedan migraciones pendientes. Al finalizar elimina la base temporal y el archivo de respaldo.

Si el comando falla, no se debe cambiar el nombre de la base ni eliminar otra base para intentar resolverlo. Revisa el mensaje, confirma que `DATABASE_URL` apunta al entorno de pruebas y vuelve a ejecutar únicamente cuando la base operativa esté fuera de riesgo.

## Respaldo operativo

1. Configura en el proveedor un volumen o destino de respaldos fuera del repositorio, con acceso restringido.
2. Ejecuta `pg_dump` en formato custom usando credenciales protegidas y la versión compatible con PostgreSQL del proveedor.
3. Conserva varias copias con una política de retención definida por el negocio y comprueba que el archivo no quede expuesto públicamente.
4. Valida periódicamente cada respaldo en una base temporal separada con `pg_restore --exit-on-error --single-transaction`.
5. Comprueba tablas críticas, claves foráneas, `schema_migrations`, productos, inventario, ventas, movimientos y sesiones de caja antes de destruir la base temporal.
6. Registra fecha, tamaño, resultado y responsable del ensayo, sin registrar contraseñas ni la cadena completa de conexión.

El respaldo de PostgreSQL no incluye automáticamente el archivo `backend\\.env`, el código, secretos del proveedor, imágenes guardadas fuera de la base ni otros archivos del servicio. Esos elementos requieren un plan independiente y seguro.

## Migraciones versionadas

Las migraciones están en `backend/database/migrations` y se aplican con:

```powershell
npm.cmd run db:migrate
```

El ejecutor toma un bloqueo advisory, aplica cada archivo dentro de una transacción y guarda su SHA-256 en `schema_migrations`. Si un archivo falla, se revierte ese archivo; las migraciones ya confirmadas permanecen registradas. Nunca se editan migraciones ya aplicadas: se agrega un archivo nuevo y se prueba primero sobre una base temporal restaurada.

Antes de una migración en producción:

- confirma un respaldo reciente y un ensayo de restauración;
- prueba el esquema y los datos existentes en staging;
- ejecuta la migración con la versión de Node y PostgreSQL compatibles;
- verifica que no haya migraciones pendientes y ejecuta el flujo de login, caja, venta, inventario y cierre;
- si falla, conserva el respaldo, revisa el error y aplica el procedimiento de recuperación del proveedor; no borres tablas manualmente.

## Registro persistente de errores

La API registra errores en JSON Lines mediante `ERROR_LOG_FILE` (por defecto `logs/errors.log`). El registro contiene fecha, evento, estado HTTP, método, ruta y mensaje; no copia cuerpos de solicitudes, encabezados ni credenciales. En producción configura `ERROR_LOG_FILE` en un volumen persistente o integra el archivo con el sistema de logs del proveedor y define retención/rotación.

El archivo está excluido de Git por la regla `*.log`. El log local no sustituye el monitoreo del proveedor: se debe comprobar que los errores de arranque, conexión PostgreSQL, solicitudes HTTP fallidas y tareas de reservas sean visibles y persistentes.
