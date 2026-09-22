-- Catálogo bibliográfico e importaciones CSV auditables.
--
-- productos continúa siendo la única fuente de verdad para POS, tienda,
-- pedidos, precios e inventario. Esta migración sólo amplía su ficha
-- bibliográfica y conserva snapshots de importación; nunca altera existencias,
-- reservas, publicación web, imágenes, slugs ni el kardex.

-- El resumen legado admite varios autores sin truncarlos. El índice FTS
-- existente se conserva: PostgreSQL reconstruye sus dependencias al ampliar
-- un VARCHAR de forma compatible.
ALTER TABLE productos
  ALTER COLUMN autor TYPE VARCHAR(1000),
  ADD COLUMN isbn_normalizado VARCHAR(13),
  ADD COLUMN subtitulo VARCHAR(240),
  ADD COLUMN edicion VARCHAR(80),
  ADD COLUMN anio_publicacion SMALLINT,
  ADD COLUMN idioma VARCHAR(60),
  ADD COLUMN numero_paginas INTEGER,
  ADD COLUMN encuadernacion VARCHAR(80),
  ADD COLUMN formato VARCHAR(80),
  ADD COLUMN coleccion VARCHAR(120),
  ADD COLUMN serie VARCHAR(120),
  ADD COLUMN volumen VARCHAR(40);

ALTER TABLE productos
  ADD CONSTRAINT productos_subtitulo_check CHECK (
    subtitulo IS NULL OR btrim(subtitulo) <> ''
  ),
  ADD CONSTRAINT productos_edicion_check CHECK (
    edicion IS NULL OR btrim(edicion) <> ''
  ),
  ADD CONSTRAINT productos_anio_publicacion_check CHECK (
    anio_publicacion IS NULL OR anio_publicacion BETWEEN 1000 AND 9999
  ),
  ADD CONSTRAINT productos_idioma_check CHECK (
    idioma IS NULL OR btrim(idioma) <> ''
  ),
  ADD CONSTRAINT productos_numero_paginas_check CHECK (
    numero_paginas IS NULL OR numero_paginas > 0
  ),
  ADD CONSTRAINT productos_encuadernacion_check CHECK (
    encuadernacion IS NULL OR btrim(encuadernacion) <> ''
  ),
  ADD CONSTRAINT productos_formato_check CHECK (
    formato IS NULL OR btrim(formato) <> ''
  ),
  ADD CONSTRAINT productos_coleccion_check CHECK (
    coleccion IS NULL OR btrim(coleccion) <> ''
  ),
  ADD CONSTRAINT productos_serie_check CHECK (
    serie IS NULL OR btrim(serie) <> ''
  ),
  ADD CONSTRAINT productos_volumen_check CHECK (
    volumen IS NULL OR btrim(volumen) <> ''
  );

-- Sólo se eliminan separadores ISBN habituales. Cualquier otra letra o
-- símbolo mantiene el dato legado sin validar y se rechaza en escrituras
-- nuevas; nunca se intenta corregir silenciosamente.
CREATE OR REPLACE FUNCTION normalizar_isbn_catalogo(p_isbn TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_limpio TEXT;
BEGIN
  IF p_isbn IS NULL OR btrim(p_isbn) = '' THEN
    RETURN NULL;
  END IF;
  IF btrim(p_isbn) !~ '^[0-9Xx -]+$' THEN
    RETURN NULL;
  END IF;

  v_limpio := upper(regexp_replace(btrim(p_isbn), '[ -]', '', 'g'));
  IF v_limpio !~ '^([0-9]{9}[0-9X]|[0-9]{13})$' THEN
    RETURN NULL;
  END IF;
  RETURN v_limpio;
END
$function$;

CREATE OR REPLACE FUNCTION isbn_checksum_valido_catalogo(p_isbn TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_isbn TEXT := normalizar_isbn_catalogo(p_isbn);
  v_suma INTEGER := 0;
  v_digito INTEGER;
  v_i INTEGER;
BEGIN
  IF v_isbn IS NULL THEN
    RETURN FALSE;
  END IF;

  IF length(v_isbn) = 10 THEN
    FOR v_i IN 1..10 LOOP
      IF v_i = 10 AND substr(v_isbn, v_i, 1) = 'X' THEN
        v_digito := 10;
      ELSE
        v_digito := substr(v_isbn, v_i, 1)::INTEGER;
      END IF;
      v_suma := v_suma + v_digito * (11 - v_i);
    END LOOP;
    RETURN mod(v_suma, 11) = 0;
  END IF;

  FOR v_i IN 1..12 LOOP
    v_digito := substr(v_isbn, v_i, 1)::INTEGER;
    v_suma := v_suma + v_digito * CASE WHEN mod(v_i, 2) = 1 THEN 1 ELSE 3 END;
  END LOOP;
  v_digito := mod(10 - mod(v_suma, 10), 10);
  RETURN v_digito = substr(v_isbn, 13, 1)::INTEGER;
END
$function$;

CREATE OR REPLACE FUNCTION isbn_normalizado_valido_catalogo(p_isbn TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_isbn TEXT := normalizar_isbn_catalogo(p_isbn);
BEGIN
  IF v_isbn IS NULL OR NOT isbn_checksum_valido_catalogo(v_isbn) THEN
    RETURN NULL;
  END IF;
  RETURN v_isbn;
END
$function$;

-- Dos formatos legados del mismo ISBN no pueden convertirse en dos productos
-- distintos. La migración se detiene con diagnóstico antes de crear el índice.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT isbn_normalizado
    FROM (
      SELECT isbn_normalizado_valido_catalogo(isbn) AS isbn_normalizado
      FROM productos
      WHERE isbn IS NOT NULL
    ) existentes
    WHERE isbn_normalizado IS NOT NULL
    GROUP BY isbn_normalizado
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Hay productos con ISBN equivalentes después de normalizar; deben resolverse antes de migrar.';
  END IF;
END
$migration$;

UPDATE productos
SET isbn_normalizado = isbn_normalizado_valido_catalogo(isbn)
WHERE isbn IS NOT NULL;

CREATE OR REPLACE FUNCTION validar_isbn_producto_catalogo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_isbn TEXT;
BEGIN
  -- Los ISBN legados inválidos quedan identificados con normalizado NULL. Una
  -- actualización de otros campos puede volver a enviar el mismo snapshot;
  -- no debe obligar a corregir ese dato histórico si no fue modificado.
  IF TG_OP = 'UPDATE'
     AND NEW.isbn IS NOT DISTINCT FROM OLD.isbn
     AND NEW.isbn_normalizado IS NOT DISTINCT FROM OLD.isbn_normalizado THEN
    RETURN NEW;
  END IF;

  IF NEW.isbn IS NULL OR btrim(NEW.isbn) = '' THEN
    NEW.isbn := NULL;
    NEW.isbn_normalizado := NULL;
    RETURN NEW;
  END IF;

  v_isbn := isbn_normalizado_valido_catalogo(NEW.isbn);
  IF v_isbn IS NULL THEN
    RAISE EXCEPTION 'El ISBN no tiene formato o dígito verificador válido.'
      USING ERRCODE = '23514';
  END IF;

  NEW.isbn := btrim(NEW.isbn);
  NEW.isbn_normalizado := v_isbn;
  RETURN NEW;
END
$function$;

CREATE TRIGGER productos_validar_isbn_catalogo_trg
  BEFORE INSERT OR UPDATE OF isbn, isbn_normalizado ON productos
  FOR EACH ROW EXECUTE FUNCTION validar_isbn_producto_catalogo();

CREATE UNIQUE INDEX productos_isbn_normalizado_uq
  ON productos (isbn_normalizado)
  WHERE isbn_normalizado IS NOT NULL;

CREATE INDEX productos_busqueda_bibliografica_fts_idx
  ON productos USING GIN (
    to_tsvector(
      'spanish',
      titulo || ' ' || COALESCE(subtitulo, '') || ' ' ||
      COALESCE(autor, '') || ' ' || COALESCE(editorial, '') || ' ' ||
      COALESCE(coleccion, '') || ' ' || COALESCE(serie, '')
    )
  );

-- Los créditos son por producto. No se crea todavía un padrón global de
-- personas: resolver homónimos e identidades requiere un bloque propio.
CREATE TABLE producto_contribuyentes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  rol VARCHAR(20) NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT producto_contribuyentes_nombre_check CHECK (btrim(nombre) <> ''),
  CONSTRAINT producto_contribuyentes_rol_check CHECK (
    rol IN ('AUTOR', 'TRADUCTOR', 'ILUSTRADOR', 'EDITOR')
  ),
  CONSTRAINT producto_contribuyentes_orden_check CHECK (orden >= 0),
  CONSTRAINT producto_contribuyentes_producto_rol_orden_uq
    UNIQUE (producto_id, rol, orden)
);

CREATE UNIQUE INDEX producto_contribuyentes_nombre_uq
  ON producto_contribuyentes (producto_id, rol, lower(btrim(nombre)));
CREATE INDEX producto_contribuyentes_producto_idx
  ON producto_contribuyentes (producto_id, rol, orden, id);
CREATE INDEX producto_contribuyentes_nombre_fts_idx
  ON producto_contribuyentes USING GIN (to_tsvector('spanish', nombre));

CREATE OR REPLACE FUNCTION normalizar_autor_producto_catalogo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.autor IS NOT NULL THEN
    NEW.autor := NULLIF(btrim(NEW.autor), '');
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER productos_normalizar_autor_catalogo_trg
  BEFORE INSERT OR UPDATE OF autor ON productos
  FOR EACH ROW EXECUTE FUNCTION normalizar_autor_producto_catalogo();

CREATE OR REPLACE FUNCTION actualizar_autor_legacy_producto(p_producto_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_autor TEXT;
  v_bandera_previa TEXT := current_setting('libra.sincronizando_autor_catalogo', TRUE);
BEGIN
  SELECT string_agg(nombre, '; ' ORDER BY orden, id)
  INTO v_autor
  FROM producto_contribuyentes
  WHERE producto_id = p_producto_id AND rol = 'AUTOR';

  IF length(COALESCE(v_autor, '')) > 1000 THEN
    RAISE EXCEPTION 'El resumen de autores excede 1000 caracteres.'
      USING ERRCODE = '22001';
  END IF;

  PERFORM set_config('libra.sincronizando_autor_catalogo', 'CONTRIBUYENTES', TRUE);
  UPDATE productos
  SET autor = v_autor, actualizado_en = NOW()
  WHERE id = p_producto_id AND autor IS DISTINCT FROM v_autor;
  PERFORM set_config(
    'libra.sincronizando_autor_catalogo',
    COALESCE(v_bandera_previa, ''),
    TRUE
  );
END
$function$;

CREATE OR REPLACE FUNCTION sincronizar_autor_desde_contribuyentes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_bandera TEXT := current_setting('libra.sincronizando_autor_catalogo', TRUE);
BEGIN
  IF v_bandera = 'PRODUCTO' THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM actualizar_autor_legacy_producto(OLD.producto_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP <> 'UPDATE' OR NEW.producto_id <> OLD.producto_id) THEN
    PERFORM actualizar_autor_legacy_producto(NEW.producto_id);
  END IF;
  RETURN NULL;
END
$function$;

CREATE TRIGGER producto_contribuyentes_sincronizar_autor_trg
  AFTER INSERT OR DELETE OR UPDATE OF producto_id, nombre, rol, orden
  ON producto_contribuyentes
  FOR EACH ROW EXECUTE FUNCTION sincronizar_autor_desde_contribuyentes();

CREATE OR REPLACE FUNCTION sincronizar_contribuyentes_desde_autor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_bandera TEXT := current_setting('libra.sincronizando_autor_catalogo', TRUE);
  v_bandera_previa TEXT := v_bandera;
BEGIN
  IF v_bandera = 'CONTRIBUYENTES' THEN
    RETURN NULL;
  END IF;

  -- Los servicios bibliograficos escriben primero los contribuyentes y luego
  -- confirman el mismo resumen legado en productos.autor. Evitar rehacer la
  -- relacion cuando ese UPDATE no cambia el valor conserva autores separados
  -- en vez de convertir "Autora; Autor" en un solo contribuyente.
  IF TG_OP = 'UPDATE' AND NEW.autor IS NOT DISTINCT FROM OLD.autor THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('libra.sincronizando_autor_catalogo', 'PRODUCTO', TRUE);
  DELETE FROM producto_contribuyentes
  WHERE producto_id = NEW.id AND rol = 'AUTOR';

  IF NEW.autor IS NOT NULL THEN
    INSERT INTO producto_contribuyentes (producto_id, nombre, rol, orden)
    VALUES (NEW.id, NEW.autor, 'AUTOR', 0);
  END IF;

  PERFORM set_config(
    'libra.sincronizando_autor_catalogo',
    COALESCE(v_bandera_previa, ''),
    TRUE
  );
  RETURN NULL;
END
$function$;

CREATE TRIGGER productos_sincronizar_contribuyentes_autor_trg
  AFTER INSERT OR UPDATE OF autor ON productos
  FOR EACH ROW EXECUTE FUNCTION sincronizar_contribuyentes_desde_autor();

-- El backfill conserva el crédito exactamente como se capturó históricamente.
INSERT INTO producto_contribuyentes (producto_id, nombre, rol, orden, creado_en)
SELECT id, btrim(autor), 'AUTOR', 0, creado_en
FROM productos
WHERE autor IS NOT NULL AND btrim(autor) <> ''
ON CONFLICT DO NOTHING;

CREATE TABLE materias (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT materias_nombre_check CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX materias_nombre_lower_uq
  -- El trigger guarda siempre el nombre recortado. Esta expresion coincide
  -- tambien con ON CONFLICT (lower(nombre)) usado por el servicio.
  ON materias (lower(nombre));
CREATE INDEX materias_nombre_fts_idx
  ON materias USING GIN (to_tsvector('spanish', nombre));

CREATE OR REPLACE FUNCTION normalizar_nombre_materia_catalogo()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.nombre := btrim(NEW.nombre);
  RETURN NEW;
END
$function$;

CREATE TRIGGER materias_normalizar_nombre_trg
  BEFORE INSERT OR UPDATE OF nombre ON materias
  FOR EACH ROW EXECUTE FUNCTION normalizar_nombre_materia_catalogo();

CREATE TABLE producto_materias (
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  materia_id BIGINT NOT NULL REFERENCES materias(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (producto_id, materia_id)
);

CREATE INDEX producto_materias_materia_idx
  ON producto_materias (materia_id, producto_id);

-- La previsualización persiste los valores originales y normalizados. Una
-- confirmación posterior sólo puede consumir este snapshot del servidor.
CREATE TABLE catalogo_importaciones (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  creado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  archivo_nombre VARCHAR(255) NOT NULL,
  contenido_sha256 CHAR(64) NOT NULL,
  version_formato SMALLINT NOT NULL DEFAULT 1,
  columnas JSONB NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PREVISUALIZADA',
  total_filas INTEGER NOT NULL,
  filas_crear INTEGER NOT NULL,
  filas_actualizar INTEGER NOT NULL,
  filas_sin_cambios INTEGER NOT NULL,
  filas_rechazadas INTEGER NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_en TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  aplicado_en TIMESTAMPTZ,
  aplicado_por_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT catalogo_importaciones_archivo_check CHECK (btrim(archivo_nombre) <> ''),
  CONSTRAINT catalogo_importaciones_hash_check CHECK (
    contenido_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT catalogo_importaciones_version_check CHECK (version_formato = 1),
  CONSTRAINT catalogo_importaciones_columnas_check CHECK (
    jsonb_typeof(columnas) = 'array' AND jsonb_array_length(columnas) > 0
  ),
  CONSTRAINT catalogo_importaciones_estado_check CHECK (
    estado IN ('PREVISUALIZADA', 'APLICADA')
  ),
  CONSTRAINT catalogo_importaciones_conteos_check CHECK (
    total_filas BETWEEN 1 AND 5000
    AND filas_crear >= 0
    AND filas_actualizar >= 0
    AND filas_sin_cambios >= 0
    AND filas_rechazadas >= 0
    AND total_filas = filas_crear + filas_actualizar
      + filas_sin_cambios + filas_rechazadas
  ),
  CONSTRAINT catalogo_importaciones_expiracion_check CHECK (expira_en > creado_en),
  CONSTRAINT catalogo_importaciones_aplicacion_check CHECK (
    (
      estado = 'PREVISUALIZADA'
      AND aplicado_en IS NULL
      AND aplicado_por_usuario_id IS NULL
    )
    OR (
      estado = 'APLICADA'
      AND aplicado_en IS NOT NULL
      AND aplicado_por_usuario_id IS NOT NULL
      AND aplicado_en >= creado_en
      AND aplicado_en <= expira_en
    )
  )
);

CREATE INDEX catalogo_importaciones_usuario_fecha_idx
  ON catalogo_importaciones (creado_por_usuario_id, creado_en DESC, id DESC);
CREATE INDEX catalogo_importaciones_estado_expiracion_idx
  ON catalogo_importaciones (estado, expira_en, id);

CREATE TABLE catalogo_importacion_filas (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  importacion_id BIGINT NOT NULL
    REFERENCES catalogo_importaciones(id) ON DELETE RESTRICT,
  numero_fila INTEGER NOT NULL,
  datos_originales JSONB NOT NULL,
  datos_normalizados JSONB NOT NULL,
  accion_prevista VARCHAR(20) NOT NULL,
  producto_objetivo_id INTEGER REFERENCES productos(id) ON DELETE RESTRICT,
  objetivo_hash CHAR(64),
  errores JSONB NOT NULL DEFAULT '[]'::JSONB,
  advertencias JSONB NOT NULL DEFAULT '[]'::JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_importacion_filas_numero_check CHECK (numero_fila >= 2),
  CONSTRAINT catalogo_importacion_filas_json_check CHECK (
    jsonb_typeof(datos_originales) = 'object'
    AND jsonb_typeof(datos_normalizados) = 'object'
    AND jsonb_typeof(errores) = 'array'
    AND jsonb_typeof(advertencias) = 'array'
  ),
  CONSTRAINT catalogo_importacion_filas_accion_check CHECK (
    accion_prevista IN ('CREAR', 'ACTUALIZAR', 'SIN_CAMBIOS', 'RECHAZAR')
  ),
  CONSTRAINT catalogo_importacion_filas_objetivo_hash_check CHECK (
    objetivo_hash IS NULL OR objetivo_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT catalogo_importacion_filas_objetivo_check CHECK (
    (accion_prevista = 'CREAR'
      AND producto_objetivo_id IS NULL AND objetivo_hash IS NULL)
    OR (accion_prevista IN ('ACTUALIZAR', 'SIN_CAMBIOS')
      AND producto_objetivo_id IS NOT NULL AND objetivo_hash IS NOT NULL)
    OR accion_prevista = 'RECHAZAR'
  ),
  CONSTRAINT catalogo_importacion_filas_errores_check CHECK (
    (accion_prevista = 'RECHAZAR' AND jsonb_array_length(errores) > 0)
    OR (accion_prevista <> 'RECHAZAR' AND jsonb_array_length(errores) = 0)
  ),
  CONSTRAINT catalogo_importacion_filas_importacion_numero_uq
    UNIQUE (importacion_id, numero_fila),
  CONSTRAINT catalogo_importacion_filas_id_importacion_uq
    UNIQUE (id, importacion_id)
);

CREATE INDEX catalogo_importacion_filas_importacion_accion_idx
  ON catalogo_importacion_filas (importacion_id, accion_prevista, numero_fila);
CREATE INDEX catalogo_importacion_filas_producto_idx
  ON catalogo_importacion_filas (producto_objetivo_id)
  WHERE producto_objetivo_id IS NOT NULL;

CREATE TABLE catalogo_importacion_resultados (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  importacion_id BIGINT NOT NULL,
  fila_id BIGINT NOT NULL,
  resultado VARCHAR(20) NOT NULL,
  producto_id INTEGER REFERENCES productos(id) ON DELETE RESTRICT,
  errores JSONB NOT NULL DEFAULT '[]'::JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_importacion_resultados_fila_fk
    FOREIGN KEY (fila_id, importacion_id)
    REFERENCES catalogo_importacion_filas(id, importacion_id)
    ON DELETE RESTRICT,
  CONSTRAINT catalogo_importacion_resultados_resultado_check CHECK (
    resultado IN ('CREADO', 'ACTUALIZADO', 'SIN_CAMBIOS', 'RECHAZADO')
  ),
  CONSTRAINT catalogo_importacion_resultados_json_check CHECK (
    jsonb_typeof(errores) = 'array'
  ),
  CONSTRAINT catalogo_importacion_resultados_producto_check CHECK (
    (
      resultado = 'RECHAZADO'
      AND producto_id IS NULL
      AND jsonb_array_length(errores) > 0
    )
    OR (
      resultado <> 'RECHAZADO'
      AND producto_id IS NOT NULL
      AND jsonb_array_length(errores) = 0
    )
  ),
  CONSTRAINT catalogo_importacion_resultados_fila_uq UNIQUE (fila_id)
);

CREATE INDEX catalogo_importacion_resultados_importacion_idx
  ON catalogo_importacion_resultados (importacion_id, id);
CREATE INDEX catalogo_importacion_resultados_producto_idx
  ON catalogo_importacion_resultados (producto_id)
  WHERE producto_id IS NOT NULL;

CREATE OR REPLACE FUNCTION impedir_mutacion_snapshot_catalogo_importacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'El snapshot de importación es inmutable; no se permite % en %.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER catalogo_importacion_filas_inmutables_trg
  BEFORE UPDATE OR DELETE ON catalogo_importacion_filas
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_snapshot_catalogo_importacion();
CREATE TRIGGER catalogo_importacion_resultados_inmutables_trg
  BEFORE UPDATE OR DELETE ON catalogo_importacion_resultados
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_snapshot_catalogo_importacion();

CREATE OR REPLACE FUNCTION proteger_catalogo_importacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una importación de catálogo no puede eliminarse.'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.estado <> 'PREVISUALIZADA' OR NEW.estado <> 'APLICADA' THEN
    RAISE EXCEPTION 'Transición de importación no permitida: % -> %.',
      OLD.estado, NEW.estado USING ERRCODE = '23514';
  END IF;

  IF OLD.creado_por_usuario_id IS DISTINCT FROM NEW.creado_por_usuario_id
     OR OLD.archivo_nombre IS DISTINCT FROM NEW.archivo_nombre
     OR OLD.contenido_sha256 IS DISTINCT FROM NEW.contenido_sha256
     OR OLD.version_formato IS DISTINCT FROM NEW.version_formato
     OR OLD.columnas IS DISTINCT FROM NEW.columnas
     OR OLD.total_filas IS DISTINCT FROM NEW.total_filas
     OR OLD.filas_crear IS DISTINCT FROM NEW.filas_crear
     OR OLD.filas_actualizar IS DISTINCT FROM NEW.filas_actualizar
     OR OLD.filas_sin_cambios IS DISTINCT FROM NEW.filas_sin_cambios
     OR OLD.filas_rechazadas IS DISTINCT FROM NEW.filas_rechazadas
     OR OLD.creado_en IS DISTINCT FROM NEW.creado_en
     OR OLD.expira_en IS DISTINCT FROM NEW.expira_en THEN
    RAISE EXCEPTION 'Los datos de la previsualización son inmutables.'
      USING ERRCODE = '55000';
  END IF;

  IF NOW() >= OLD.expira_en THEN
    RAISE EXCEPTION 'La previsualización de catálogo expiró; genera una nueva.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER catalogo_importaciones_proteger_trg
  BEFORE UPDATE OR DELETE ON catalogo_importaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_catalogo_importacion();

CREATE OR REPLACE FUNCTION validar_insercion_fila_catalogo_importacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_estado VARCHAR(20);
  v_expira_en TIMESTAMPTZ;
BEGIN
  SELECT estado, expira_en
  INTO v_estado, v_expira_en
  FROM catalogo_importaciones
  WHERE id = NEW.importacion_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importación de catálogo no encontrada.' USING ERRCODE = '23503';
  END IF;
  IF v_estado <> 'PREVISUALIZADA' OR NOW() >= v_expira_en THEN
    RAISE EXCEPTION 'La importación ya no admite filas de previsualización.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER catalogo_importacion_filas_validar_insercion_trg
  BEFORE INSERT ON catalogo_importacion_filas
  FOR EACH ROW EXECUTE FUNCTION validar_insercion_fila_catalogo_importacion();

CREATE OR REPLACE FUNCTION validar_insercion_resultado_catalogo_importacion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_estado VARCHAR(20);
  v_expira_en TIMESTAMPTZ;
BEGIN
  SELECT estado, expira_en
  INTO v_estado, v_expira_en
  FROM catalogo_importaciones
  WHERE id = NEW.importacion_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Importación de catálogo no encontrada.' USING ERRCODE = '23503';
  END IF;
  IF v_estado NOT IN ('PREVISUALIZADA', 'APLICADA') THEN
    RAISE EXCEPTION 'Estado de importación inválido para registrar resultados.'
      USING ERRCODE = '23514';
  END IF;
  IF v_estado = 'PREVISUALIZADA' AND NOW() >= v_expira_en THEN
    RAISE EXCEPTION 'La previsualización de catálogo expiró; genera una nueva.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER catalogo_importacion_resultados_validar_insercion_trg
  BEFORE INSERT ON catalogo_importacion_resultados
  FOR EACH ROW EXECUTE FUNCTION validar_insercion_resultado_catalogo_importacion();

CREATE OR REPLACE FUNCTION validar_catalogo_importacion_conciliada(p_importacion_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_importacion catalogo_importaciones%ROWTYPE;
  v_total BIGINT;
  v_crear BIGINT;
  v_actualizar BIGINT;
  v_sin_cambios BIGINT;
  v_rechazar BIGINT;
  v_resultados BIGINT;
BEGIN
  IF p_importacion_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_importacion
  FROM catalogo_importaciones
  WHERE id = p_importacion_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE accion_prevista = 'CREAR'),
    COUNT(*) FILTER (WHERE accion_prevista = 'ACTUALIZAR'),
    COUNT(*) FILTER (WHERE accion_prevista = 'SIN_CAMBIOS'),
    COUNT(*) FILTER (WHERE accion_prevista = 'RECHAZAR')
  INTO v_total, v_crear, v_actualizar, v_sin_cambios, v_rechazar
  FROM catalogo_importacion_filas
  WHERE importacion_id = p_importacion_id;

  IF v_total <> v_importacion.total_filas
     OR v_crear <> v_importacion.filas_crear
     OR v_actualizar <> v_importacion.filas_actualizar
     OR v_sin_cambios <> v_importacion.filas_sin_cambios
     OR v_rechazar <> v_importacion.filas_rechazadas THEN
    RAISE EXCEPTION 'Los conteos de la importación % no concilian con sus filas.',
      p_importacion_id USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*) INTO v_resultados
  FROM catalogo_importacion_resultados
  WHERE importacion_id = p_importacion_id;

  IF v_importacion.estado = 'PREVISUALIZADA' THEN
    IF v_resultados <> 0 THEN
      RAISE EXCEPTION 'Una importación previsualizada no puede conservar resultados.'
        USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;

  IF v_resultados <> v_total THEN
    RAISE EXCEPTION 'La importación aplicada % no tiene un resultado por fila.',
      p_importacion_id USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM catalogo_importacion_filas f
    LEFT JOIN catalogo_importacion_resultados r
      ON r.fila_id = f.id AND r.importacion_id = f.importacion_id
    WHERE f.importacion_id = p_importacion_id
      AND (
        r.id IS NULL
        OR (f.accion_prevista = 'CREAR' AND r.resultado <> 'CREADO')
        OR (f.accion_prevista = 'ACTUALIZAR' AND r.resultado <> 'ACTUALIZADO')
        OR (f.accion_prevista = 'SIN_CAMBIOS' AND r.resultado <> 'SIN_CAMBIOS')
        OR (f.accion_prevista = 'RECHAZAR' AND r.resultado <> 'RECHAZADO')
        OR (
          f.accion_prevista IN ('ACTUALIZAR', 'SIN_CAMBIOS')
          AND r.producto_id IS DISTINCT FROM f.producto_objetivo_id
        )
        OR (f.accion_prevista = 'RECHAZAR' AND r.producto_id IS NOT NULL)
        OR (f.accion_prevista = 'RECHAZAR' AND r.errores IS DISTINCT FROM f.errores)
      )
  ) THEN
    RAISE EXCEPTION 'Los resultados de la importación % no corresponden a la previsualización.',
      p_importacion_id USING ERRCODE = '23514';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION validar_catalogo_importacion_conciliada_trg()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  v_importacion_id BIGINT;
BEGIN
  -- Estos triggers de conciliacion sólo observan INSERT y, para la cabecera,
  -- UPDATE. Separar las tablas evita intentar resolver importacion_id sobre el
  -- registro catalogo_importaciones, que naturalmente sólo expone id.
  IF TG_TABLE_NAME = 'catalogo_importaciones' THEN
    v_importacion_id := NEW.id;
  ELSE
    v_importacion_id := NEW.importacion_id;
  END IF;
  PERFORM validar_catalogo_importacion_conciliada(v_importacion_id);
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER catalogo_importaciones_conciliacion_trg
  AFTER INSERT OR UPDATE ON catalogo_importaciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_catalogo_importacion_conciliada_trg();
CREATE CONSTRAINT TRIGGER catalogo_importacion_filas_conciliacion_trg
  AFTER INSERT ON catalogo_importacion_filas
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_catalogo_importacion_conciliada_trg();
CREATE CONSTRAINT TRIGGER catalogo_importacion_resultados_conciliacion_trg
  AFTER INSERT ON catalogo_importacion_resultados
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_catalogo_importacion_conciliada_trg();
