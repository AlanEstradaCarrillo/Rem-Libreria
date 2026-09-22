-- Conserva por separado los reembolsos de medios no efectivos en cada corte.
-- Las ventas permanecen como importes brutos y el resumen expone sus reversos.

ALTER TABLE cortes
  ADD COLUMN devoluciones_tarjeta NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN devoluciones_transf NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE cortes
  ADD CONSTRAINT cortes_devoluciones_tarjeta_check
    CHECK (devoluciones_tarjeta >= 0),
  ADD CONSTRAINT cortes_devoluciones_transf_check
    CHECK (devoluciones_transf >= 0);
