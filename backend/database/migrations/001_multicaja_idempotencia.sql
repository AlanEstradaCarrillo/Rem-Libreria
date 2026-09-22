-- Estabiliza las asociaciones de caja y prepara idempotencia reutilizable.

ALTER TABLE caja
  ADD COLUMN IF NOT EXISTS nombre VARCHAR(80),
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE caja
  ALTER COLUMN nombre SET DEFAULT 'Caja principal';

UPDATE caja
SET nombre = CASE WHEN id = 1 THEN 'Caja principal' ELSE 'Caja ' || id::text END
WHERE nombre IS NULL OR btrim(nombre) = '';

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM caja WHERE nombre IS NULL OR btrim(nombre) = '') THEN
    RAISE EXCEPTION 'No se pudo completar caja.nombre para todos los registros.';
  END IF;
END
$migration$;

ALTER TABLE caja
  ALTER COLUMN nombre SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS caja_nombre_lower_uq
  ON caja (lower(nombre));

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'sesiones_caja'::regclass
      AND conname = 'sesiones_caja_id_caja_uq'
  ) THEN
    ALTER TABLE sesiones_caja
      ADD CONSTRAINT sesiones_caja_id_caja_uq UNIQUE (id, caja_id);
  END IF;
END
$migration$;

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS caja_id INTEGER;

UPDATE ventas v
SET caja_id = s.caja_id
FROM sesiones_caja s
WHERE s.id = v.sesion_id
  AND v.caja_id IS NULL;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM ventas WHERE caja_id IS NULL) THEN
    RAISE EXCEPTION 'Hay ventas cuya caja no puede inferirse desde su sesión.';
  END IF;
END
$migration$;

ALTER TABLE ventas
  ALTER COLUMN caja_id SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ventas'::regclass
      AND conname = 'ventas_sesion_caja_fk'
  ) THEN
    ALTER TABLE ventas
      ADD CONSTRAINT ventas_sesion_caja_fk
      FOREIGN KEY (sesion_id, caja_id)
      REFERENCES sesiones_caja (id, caja_id)
      ON DELETE RESTRICT;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS ventas_caja_idx ON ventas (caja_id);

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER,
  ADD COLUMN IF NOT EXISTS caja_id INTEGER,
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20),
  ADD COLUMN IF NOT EXISTS venta_id INTEGER,
  ADD COLUMN IF NOT EXISTS actor_inferido BOOLEAN;

-- La referencia de los movimientos de venta existentes contiene el folio.
UPDATE movimientos m
SET venta_id = v.id
FROM ventas v
WHERE m.tipo = 'VENTA'
  AND m.venta_id IS NULL
  AND m.referencia = v.folio;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT venta_id
    FROM movimientos
    WHERE tipo = 'VENTA' AND venta_id IS NOT NULL
    GROUP BY venta_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay más de un movimiento asociado a la misma venta; se requiere depuración manual.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM movimientos WHERE tipo = 'VENTA' AND venta_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay movimientos VENTA que no pueden enlazarse de forma segura por folio.';
  END IF;
END
$migration$;

-- Para ventas sí existe el actor histórico exacto en ventas.usuario_id.
UPDATE movimientos m
SET usuario_id = v.usuario_id,
    caja_id = v.caja_id,
    metodo_pago = v.metodo_pago,
    actor_inferido = COALESCE(m.actor_inferido, FALSE)
FROM ventas v
WHERE m.tipo = 'VENTA'
  AND m.venta_id = v.id;

-- El esquema anterior omitía los movimientos de tarjeta y transferencia.
INSERT INTO movimientos (
  sesion_id, usuario_id, caja_id, tipo, referencia, concepto, monto,
  metodo_pago, venta_id, actor_inferido, creado_en
)
SELECT v.sesion_id, v.usuario_id, v.caja_id, 'VENTA', v.folio,
       'Venta ' || v.folio || ' (' || lower(v.metodo_pago) || ')',
       v.total, v.metodo_pago, v.id, FALSE, v.creado_en
FROM ventas v
WHERE NOT EXISTS (
  SELECT 1 FROM movimientos m WHERE m.tipo = 'VENTA' AND m.venta_id = v.id
);

-- En movimientos históricos no comerciales el único usuario recuperable es
-- quien abrió la sesión; actor_inferido deja explícita esa limitación.
UPDATE movimientos m
SET usuario_id = COALESCE(m.usuario_id, s.usuario_id),
    caja_id = COALESCE(m.caja_id, s.caja_id),
    actor_inferido = CASE
      WHEN m.usuario_id IS NULL THEN TRUE
      ELSE COALESCE(m.actor_inferido, FALSE)
    END
FROM sesiones_caja s
WHERE m.sesion_id = s.id
  AND m.tipo <> 'VENTA';

UPDATE movimientos
SET actor_inferido = TRUE
WHERE actor_inferido IS NULL;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM movimientos WHERE usuario_id IS NULL OR caja_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Hay movimientos cuya caja o usuario no puede inferirse desde la sesión.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM movimientos
    WHERE tipo = 'VENTA' AND (venta_id IS NULL OR metodo_pago IS NULL)
  ) THEN
    RAISE EXCEPTION 'Hay movimientos VENTA sin venta o método de pago asociado.';
  END IF;
END
$migration$;

ALTER TABLE movimientos
  ALTER COLUMN usuario_id SET NOT NULL,
  ALTER COLUMN caja_id SET NOT NULL,
  ALTER COLUMN actor_inferido SET DEFAULT FALSE,
  ALTER COLUMN actor_inferido SET NOT NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'movimientos'::regclass
      AND conname = 'movimientos_usuario_fk'
  ) THEN
    ALTER TABLE movimientos
      ADD CONSTRAINT movimientos_usuario_fk
      FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'movimientos'::regclass
      AND conname = 'movimientos_sesion_caja_fk'
  ) THEN
    ALTER TABLE movimientos
      ADD CONSTRAINT movimientos_sesion_caja_fk
      FOREIGN KEY (sesion_id, caja_id)
      REFERENCES sesiones_caja (id, caja_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'movimientos'::regclass
      AND conname = 'movimientos_venta_fk'
  ) THEN
    ALTER TABLE movimientos
      ADD CONSTRAINT movimientos_venta_fk
      FOREIGN KEY (venta_id) REFERENCES ventas (id) ON DELETE RESTRICT;
  END IF;
END
$migration$;

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_tipo_check;
ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_tipo_check
  CHECK (tipo IN (
    'APERTURA', 'VENTA', 'RETIRO', 'INGRESO', 'CIERRE',
    'CANCELACION', 'DEVOLUCION'
  ));

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_monto_check;
ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_monto_check CHECK (monto >= 0 OR tipo = 'CIERRE');

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_metodo_pago_check;
ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_metodo_pago_check CHECK (
    (
      tipo IN ('VENTA', 'CANCELACION', 'DEVOLUCION')
      AND metodo_pago IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')
    )
    OR
    (
      tipo IN ('APERTURA', 'RETIRO', 'INGRESO', 'CIERRE')
      AND metodo_pago IS NULL
    )
  );

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_origen_check;
ALTER TABLE movimientos
  ADD CONSTRAINT movimientos_origen_check CHECK (
    (tipo = 'VENTA' AND venta_id IS NOT NULL)
    OR (tipo <> 'VENTA' AND venta_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS movimientos_usuario_idx ON movimientos (usuario_id);
CREATE INDEX IF NOT EXISTS movimientos_caja_idx ON movimientos (caja_id);
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_venta_uq
  ON movimientos (venta_id) WHERE tipo = 'VENTA';

CREATE TABLE IF NOT EXISTS operaciones_idempotentes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  operacion VARCHAR(40) NOT NULL,
  clave VARCHAR(100) NOT NULL,
  solicitud_hash CHAR(64) NOT NULL,
  recurso_tipo VARCHAR(40),
  recurso_id BIGINT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completado_en TIMESTAMPTZ,
  CONSTRAINT operaciones_idempotentes_operacion_check
    CHECK (btrim(operacion) <> ''),
  CONSTRAINT operaciones_idempotentes_clave_check
    CHECK (clave ~ '^[A-Za-z0-9._:-]{8,100}$'),
  CONSTRAINT operaciones_idempotentes_hash_check
    CHECK (solicitud_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operaciones_idempotentes_recurso_check
    CHECK ((recurso_tipo IS NULL) = (recurso_id IS NULL)),
  CONSTRAINT operaciones_idempotentes_usuario_operacion_clave_uq
    UNIQUE (usuario_id, operacion, clave)
);

CREATE INDEX IF NOT EXISTS operaciones_idempotentes_recurso_idx
  ON operaciones_idempotentes (recurso_tipo, recurso_id)
  WHERE recurso_id IS NOT NULL;
