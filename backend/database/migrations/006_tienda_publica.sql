-- Acceso publico opaco para pedidos web.
-- No se almacena el token original: solo PUBLICO:<sha256 hexadecimal>.

ALTER TABLE pedidos
  ADD COLUMN publico_actor_clave VARCHAR(160);

-- Para pedidos WEB previos solo se recupera un actor cuando ya existe una
-- vinculacion idempotente inequivoca. Nunca se deriva de PII.
ALTER TABLE pedidos DISABLE TRIGGER pedidos_actualizado_en_trg;

WITH actores_existentes AS (
  SELECT recurso_id AS pedido_id, MIN(actor_clave) AS actor_clave
  FROM operaciones_idempotentes
  WHERE recurso_tipo = 'pedido'
    AND recurso_id IS NOT NULL
    AND actor_clave ~ '^PUBLICO:[0-9a-f]{64}$'
  GROUP BY recurso_id
  HAVING COUNT(DISTINCT actor_clave) = 1
)
UPDATE pedidos p
SET publico_actor_clave = a.actor_clave
FROM actores_existentes a
WHERE p.id = a.pedido_id
  AND p.canal = 'WEB'
  AND p.publico_actor_clave IS NULL;

ALTER TABLE pedidos ENABLE TRIGGER pedidos_actualizado_en_trg;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pedidos
    WHERE canal = 'WEB'
      AND publico_actor_clave IS NULL
  ) THEN
    RAISE EXCEPTION
      'Hay pedidos WEB historicos sin actor publico verificable; no se invento una credencial.'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

ALTER TABLE pedidos
  ADD CONSTRAINT pedidos_publico_actor_check CHECK (
    (
      canal = 'WEB'
      AND publico_actor_clave IS NOT NULL
      AND publico_actor_clave ~ '^PUBLICO:[0-9a-f]{64}$'
    )
    OR
    (
      canal = 'INTERNO'
      AND publico_actor_clave IS NULL
    )
  );

CREATE UNIQUE INDEX pedidos_publico_actor_clave_uq
  ON pedidos (publico_actor_clave)
  WHERE publico_actor_clave IS NOT NULL;

-- 005 protege el snapshot comercial mediante esta funcion. Se reemplaza para
-- incluir la identidad publica y evitar cambios despues de reservar.
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
    NEW.cliente_id,
    NEW.creado_por_usuario_id,
    NEW.cliente_nombre,
    NEW.cliente_telefono,
    NEW.cliente_email,
    NEW.cliente_direccion,
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
    OLD.cliente_id,
    OLD.creado_por_usuario_id,
    OLD.cliente_nombre,
    OLD.cliente_telefono,
    OLD.cliente_email,
    OLD.cliente_direccion,
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
