-- Un mismo navegador puede realizar más de un pedido a lo largo del tiempo.
-- La credencial pública identifica al propietario, no a un pedido único.

DROP INDEX IF EXISTS pedidos_publico_actor_clave_uq;

CREATE INDEX IF NOT EXISTS pedidos_publico_actor_clave_idx
  ON pedidos (publico_actor_clave, id DESC)
  WHERE publico_actor_clave IS NOT NULL;
