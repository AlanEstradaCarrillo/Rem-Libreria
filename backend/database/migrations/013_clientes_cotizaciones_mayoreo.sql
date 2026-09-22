-- Clientes con segmento comercial, cotizaciones persistentes y precios de mayoreo.
-- Las cotizaciones no reservan inventario; la reserva nace una sola vez al convertirlas en pedido.

ALTER TABLE clientes
  ADD COLUMN segmento_precio VARCHAR(10) NOT NULL DEFAULT 'PUBLICO';
ALTER TABLE clientes
  ADD CONSTRAINT clientes_segmento_precio_check
  CHECK (segmento_precio IN ('PUBLICO', 'MAYOREO'));
CREATE INDEX clientes_segmento_activo_idx
  ON clientes (segmento_precio, nombre, id) WHERE activo;

ALTER TABLE reglas_precio
  ADD COLUMN segmento_cliente VARCHAR(10) NOT NULL DEFAULT 'TODOS';
ALTER TABLE reglas_precio
  ADD CONSTRAINT reglas_precio_segmento_cliente_check
  CHECK (segmento_cliente IN ('TODOS', 'PUBLICO', 'MAYOREO'));
CREATE INDEX reglas_precio_segmento_idx
  ON reglas_precio (segmento_cliente, canal, prioridad DESC, id) WHERE activo;

-- Nueva firma explícita: el segmento forma parte de la misma decisión de precio
-- que ya comparten POS y web. La firma anterior queda como compatibilidad pública.
CREATE OR REPLACE FUNCTION calcular_precio_comun(
  p_producto_id INTEGER,
  p_cantidad INTEGER,
  p_canal TEXT,
  p_segmento_cliente TEXT,
  p_fecha TIMESTAMPTZ
)
RETURNS TABLE (
  precio_lista NUMERIC(12,2),
  descuento_unitario NUMERIC(12,2),
  precio_unitario NUMERIC(12,2),
  regla_precio_id BIGINT
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_precio NUMERIC(12,2);
  v_categoria_id INTEGER;
  v_regla reglas_precio%ROWTYPE;
  v_precio_final NUMERIC(12,2);
  v_fecha TIMESTAMPTZ := COALESCE(p_fecha, NOW());
BEGIN
  IF p_producto_id IS NULL OR p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Producto y cantidad positiva son obligatorios.'
      USING ERRCODE = '22023';
  END IF;
  IF p_canal NOT IN ('POS', 'WEB') THEN
    RAISE EXCEPTION 'Canal de precio inválido: %', p_canal
      USING ERRCODE = '22023';
  END IF;
  IF p_segmento_cliente NOT IN ('PUBLICO', 'MAYOREO') THEN
    RAISE EXCEPTION 'Segmento de cliente inválido: %', p_segmento_cliente
      USING ERRCODE = '22023';
  END IF;

  SELECT p.precio, p.categoria_id
  INTO v_precio, v_categoria_id
  FROM productos p
  WHERE p.id = p_producto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto % no encontrado.', p_producto_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT r.*
  INTO v_regla
  FROM reglas_precio r
  WHERE r.activo
    AND r.cantidad_minima <= p_cantidad
    AND r.canal IN ('AMBOS', p_canal)
    AND r.segmento_cliente IN ('TODOS', p_segmento_cliente)
    AND (r.vigente_desde IS NULL OR r.vigente_desde <= v_fecha)
    AND (r.vigente_hasta IS NULL OR r.vigente_hasta > v_fecha)
    AND (
      r.producto_id = p_producto_id
      OR (r.producto_id IS NULL AND r.categoria_id = v_categoria_id)
      OR (r.producto_id IS NULL AND r.categoria_id IS NULL)
    )
  ORDER BY
    r.prioridad DESC,
    CASE WHEN r.segmento_cliente = p_segmento_cliente THEN 1 ELSE 0 END DESC,
    CASE
      WHEN r.producto_id IS NOT NULL THEN 2
      WHEN r.categoria_id IS NOT NULL THEN 1
      ELSE 0
    END DESC,
    r.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
      SELECT v_precio, 0.00::NUMERIC(12,2), v_precio, NULL::BIGINT;
    RETURN;
  END IF;

  v_precio_final := ROUND(
    CASE v_regla.tipo
      WHEN 'PORCENTAJE' THEN v_precio * (1 - v_regla.valor / 100)
      WHEN 'MONTO_FIJO' THEN v_precio - v_regla.valor
      WHEN 'PRECIO_FIJO' THEN v_regla.valor
    END,
    2
  );
  v_precio_final := GREATEST(
    0.00::NUMERIC,
    LEAST(v_precio, v_precio_final)
  );

  RETURN QUERY
    SELECT
      v_precio,
      (v_precio - v_precio_final)::NUMERIC(12,2),
      v_precio_final,
      v_regla.id;
END
$function$;

CREATE OR REPLACE FUNCTION calcular_precio_comun(
  p_producto_id INTEGER,
  p_cantidad INTEGER,
  p_canal TEXT,
  p_fecha TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  precio_lista NUMERIC(12,2),
  descuento_unitario NUMERIC(12,2),
  precio_unitario NUMERIC(12,2),
  regla_precio_id BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT *
  FROM calcular_precio_comun(
    p_producto_id,
    p_cantidad,
    p_canal,
    'PUBLICO',
    p_fecha
  );
$function$;

ALTER TABLE ventas
  ADD COLUMN segmento_precio VARCHAR(10) NOT NULL DEFAULT 'PUBLICO';
ALTER TABLE ventas
  ADD CONSTRAINT ventas_segmento_precio_check
  CHECK (segmento_precio IN ('PUBLICO', 'MAYOREO'));
ALTER TABLE ventas
  ADD CONSTRAINT ventas_cliente_segmento_check
  CHECK (cliente_id IS NOT NULL OR segmento_precio = 'PUBLICO');

ALTER TABLE pedidos
  ADD COLUMN segmento_precio VARCHAR(10) NOT NULL DEFAULT 'PUBLICO';
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_segmento_precio_check
  CHECK (segmento_precio IN ('PUBLICO', 'MAYOREO'));
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_cliente_segmento_check
  CHECK (cliente_id IS NOT NULL OR segmento_precio = 'PUBLICO');
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_web_segmento_check
  CHECK (canal <> 'WEB' OR segmento_precio = 'PUBLICO');

CREATE SEQUENCE cotizaciones_folio_seq START WITH 1;

CREATE TABLE cotizaciones (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  folio VARCHAR(24) NOT NULL UNIQUE
    DEFAULT ('COT-' || LPAD(nextval('cotizaciones_folio_seq')::text, 10, '0')),
  estado VARCHAR(12) NOT NULL DEFAULT 'VIGENTE'
    CHECK (estado IN ('VIGENTE', 'CONVERTIDA', 'CANCELADA', 'VENCIDA')),
  cliente_id BIGINT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  creado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cliente_nombre VARCHAR(120) NOT NULL CHECK (btrim(cliente_nombre) <> ''),
  cliente_telefono VARCHAR(30) NOT NULL CHECK (btrim(cliente_telefono) <> ''),
  cliente_email VARCHAR(254),
  cliente_direccion TEXT,
  segmento_precio VARCHAR(10) NOT NULL
    CHECK (segmento_precio IN ('PUBLICO', 'MAYOREO')),
  notas TEXT,
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  descuento NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  iva NUMERIC(12,2) NOT NULL CHECK (iva >= 0),
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  vigente_hasta TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cliente_email IS NULL OR btrim(cliente_email) <> ''),
  CHECK (cliente_direccion IS NULL OR btrim(cliente_direccion) <> ''),
  CHECK (total = ROUND(subtotal + iva, 2)),
  CHECK (vigente_hasta > creado_en)
);

CREATE INDEX cotizaciones_estado_vigencia_idx
  ON cotizaciones (estado, vigente_hasta, id);
CREATE INDEX cotizaciones_cliente_fecha_idx
  ON cotizaciones (cliente_id, creado_en DESC, id DESC);
CREATE INDEX cotizaciones_folio_busqueda_idx
  ON cotizaciones (folio);
CREATE TRIGGER cotizaciones_actualizado_en_trg
  BEFORE UPDATE ON cotizaciones FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

CREATE TABLE detalle_cotizaciones (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cotizacion_id BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE RESTRICT,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  producto_sku VARCHAR(24) NOT NULL CHECK (btrim(producto_sku) <> ''),
  producto_titulo VARCHAR(160) NOT NULL CHECK (btrim(producto_titulo) <> ''),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  precio_lista NUMERIC(12,2) NOT NULL CHECK (precio_lista >= 0),
  descuento_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  iva_porcentaje NUMERIC(5,2) NOT NULL CHECK (iva_porcentaje BETWEEN 0 AND 100),
  regla_precio_id BIGINT REFERENCES reglas_precio(id) ON DELETE RESTRICT,
  importe NUMERIC(12,2) NOT NULL CHECK (importe >= 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cotizacion_id, producto_id),
  CHECK (descuento_unitario >= 0 AND precio_unitario = precio_lista - descuento_unitario),
  CHECK (importe = ROUND(precio_unitario * cantidad, 2))
);

CREATE INDEX detalle_cotizaciones_producto_idx
  ON detalle_cotizaciones (producto_id, cotizacion_id);

CREATE TABLE cotizacion_transiciones (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  cotizacion_id BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE RESTRICT,
  estado_anterior VARCHAR(12),
  estado_nuevo VARCHAR(12) NOT NULL,
  actor VARCHAR(8) NOT NULL CHECK (actor IN ('USUARIO', 'SISTEMA')),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  motivo VARCHAR(240) NOT NULL CHECK (btrim(motivo) <> ''),
  origen_clave VARCHAR(180) NOT NULL UNIQUE CHECK (btrim(origen_clave) <> ''),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (estado_anterior IS NULL OR estado_anterior IN (
    'VIGENTE', 'CONVERTIDA', 'CANCELADA', 'VENCIDA'
  )),
  CHECK (estado_nuevo IN ('VIGENTE', 'CONVERTIDA', 'CANCELADA', 'VENCIDA')),
  CHECK (estado_anterior IS NULL OR estado_anterior <> estado_nuevo),
  CHECK (estado_anterior IS NOT NULL OR estado_nuevo = 'VIGENTE'),
  CHECK (
    (actor = 'USUARIO' AND usuario_id IS NOT NULL)
    OR (actor = 'SISTEMA' AND usuario_id IS NULL)
  )
);

CREATE INDEX cotizacion_transiciones_cotizacion_idx
  ON cotizacion_transiciones (cotizacion_id, id DESC);

ALTER TABLE pedidos
  ADD COLUMN cotizacion_id BIGINT;
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_cotizacion_fk
  FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE RESTRICT;
ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_cotizacion_canal_check
  CHECK (cotizacion_id IS NULL OR canal = 'INTERNO');
CREATE UNIQUE INDEX pedidos_cotizacion_uq
  ON pedidos (cotizacion_id) WHERE cotizacion_id IS NOT NULL;

-- Incluye los nuevos snapshots en la protección comercial de pedidos.
CREATE OR REPLACE FUNCTION proteger_snapshot_pedido()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pedidos son auditables y no pueden eliminarse.'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW.id,
    NEW.folio,
    NEW.canal,
    NEW.canal_precio,
    NEW.publico_actor_clave,
    NEW.cotizacion_id,
    NEW.cliente_id,
    NEW.creado_por_usuario_id,
    NEW.cliente_nombre,
    NEW.cliente_telefono,
    NEW.cliente_email,
    NEW.cliente_direccion,
    NEW.segmento_precio,
    NEW.tipo_entrega,
    NEW.notas,
    NEW.subtotal,
    NEW.descuento,
    NEW.iva,
    NEW.total,
    NEW.expira_en,
    NEW.creado_en
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.folio,
    OLD.canal,
    OLD.canal_precio,
    OLD.publico_actor_clave,
    OLD.cotizacion_id,
    OLD.cliente_id,
    OLD.creado_por_usuario_id,
    OLD.cliente_nombre,
    OLD.cliente_telefono,
    OLD.cliente_email,
    OLD.cliente_direccion,
    OLD.segmento_precio,
    OLD.tipo_entrega,
    OLD.notas,
    OLD.subtotal,
    OLD.descuento,
    OLD.iva,
    OLD.total,
    OLD.expira_en,
    OLD.creado_en
  ) THEN
    RAISE EXCEPTION 'El contenido comercial de un pedido es inmutable.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION impedir_mutacion_detalle_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'El detalle de una cotización es inmutable.' USING ERRCODE = '55000';
END
$function$;
CREATE TRIGGER detalle_cotizaciones_inmutable_trg
  BEFORE UPDATE OR DELETE ON detalle_cotizaciones
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_detalle_cotizacion();

CREATE OR REPLACE FUNCTION impedir_mutacion_cotizacion_transiciones()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'El historial de cotizaciones es inmutable.' USING ERRCODE = '55000';
END
$function$;
CREATE TRIGGER cotizacion_transiciones_inmutable_trg
  BEFORE UPDATE OR DELETE ON cotizacion_transiciones
  FOR EACH ROW EXECUTE FUNCTION impedir_mutacion_cotizacion_transiciones();

CREATE OR REPLACE FUNCTION proteger_snapshot_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las cotizaciones son auditables y no pueden eliminarse.'
      USING ERRCODE = '55000';
  END IF;
  IF ROW(
    NEW.id, NEW.folio, NEW.cliente_id, NEW.creado_por_usuario_id,
    NEW.cliente_nombre, NEW.cliente_telefono, NEW.cliente_email,
    NEW.cliente_direccion, NEW.segmento_precio, NEW.notas,
    NEW.subtotal, NEW.descuento, NEW.iva, NEW.total,
    NEW.vigente_hasta, NEW.creado_en
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.folio, OLD.cliente_id, OLD.creado_por_usuario_id,
    OLD.cliente_nombre, OLD.cliente_telefono, OLD.cliente_email,
    OLD.cliente_direccion, OLD.segmento_precio, OLD.notas,
    OLD.subtotal, OLD.descuento, OLD.iva, OLD.total,
    OLD.vigente_hasta, OLD.creado_en
  ) THEN
    RAISE EXCEPTION 'El contenido comercial de una cotización es inmutable.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER cotizaciones_proteger_snapshot_trg
  BEFORE UPDATE OR DELETE ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_snapshot_cotizacion();

CREATE OR REPLACE FUNCTION proteger_estado_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND COALESCE(current_setting('libra.aplicando_transicion_cotizacion', TRUE), '') <> '1' THEN
    RAISE EXCEPTION 'El estado sólo cambia mediante cotizacion_transiciones.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER cotizaciones_proteger_estado_trg
  BEFORE UPDATE OF estado ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_estado_cotizacion();

CREATE OR REPLACE FUNCTION validar_insert_transicion_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
  v_estado VARCHAR(12);
BEGIN
  SELECT estado INTO v_estado
  FROM cotizaciones WHERE id=NEW.cotizacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización % no encontrada.', NEW.cotizacion_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.estado_anterior IS NULL THEN
    IF v_estado <> 'VIGENTE' OR NEW.estado_nuevo <> 'VIGENTE'
       OR NEW.actor <> 'USUARIO'
       OR EXISTS (
         SELECT 1 FROM cotizacion_transiciones WHERE cotizacion_id=NEW.cotizacion_id
       ) THEN
      RAISE EXCEPTION 'Transición inicial de cotización inválida.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_estado <> NEW.estado_anterior THEN
    RAISE EXCEPTION 'La cotización está en %, no en %.', v_estado, NEW.estado_anterior
      USING ERRCODE = '40001';
  END IF;
  IF NEW.estado_anterior <> 'VIGENTE'
     OR NEW.estado_nuevo NOT IN ('CONVERTIDA', 'CANCELADA', 'VENCIDA') THEN
    RAISE EXCEPTION 'Transición de cotización no permitida: % -> %.',
      NEW.estado_anterior, NEW.estado_nuevo USING ERRCODE = '23514';
  END IF;
  IF NEW.estado_nuevo IN ('CONVERTIDA', 'CANCELADA') AND NEW.actor <> 'USUARIO' THEN
    RAISE EXCEPTION 'La transición requiere un usuario autenticado.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.estado_nuevo = 'VENCIDA' AND NEW.actor <> 'SISTEMA' THEN
    RAISE EXCEPTION 'El vencimiento debe registrarlo el sistema.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER cotizacion_transiciones_validar_trg
  BEFORE INSERT ON cotizacion_transiciones
  FOR EACH ROW EXECUTE FUNCTION validar_insert_transicion_cotizacion();

CREATE OR REPLACE FUNCTION aplicar_transicion_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
  v_actualizados INTEGER;
BEGIN
  IF NEW.estado_anterior IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('libra.aplicando_transicion_cotizacion', '1', TRUE);
  UPDATE cotizaciones SET estado=NEW.estado_nuevo
  WHERE id=NEW.cotizacion_id AND estado=NEW.estado_anterior;
  GET DIAGNOSTICS v_actualizados = ROW_COUNT;
  PERFORM set_config('libra.aplicando_transicion_cotizacion', '0', TRUE);
  IF v_actualizados <> 1 THEN
    RAISE EXCEPTION 'La cotización cambió concurrentemente.' USING ERRCODE = '40001';
  END IF;
  RETURN NULL;
END
$function$;
CREATE TRIGGER cotizacion_transiciones_aplicar_trg
  AFTER INSERT ON cotizacion_transiciones
  FOR EACH ROW EXECUTE FUNCTION aplicar_transicion_cotizacion();

CREATE OR REPLACE FUNCTION registrar_creacion_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'Toda cotización debe iniciar VIGENTE.' USING ERRCODE = '23514';
  END IF;
  INSERT INTO cotizacion_transiciones (
    cotizacion_id, estado_anterior, estado_nuevo, actor, usuario_id,
    motivo, origen_clave, creado_en
  ) VALUES (
    NEW.id, NULL, 'VIGENTE', 'USUARIO', NEW.creado_por_usuario_id,
    'Creación de la cotización.',
    'COTIZACION:' || NEW.id::text || ':CREACION', NEW.creado_en
  );
  RETURN NULL;
END
$function$;
CREATE TRIGGER cotizaciones_registrar_creacion_trg
  AFTER INSERT ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION registrar_creacion_cotizacion();

CREATE OR REPLACE FUNCTION validar_armado_cotizacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
  v_estado VARCHAR(12);
  v_creado_en TIMESTAMPTZ;
BEGIN
  SELECT estado, creado_en INTO v_estado, v_creado_en
  FROM cotizaciones WHERE id=NEW.cotizacion_id FOR KEY SHARE;
  IF NOT FOUND OR v_estado <> 'VIGENTE' OR v_creado_en <> transaction_timestamp() THEN
    RAISE EXCEPTION 'El detalle sólo se crea junto con la cotización.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER detalle_cotizaciones_validar_armado_trg
  BEFORE INSERT ON detalle_cotizaciones
  FOR EACH ROW EXECUTE FUNCTION validar_armado_cotizacion();

CREATE OR REPLACE FUNCTION validar_cotizacion_conciliada(p_cotizacion_id BIGINT)
RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
  v_cotizacion cotizaciones%ROWTYPE;
  v_total NUMERIC(12,2);
  v_descuento NUMERIC(12,2);
  v_subtotal NUMERIC(12,2);
  v_iva NUMERIC(12,2);
  v_ultimo_estado VARCHAR(12);
  v_pedidos INTEGER;
BEGIN
  IF p_cotizacion_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_cotizacion FROM cotizaciones WHERE id=p_cotizacion_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM detalle_cotizaciones WHERE cotizacion_id=p_cotizacion_id
  ) THEN
    RAISE EXCEPTION 'La cotización % no contiene artículos.', p_cotizacion_id
      USING ERRCODE = '23514';
  END IF;

  SELECT ROUND(COALESCE(SUM(importe), 0), 2),
         ROUND(COALESCE(SUM(descuento_unitario * cantidad), 0), 2),
         ROUND(COALESCE(SUM(importe / (1 + iva_porcentaje / 100)), 0), 2)
  INTO v_total, v_descuento, v_subtotal
  FROM detalle_cotizaciones WHERE cotizacion_id=p_cotizacion_id;
  v_iva := ROUND(v_total - v_subtotal, 2);
  IF v_total <> v_cotizacion.total OR v_descuento <> v_cotizacion.descuento
     OR v_subtotal <> v_cotizacion.subtotal OR v_iva <> v_cotizacion.iva THEN
    RAISE EXCEPTION 'Los totales de la cotización % no concilian.', p_cotizacion_id
      USING ERRCODE = '23514';
  END IF;

  SELECT estado_nuevo INTO v_ultimo_estado
  FROM cotizacion_transiciones
  WHERE cotizacion_id=p_cotizacion_id ORDER BY id DESC LIMIT 1;
  IF v_ultimo_estado IS DISTINCT FROM v_cotizacion.estado THEN
    RAISE EXCEPTION 'El historial de la cotización % no concilia con su estado.',
      p_cotizacion_id USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_pedidos
  FROM pedidos WHERE cotizacion_id=p_cotizacion_id;
  IF (v_cotizacion.estado = 'CONVERTIDA' AND v_pedidos <> 1)
     OR (v_cotizacion.estado <> 'CONVERTIDA' AND v_pedidos <> 0) THEN
    RAISE EXCEPTION 'La conversión de la cotización % no concilia.', p_cotizacion_id
      USING ERRCODE = '23514';
  END IF;

  IF v_cotizacion.estado = 'CONVERTIDA' AND EXISTS (
    SELECT 1
    FROM pedidos p
    WHERE p.cotizacion_id=p_cotizacion_id
      AND ROW(
        p.canal, p.canal_precio, p.cliente_id, p.cliente_nombre,
        p.cliente_telefono, p.cliente_email, p.cliente_direccion,
        p.segmento_precio, p.subtotal, p.descuento, p.iva, p.total
      ) IS DISTINCT FROM ROW(
        'INTERNO'::VARCHAR, 'POS'::VARCHAR, v_cotizacion.cliente_id,
        v_cotizacion.cliente_nombre, v_cotizacion.cliente_telefono,
        v_cotizacion.cliente_email, v_cotizacion.cliente_direccion,
        v_cotizacion.segmento_precio, v_cotizacion.subtotal,
        v_cotizacion.descuento, v_cotizacion.iva, v_cotizacion.total
      )
  ) THEN
    RAISE EXCEPTION 'El pedido no conserva la cabecera de la cotización %.', p_cotizacion_id
      USING ERRCODE = '23514';
  END IF;

  IF v_cotizacion.estado = 'CONVERTIDA' AND EXISTS (
    SELECT 1
    FROM (
      SELECT * FROM detalle_cotizaciones WHERE cotizacion_id=p_cotizacion_id
    ) dc
    FULL JOIN (
      SELECT * FROM detalle_pedidos
      WHERE pedido_id = (
        SELECT id FROM pedidos WHERE cotizacion_id=p_cotizacion_id
      )
    ) dp ON dp.producto_id=dc.producto_id
    WHERE (
        dc.id IS NULL OR dp.id IS NULL
        OR ROW(
          dp.producto_sku, dp.producto_titulo, dp.cantidad,
          dp.precio_lista, dp.descuento_unitario, dp.precio_unitario,
          dp.iva_porcentaje, dp.regla_precio_id, dp.importe
        ) IS DISTINCT FROM ROW(
          dc.producto_sku, dc.producto_titulo, dc.cantidad,
          dc.precio_lista, dc.descuento_unitario, dc.precio_unitario,
          dc.iva_porcentaje, dc.regla_precio_id, dc.importe
        )
      )
  ) THEN
    RAISE EXCEPTION 'El pedido no conserva el detalle de la cotización %.', p_cotizacion_id
      USING ERRCODE = '23514';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION validar_cotizacion_conciliada_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
  v_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'cotizaciones' THEN
    v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'detalle_cotizaciones' THEN
    v_id := CASE WHEN TG_OP='DELETE' THEN OLD.cotizacion_id ELSE NEW.cotizacion_id END;
  ELSIF TG_TABLE_NAME = 'pedidos' THEN
    v_id := CASE WHEN TG_OP='DELETE' THEN OLD.cotizacion_id ELSE NEW.cotizacion_id END;
  END IF;
  PERFORM validar_cotizacion_conciliada(v_id);
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER cotizaciones_conciliacion_trg
  AFTER INSERT OR UPDATE ON cotizaciones DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_cotizacion_conciliada_trg();
CREATE CONSTRAINT TRIGGER detalle_cotizaciones_conciliacion_trg
  AFTER INSERT ON detalle_cotizaciones DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_cotizacion_conciliada_trg();
CREATE CONSTRAINT TRIGGER pedidos_cotizacion_conciliacion_trg
  AFTER INSERT OR UPDATE OR DELETE ON pedidos DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_cotizacion_conciliada_trg();
