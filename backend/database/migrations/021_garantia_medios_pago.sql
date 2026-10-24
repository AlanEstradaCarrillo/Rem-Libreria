-- Garantía de medios de pago: todo movimiento de venta, cancelación o devolución
-- debe tener al menos un medio en movimiento_pagos, y sus medios deben sumar
-- exactamente su monto. Las comprobaciones son diferidas: se evalúan al confirmar
-- la transacción, cuando ya se insertaron todos los medios del movimiento.
-- No se aplican a las filas históricas que ya existían antes de esta migración.

CREATE OR REPLACE FUNCTION verificar_medios_de_movimiento(p_movimiento_id INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo VARCHAR(12);
  v_monto NUMERIC(12,2);
  v_filas INTEGER;
  v_suma NUMERIC(12,2);
BEGIN
  SELECT tipo, monto INTO v_tipo, v_monto
  FROM movimientos
  WHERE id = p_movimiento_id;

  IF v_tipo NOT IN ('VENTA', 'CANCELACION', 'DEVOLUCION') THEN
    RETURN;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(monto), 0)
  INTO v_filas, v_suma
  FROM movimiento_pagos
  WHERE movimiento_id = p_movimiento_id;

  IF v_filas = 0 THEN
    RAISE EXCEPTION 'El movimiento % (%) no tiene medios de pago registrados.',
      p_movimiento_id, v_tipo USING ERRCODE = '23514';
  END IF;

  IF v_suma <> v_monto THEN
    RAISE EXCEPTION 'Los medios de pago del movimiento % suman % y el movimiento es %.',
      p_movimiento_id, v_suma, v_monto USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION exigir_medios_al_crear_movimiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM verificar_medios_de_movimiento(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION exigir_suma_al_crear_medio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM verificar_medios_de_movimiento(NEW.movimiento_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS movimientos_exigen_medios_tr ON movimientos;
CREATE CONSTRAINT TRIGGER movimientos_exigen_medios_tr
  AFTER INSERT ON movimientos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.tipo IN ('VENTA', 'CANCELACION', 'DEVOLUCION'))
  EXECUTE FUNCTION exigir_medios_al_crear_movimiento();

DROP TRIGGER IF EXISTS movimiento_pagos_exigen_suma_tr ON movimiento_pagos;
CREATE CONSTRAINT TRIGGER movimiento_pagos_exigen_suma_tr
  AFTER INSERT ON movimiento_pagos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION exigir_suma_al_crear_medio();
