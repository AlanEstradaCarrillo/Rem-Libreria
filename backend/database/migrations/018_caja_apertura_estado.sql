-- Refuerza la integridad y recuperación de las sesiones de caja.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sesiones_caja
    WHERE (estado = 'ABIERTA' AND fecha_cierre IS NOT NULL)
       OR (estado = 'CERRADA' AND (fecha_cierre IS NULL OR fecha_cierre < fecha_apertura))
  ) THEN
    RAISE EXCEPTION 'Hay sesiones de caja con fechas incompatibles con su estado.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM sesiones_caja s
    LEFT JOIN movimientos m
      ON m.sesion_id = s.id AND m.tipo = 'APERTURA'
    GROUP BY s.id, s.fondo_inicial
    HAVING COUNT(m.id) <> 1 OR COALESCE(SUM(m.monto), -1) <> s.fondo_inicial
  ) THEN
    RAISE EXCEPTION 'Hay sesiones sin un movimiento de apertura único y conciliado.';
  END IF;
END
$migration$;

ALTER TABLE sesiones_caja
  DROP CONSTRAINT IF EXISTS sesiones_caja_fechas_estado_check;
ALTER TABLE sesiones_caja
  ADD CONSTRAINT sesiones_caja_fechas_estado_check CHECK (
    (estado = 'ABIERTA' AND fecha_cierre IS NULL)
    OR
    (estado = 'CERRADA' AND fecha_cierre IS NOT NULL AND fecha_cierre >= fecha_apertura)
  );

CREATE INDEX IF NOT EXISTS sesiones_caja_usuario_abierta_idx
  ON sesiones_caja (usuario_id, caja_id)
  WHERE estado = 'ABIERTA';

CREATE UNIQUE INDEX IF NOT EXISTS movimientos_sesion_apertura_cierre_uq
  ON movimientos (sesion_id, tipo)
  WHERE tipo IN ('APERTURA', 'CIERRE');
