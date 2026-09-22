-- Índices de lectura para reportes operativos sobre las fuentes transaccionales.
-- No se crean acumulados, copias ni tablas paralelas de sincronización.

CREATE INDEX IF NOT EXISTS movimientos_creado_en_idx
  ON movimientos (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS movimientos_caja_creado_en_idx
  ON movimientos (caja_id, creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS movimientos_usuario_creado_en_idx
  ON movimientos (usuario_id, creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS cancelaciones_venta_creado_en_idx
  ON cancelaciones_venta (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS devoluciones_creado_en_idx
  ON devoluciones (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS cortes_creado_en_idx
  ON cortes (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS pedidos_creado_en_idx
  ON pedidos (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS pedido_transiciones_creado_en_idx
  ON pedido_transiciones (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS recepciones_compra_creado_en_idx
  ON recepciones_compra (creado_en DESC, id DESC);

CREATE INDEX IF NOT EXISTS devoluciones_proveedor_creado_en_idx
  ON devoluciones_proveedor (creado_en DESC, id DESC);
