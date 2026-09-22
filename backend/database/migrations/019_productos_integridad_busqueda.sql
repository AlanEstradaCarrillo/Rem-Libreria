-- Integridad mínima del catálogo operativo.
-- La API ya normaliza estos campos; las restricciones impiden que una escritura
-- directa deje identificadores imposibles de buscar o importes fuera del rango
-- aceptado por el POS y la tienda.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM productos
    WHERE sku <> btrim(sku)
       OR char_length(btrim(sku)) NOT BETWEEN 3 AND 24
       OR titulo <> btrim(titulo)
       OR char_length(btrim(titulo)) NOT BETWEEN 2 AND 160
       OR (codigo_barras IS NOT NULL AND (
         codigo_barras <> btrim(codigo_barras) OR btrim(codigo_barras) = ''
       ))
       OR precio > 999999
       OR costo > 999999
  ) THEN
    RAISE EXCEPTION
      'Hay productos con SKU, título, código o importes fuera del rango operativo; deben corregirse antes de migrar.';
  END IF;
END
$migration$;

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_sku_contenido_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_sku_contenido_check CHECK (
    sku = btrim(sku) AND char_length(sku) BETWEEN 3 AND 24
  );

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_titulo_contenido_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_titulo_contenido_check CHECK (
    titulo = btrim(titulo) AND char_length(titulo) BETWEEN 2 AND 160
  );

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_codigo_barras_contenido_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_codigo_barras_contenido_check CHECK (
    codigo_barras IS NULL
    OR (codigo_barras = btrim(codigo_barras) AND btrim(codigo_barras) <> '')
  );

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_precio_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_precio_check CHECK (precio BETWEEN 0 AND 999999);

ALTER TABLE productos DROP CONSTRAINT IF EXISTS productos_costo_check;
ALTER TABLE productos
  ADD CONSTRAINT productos_costo_check CHECK (costo BETWEEN 0 AND 999999);
