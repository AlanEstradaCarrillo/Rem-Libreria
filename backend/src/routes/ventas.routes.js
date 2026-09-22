// backend/src/routes/ventas.routes.js — ventas y reversas transaccionales
const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { ApiError, round2 } = require("../utils/errors");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const { parsePositiveId, bloquearSesionAbierta } = require("../services/caja.service");
const { bloquearProductos, aplicarMovimiento } = require("../services/inventario.service");
const { compactarItems, cotizar } = require("../services/precios.service");
const { cargarClienteActivo } = require("../services/clientes.service");
const { z } = require("zod");

router.use(requireAuth);

const MAX_MONTO = 9_999_999_999.99;

function tieneMaximoDosDecimales(valor) {
  const escalado = valor * 100;
  const tolerancia = Number.EPSILON * Math.max(1, Math.abs(escalado)) * 8;
  return Math.abs(escalado - Math.round(escalado)) <= tolerancia;
}

const montoCobroSchema = z.number()
  .nonnegative("El monto recibido no puede ser negativo")
  .max(MAX_MONTO, `El monto recibido no puede exceder ${MAX_MONTO}`)
  .refine(tieneMaximoDosDecimales, "El monto recibido admite máximo dos decimales");

function validarTotalesVenta({ subtotal, iva, total }) {
  for (const [campo, valorOriginal] of Object.entries({ subtotal, iva, total })) {
    const valor = Number(valorOriginal);
    if (!Number.isFinite(valor) || valor < 0 || valor > MAX_MONTO || !tieneMaximoDosDecimales(valor)) {
      throw new ApiError(400, `El ${campo} de la venta está fuera del rango monetario permitido.`);
    }
  }
}

const ventaSchema = z.object({
  sesion_id: z.number().int().positive(),
  metodo_pago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
  cliente_id: z.number().int().positive().optional().nullable(),
  cliente: z.string().trim().min(2).max(120).optional().nullable(),
  recibido: montoCobroSchema.optional(),
  items: z.array(z.object({
    producto_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(999),
  })).min(1, "La venta requiere al menos un artículo")
    .max(100, "La venta admite como máximo 100 productos distintos"),
}).superRefine((value, ctx) => {
  if (value.cliente_id != null && value.cliente != null) {
    ctx.addIssue({
      code: "custom",
      path: ["cliente_id"],
      message: "Indica un cliente registrado o un nombre libre, pero no ambos.",
    });
  }
});

const cobroPedidoSchema = z.object({
  sesion_id: z.number().int().positive(),
  metodo_pago: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
  recibido: montoCobroSchema.optional(),
});

const cancelacionSchema = z.object({
  sesion_id: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(240),
});

const devolucionSchema = z.object({
  sesion_id: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(240),
  items: z.array(z.object({
    detalle_venta_id: z.number().int().positive(),
    cantidad: z.number().int().positive().max(999),
  })).min(1, "La devolución requiere al menos un artículo"),
});

async function cargarVenta(client, ventaId) {
  const v = await client.query(
    `SELECT v.*, u.nombre AS cajero, c.nombre AS caja_nombre
     FROM ventas v
     JOIN usuarios u ON u.id=v.usuario_id
     JOIN caja c ON c.id=v.caja_id
     WHERE v.id=$1`,
    [ventaId]
  );
  if (!v.rows[0]) throw new ApiError(404, "Venta no encontrada.");

  const d = await client.query(
    `SELECT dv.id, dv.venta_id, dv.producto_id,
            dv.producto_sku AS sku, dv.producto_titulo AS titulo,
            dv.cantidad, dv.iva_porcentaje,
            dv.precio_lista, dv.descuento_unitario, dv.precio_unitario,
            dv.regla_precio_id, dv.importe, p.isbn,
            COALESCE(SUM(dd.cantidad),0)::int AS devuelto,
            (dv.cantidad - COALESCE(SUM(dd.cantidad),0))::int AS disponible_devolver
     FROM detalle_ventas dv
     JOIN productos p ON p.id=dv.producto_id
     LEFT JOIN detalle_devoluciones dd ON dd.detalle_venta_id=dv.id
     WHERE dv.venta_id=$1
     GROUP BY dv.id, p.id
     ORDER BY dv.id`,
    [ventaId]
  );
  return { ...v.rows[0], detalle: d.rows };
}

async function cargarCancelacion(client, cancelacionId) {
  const r = await client.query(`SELECT * FROM cancelaciones_venta WHERE id=$1`, [cancelacionId]);
  if (!r.rows[0]) throw new ApiError(404, "Cancelación no encontrada.");
  return r.rows[0];
}

async function cargarDevolucion(client, devolucionId) {
  const r = await client.query(
    `SELECT d.*, COALESCE(
       json_agg(json_build_object(
         'detalle_venta_id', dd.detalle_venta_id,
         'cantidad', dd.cantidad,
         'importe', dd.importe
       ) ORDER BY dd.id) FILTER (WHERE dd.id IS NOT NULL), '[]'
     ) AS detalle
     FROM devoluciones d
     LEFT JOIN detalle_devoluciones dd ON dd.devolucion_id=d.id
     WHERE d.id=$1
     GROUP BY d.id`,
    [devolucionId]
  );
  if (!r.rows[0]) throw new ApiError(404, "Devolución no encontrada.");
  return r.rows[0];
}

router.post(
  "/desde-pedido/:pedidoId",
  validate(cobroPedidoSchema),
  async (req, res, next) => {
    try {
      const pedidoId = parsePositiveId(req.params.pedidoId, "pedido_id");
      const clave = getIdempotencyKey(req);
      const solicitud = {
        pedido_id: pedidoId,
        sesion_id: req.body.sesion_id,
        metodo_pago: req.body.metodo_pago,
        recibido: req.body.metodo_pago === "EFECTIVO" ? req.body.recibido : null,
      };
      const solicitudHash = hashRequest(solicitud);

      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "COBRO_PEDIDO",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          return { replay: true, venta: await cargarVenta(client, claim.resourceId) };
        }

        const sesion = await bloquearSesionAbierta(
          client,
          req.body.sesion_id,
          req.user
        );
        const pedidoResult = await client.query(
          `SELECT p.*, (p.expira_en <= NOW()) AS vencido
           FROM pedidos p
           WHERE p.id=$1
           FOR UPDATE`,
          [pedidoId]
        );
        const pedido = pedidoResult.rows[0];
        if (!pedido) throw new ApiError(404, "Pedido no encontrado.");
        if (!["RESERVADO", "LISTO"].includes(pedido.estado)) {
          throw new ApiError(409, "El pedido ya no tiene una reserva cobrable.");
        }
        if (pedido.vencido) {
          throw new ApiError(409, "La reserva del pedido ya venció.");
        }

        const detalleResult = await client.query(
          `SELECT dp.*, r.id AS reserva_id, r.cantidad AS reserva_cantidad,
                  r.estado AS reserva_estado, r.expira_en AS reserva_expira_en
           FROM detalle_pedidos dp
           JOIN reservas_stock r
             ON r.detalle_pedido_id=dp.id
            AND r.pedido_id=dp.pedido_id
            AND r.producto_id=dp.producto_id
           WHERE dp.pedido_id=$1
           ORDER BY dp.producto_id
           FOR UPDATE OF r`,
          [pedido.id]
        );
        if (!detalleResult.rows.length) {
          throw new ApiError(409, "El pedido no tiene artículos reservados.");
        }
        for (const linea of detalleResult.rows) {
          if (linea.reserva_estado !== "ACTIVA"
              || Number(linea.reserva_cantidad) !== Number(linea.cantidad)) {
            throw new ApiError(409, "Las reservas del pedido ya no están activas o completas.");
          }
        }

        const productos = await bloquearProductos(
          client,
          detalleResult.rows.map((linea) => linea.producto_id)
        );
        const productoPorId = new Map(
          productos.map((producto) => [Number(producto.id), producto])
        );
        for (const linea of detalleResult.rows) {
          const producto = productoPorId.get(Number(linea.producto_id));
          const cantidad = Number(linea.cantidad);
          if (!producto
              || Number(producto.stock) < cantidad
              || Number(producto.stock_reservado) < cantidad) {
            throw new ApiError(409, "El inventario reservado del pedido no está disponible.");
          }
        }

        const total = Number(pedido.total);
        validarTotalesVenta({ subtotal: pedido.subtotal, iva: pedido.iva, total });
        if (req.body.metodo_pago === "EFECTIVO"
            && (req.body.recibido == null || req.body.recibido < total)) {
          throw new ApiError(400, `Pago insuficiente: se requieren ${fmt(total)}.`);
        }

        const ventaResult = await client.query(
           `INSERT INTO ventas
              (sesion_id, caja_id, usuario_id, pedido_id, cliente_id, cliente,
               segmento_precio,
               metodo_pago, subtotal, iva, total, recibido, cambio)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            sesion.id,
            sesion.caja_id,
            req.user.sub,
            pedido.id,
             pedido.cliente_id,
             pedido.cliente_nombre,
             pedido.segmento_precio,
             req.body.metodo_pago,
            pedido.subtotal,
            pedido.iva,
            pedido.total,
            req.body.metodo_pago === "EFECTIVO" ? req.body.recibido : null,
            req.body.metodo_pago === "EFECTIVO"
              ? round2(req.body.recibido - total)
              : null,
          ]
        );
        const venta = ventaResult.rows[0];

        for (const linea of detalleResult.rows) {
          const cantidad = Number(linea.cantidad);
          const producto = productoPorId.get(Number(linea.producto_id));
          await client.query(
            `INSERT INTO detalle_ventas
               (venta_id, producto_id, producto_sku, producto_titulo, cantidad,
                precio_lista, descuento_unitario, precio_unitario,
                iva_porcentaje, regla_precio_id, importe)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              venta.id,
              linea.producto_id,
              linea.producto_sku,
              linea.producto_titulo,
              cantidad,
              linea.precio_lista,
              linea.descuento_unitario,
              linea.precio_unitario,
              linea.iva_porcentaje,
              linea.regla_precio_id,
              linea.importe,
            ]
          );
          await aplicarMovimiento(client, {
            producto,
            deltaFisico: -cantidad,
            deltaReservado: -cantidad,
            tipo: "CONSUMO_RESERVA",
            usuarioId: req.user.sub,
            motivo: `Cobro del pedido ${pedido.folio} en venta ${venta.folio}`,
            ventaId: venta.id,
            pedidoId: pedido.id,
            reservaId: linea.reserva_id,
            origenClave: `PEDIDO:${pedido.id}:CONSUMO:RESERVA:${linea.reserva_id}`,
          });
          const reservaActualizada = await client.query(
            `UPDATE reservas_stock
             SET estado='CONSUMIDA', finalizada_en=NOW()
             WHERE id=$1 AND estado='ACTIVA'
             RETURNING id`,
            [linea.reserva_id]
          );
          if (!reservaActualizada.rows[0]) {
            throw new ApiError(409, "La reserva ya había sido finalizada.");
          }
        }

        await client.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, referencia, concepto, monto,
              metodo_pago, venta_id, actor_inferido)
           VALUES ($1,$2,$3,'VENTA',$4,$5,$6,$7,$8,FALSE)`,
          [
            sesion.id,
            sesion.caja_id,
            req.user.sub,
            venta.folio,
            `Cobro del pedido ${pedido.folio} (${req.body.metodo_pago.toLowerCase()})`,
            pedido.total,
            req.body.metodo_pago,
            venta.id,
          ]
        );
        await client.query(
          `INSERT INTO pedido_transiciones
             (pedido_id, estado_anterior, estado_nuevo, actor, usuario_id,
              motivo, origen_clave)
           VALUES ($1,$2,'COMPLETADO','USUARIO',$3,$4,$5)`,
          [
            pedido.id,
            pedido.estado,
            req.user.sub,
            `Pedido cobrado en la venta ${venta.folio}.`,
            `PEDIDO:${pedido.id}:COMPLETADO`,
          ]
        );
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "COBRO_PEDIDO",
          clave,
          recursoTipo: "venta",
          recursoId: venta.id,
        });

        return { replay: false, venta: await cargarVenta(client, venta.id) };
      });

      res.status(resultado.replay ? 200 : 201).json(resultado.venta);
    } catch (error) {
      next(error);
    }
  }
);

router.post("/", validate(ventaSchema), async (req, res, next) => {
  try {
    const clave = getIdempotencyKey(req);
    const items = compactarItems(req.body.items, "producto_id");
    const solicitud = {
      sesion_id: req.body.sesion_id,
      metodo_pago: req.body.metodo_pago,
      cliente_id: req.body.cliente_id ?? null,
      cliente: req.body.cliente ?? null,
      recibido: req.body.metodo_pago === "EFECTIVO" ? req.body.recibido : null,
      items,
    };
    const solicitudHash = hashRequest(solicitud);

    const resultado = await tx(async (client) => {
      const claim = await claimOperation(client, {
        usuarioId: req.user.sub,
        operacion: "VENTA_POS",
        clave,
        solicitudHash,
      });
      if (claim.replay) {
        return { replay: true, venta: await cargarVenta(client, claim.resourceId) };
      }

      let clienteId = null;
      let clienteNombre = req.body.cliente || "PÚBLICO GENERAL";
      let segmentoPrecio = "PUBLICO";
      if (req.body.cliente_id != null) {
        const clienteRegistrado = await cargarClienteActivo(client, req.body.cliente_id);
        clienteId = Number(clienteRegistrado.id);
        clienteNombre = clienteRegistrado.nombre;
        segmentoPrecio = clienteRegistrado.segmento_precio;
      }

      const sesion = await bloquearSesionAbierta(client, req.body.sesion_id, req.user);
      const ids = items.map((item) => item.producto_id);
      const productos = await bloquearProductos(client, ids);
      const mapa = new Map(productos.map((producto) => [producto.id, producto]));

      for (const item of items) {
        const producto = mapa.get(item.producto_id);
        if (!producto) throw new ApiError(404, `Producto ${item.producto_id} no existe.`);
        if (!producto.activo) throw new ApiError(409, `"${producto.titulo}" está inactivo.`);
        if (producto.stock_disponible < item.cantidad) {
          throw new ApiError(409, `Stock insuficiente de "${producto.titulo}" (disponible: ${producto.stock_disponible}).`);
        }
      }
      const cotizacion = await cotizar(client, {
        items,
        canal: "POS",
        productosBloqueados: productos,
        segmentoCliente: segmentoPrecio,
      });
      const subtotal = cotizacion.subtotal;
      const ivaTotal = cotizacion.iva;
      const total = cotizacion.total;
      validarTotalesVenta({ subtotal, iva: ivaTotal, total });
      const lineas = new Map(
        cotizacion.lineas.map((linea) => [linea.producto_id, linea])
      );

      if (req.body.metodo_pago === "EFECTIVO") {
        if (req.body.recibido == null || req.body.recibido < total) {
          throw new ApiError(400, `Pago insuficiente: se requieren ${fmt(total)}.`);
        }
      }

      const v = await client.query(
         `INSERT INTO ventas
           (sesion_id, caja_id, usuario_id, cliente_id, cliente, segmento_precio,
            metodo_pago, subtotal, iva, total, recibido, cambio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          sesion.id, sesion.caja_id, req.user.sub, clienteId, clienteNombre,
          segmentoPrecio, req.body.metodo_pago,
          subtotal, ivaTotal, total,
          req.body.metodo_pago === "EFECTIVO" ? req.body.recibido : null,
          req.body.metodo_pago === "EFECTIVO" ? round2(req.body.recibido - total) : null,
        ]
      );
      const ventaRow = v.rows[0];

      for (const item of items) {
        const producto = mapa.get(item.producto_id);
        const linea = lineas.get(item.producto_id);
        await client.query(
          `INSERT INTO detalle_ventas
             (venta_id, producto_id, producto_sku, producto_titulo, cantidad,
              precio_lista, descuento_unitario, precio_unitario,
              iva_porcentaje, regla_precio_id, importe)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            ventaRow.id, item.producto_id, producto.sku, producto.titulo,
            item.cantidad, linea.precio_lista,
            linea.descuento_unitario, linea.precio_unitario, linea.iva,
            linea.regla_precio_id, linea.importe,
          ]
        );
        await aplicarMovimiento(client, {
          producto,
          deltaFisico: -item.cantidad,
          tipo: "VENTA",
          usuarioId: req.user.sub,
          motivo: `Venta ${ventaRow.folio}`,
          ventaId: ventaRow.id,
          origenClave: `VENTA:${ventaRow.id}:PRODUCTO:${producto.id}`,
        });
      }

      await client.query(
        `INSERT INTO movimientos
           (sesion_id, caja_id, usuario_id, tipo, referencia, concepto, monto,
            metodo_pago, venta_id, actor_inferido)
         VALUES ($1,$2,$3,'VENTA',$4,$5,$6,$7,$8,FALSE)`,
        [
          sesion.id, sesion.caja_id, req.user.sub, ventaRow.folio,
          `Venta ${ventaRow.folio} (${req.body.metodo_pago.toLowerCase()})`,
          total, req.body.metodo_pago, ventaRow.id,
        ]
      );
      await completeOperation(client, {
        usuarioId: req.user.sub,
        operacion: "VENTA_POS",
        clave,
        recursoTipo: "venta",
        recursoId: ventaRow.id,
      });
      return { replay: false, venta: await cargarVenta(client, ventaRow.id) };
    });

    res.status(resultado.replay ? 200 : 201).json(resultado.venta);
  } catch (e) { next(e); }
});

router.post(
  "/:id/cancelacion",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(cancelacionSchema),
  async (req, res, next) => {
    try {
      const ventaId = parsePositiveId(req.params.id, "venta_id");
      const clave = getIdempotencyKey(req);
      const solicitudHash = hashRequest({ venta_id: ventaId, ...req.body });
      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_VENTA",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          const cancelacion = await cargarCancelacion(client, claim.resourceId);
          return {
            replay: true,
            cancelacion,
            venta: await cargarVenta(client, cancelacion.venta_id),
          };
        }

        const sesion = await bloquearSesionAbierta(client, req.body.sesion_id, req.user, { exigirPropiedad: false });
        const ventaResult = await client.query(`SELECT * FROM ventas WHERE id=$1 FOR UPDATE`, [ventaId]);
        const venta = ventaResult.rows[0];
        if (!venta) throw new ApiError(404, "Venta no encontrada.");
        if (venta.estado !== "COMPLETADA") {
          throw new ApiError(409, "Solo una venta completada y sin devoluciones puede cancelarse.");
        }

        const detalles = await client.query(
          `SELECT * FROM detalle_ventas WHERE venta_id=$1 ORDER BY producto_id FOR UPDATE`,
          [venta.id]
        );
        const c = await client.query(
          `INSERT INTO cancelaciones_venta
             (venta_id, sesion_id, caja_id, usuario_id, motivo, total)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [venta.id, sesion.id, sesion.caja_id, req.user.sub, req.body.motivo, venta.total]
        );
        const cancelacion = c.rows[0];
        const cantidadesPorProducto = new Map();
        for (const detalle of detalles.rows) {
          cantidadesPorProducto.set(
            detalle.producto_id,
            (cantidadesPorProducto.get(detalle.producto_id) || 0) + detalle.cantidad
          );
        }
        const productos = await bloquearProductos(client, [...cantidadesPorProducto.keys()]);
        for (const producto of productos) {
          await aplicarMovimiento(client, {
            producto,
            deltaFisico: cantidadesPorProducto.get(producto.id),
            tipo: "CANCELACION",
            usuarioId: req.user.sub,
            motivo: `Cancelación de venta ${venta.folio}: ${req.body.motivo}`,
            cancelacionId: cancelacion.id,
            origenClave: `CANCELACION:${cancelacion.id}:PRODUCTO:${producto.id}`,
          });
        }
        await client.query(`UPDATE ventas SET estado='CANCELADA' WHERE id=$1`, [venta.id]);
        await client.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, referencia, concepto, monto,
              metodo_pago, cancelacion_id, actor_inferido)
           VALUES ($1,$2,$3,'CANCELACION',$4,$5,$6,$7,$8,FALSE)`,
          [
            sesion.id, sesion.caja_id, req.user.sub, venta.folio,
            `Cancelación de venta ${venta.folio}`, venta.total, venta.metodo_pago, cancelacion.id,
          ]
        );
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "CANCELACION_VENTA",
          clave,
          recursoTipo: "cancelacion_venta",
          recursoId: cancelacion.id,
        });
        return {
          replay: false,
          cancelacion,
          venta: await cargarVenta(client, venta.id),
        };
      });
      res.status(resultado.replay ? 200 : 201).json({
        venta: resultado.venta,
        cancelacion: resultado.cancelacion,
      });
    } catch (e) { next(e); }
  }
);

router.post(
  "/:id/devoluciones",
  requireRoles("ADMIN", "SUPERVISOR"),
  validate(devolucionSchema),
  async (req, res, next) => {
    try {
      const ventaId = parsePositiveId(req.params.id, "venta_id");
      const clave = getIdempotencyKey(req);
      const items = compactarItems(req.body.items, "detalle_venta_id");
      const solicitud = {
        venta_id: ventaId,
        sesion_id: req.body.sesion_id,
        motivo: req.body.motivo,
        items,
      };
      const solicitudHash = hashRequest(solicitud);

      const resultado = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "DEVOLUCION_VENTA",
          clave,
          solicitudHash,
        });
        if (claim.replay) {
          const devolucion = await cargarDevolucion(client, claim.resourceId);
          return {
            replay: true,
            devolucion,
            venta: await cargarVenta(client, devolucion.venta_id),
          };
        }

        const sesion = await bloquearSesionAbierta(client, req.body.sesion_id, req.user, { exigirPropiedad: false });
        const ventaResult = await client.query(`SELECT * FROM ventas WHERE id=$1 FOR UPDATE`, [ventaId]);
        const venta = ventaResult.rows[0];
        if (!venta) throw new ApiError(404, "Venta no encontrada.");
        if (!["COMPLETADA", "PARCIALMENTE_DEVUELTA"].includes(venta.estado)) {
          throw new ApiError(409, "La venta no admite más devoluciones.");
        }

        const detalles = await client.query(
          `SELECT * FROM detalle_ventas WHERE venta_id=$1 ORDER BY id FOR UPDATE`,
          [venta.id]
        );
        const detalleMapa = new Map(detalles.rows.map((detalle) => [detalle.id, detalle]));
        const devueltas = await client.query(
          `SELECT dd.detalle_venta_id, COALESCE(SUM(dd.cantidad),0)::int AS cantidad
           FROM detalle_devoluciones dd
           JOIN detalle_ventas dv ON dv.id=dd.detalle_venta_id
           WHERE dv.venta_id=$1
           GROUP BY dd.detalle_venta_id`,
          [venta.id]
        );
        const devueltoMapa = new Map(devueltas.rows.map((row) => [row.detalle_venta_id, row.cantidad]));

        let total = 0;
        for (const item of items) {
          const detalle = detalleMapa.get(item.detalle_venta_id);
          if (!detalle) throw new ApiError(400, `El detalle ${item.detalle_venta_id} no pertenece a la venta.`);
          const disponible = detalle.cantidad - (devueltoMapa.get(detalle.id) || 0);
          if (item.cantidad > disponible) {
            throw new ApiError(409, `La devolución supera la cantidad disponible del detalle ${detalle.id}.`);
          }
          total += Number(detalle.precio_unitario) * item.cantidad;
        }
        total = round2(total);

        const productoIds = [...new Set(items.map((item) => detalleMapa.get(item.detalle_venta_id).producto_id))];
        const productos = await bloquearProductos(client, productoIds);
        const productoMapa = new Map(productos.map((producto) => [producto.id, producto]));
        const d = await client.query(
          `INSERT INTO devoluciones
             (venta_id, sesion_id, caja_id, usuario_id, motivo, total)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [venta.id, sesion.id, sesion.caja_id, req.user.sub, req.body.motivo, total]
        );
        const devolucion = d.rows[0];
        const cantidadesPorProducto = new Map();
        for (const item of items) {
          const detalle = detalleMapa.get(item.detalle_venta_id);
          const importe = round2(Number(detalle.precio_unitario) * item.cantidad);
          await client.query(
            `INSERT INTO detalle_devoluciones (devolucion_id, detalle_venta_id, cantidad, importe)
             VALUES ($1,$2,$3,$4)`,
            [devolucion.id, detalle.id, item.cantidad, importe]
          );
          cantidadesPorProducto.set(
            detalle.producto_id,
            (cantidadesPorProducto.get(detalle.producto_id) || 0) + item.cantidad
          );
        }
        for (const [productoId, cantidad] of cantidadesPorProducto) {
          await aplicarMovimiento(client, {
            producto: productoMapa.get(productoId),
            deltaFisico: cantidad,
            tipo: "DEVOLUCION",
            usuarioId: req.user.sub,
            motivo: `Devolución de venta ${venta.folio}: ${req.body.motivo}`,
            devolucionId: devolucion.id,
            origenClave: `DEVOLUCION:${devolucion.id}:PRODUCTO:${productoId}`,
          });
        }

        const vendidoTotal = detalles.rows.reduce((sum, detalle) => sum + detalle.cantidad, 0);
        const devueltoAnterior = [...devueltoMapa.values()].reduce((sum, cantidad) => sum + cantidad, 0);
        const devueltoAhora = items.reduce((sum, item) => sum + item.cantidad, 0);
        const nuevoEstado = devueltoAnterior + devueltoAhora === vendidoTotal
          ? "DEVUELTA"
          : "PARCIALMENTE_DEVUELTA";
        await client.query(`UPDATE ventas SET estado=$2 WHERE id=$1`, [venta.id, nuevoEstado]);
        await client.query(
          `INSERT INTO movimientos
             (sesion_id, caja_id, usuario_id, tipo, referencia, concepto, monto,
              metodo_pago, devolucion_id, actor_inferido)
           VALUES ($1,$2,$3,'DEVOLUCION',$4,$5,$6,$7,$8,FALSE)`,
          [
            sesion.id, sesion.caja_id, req.user.sub, venta.folio,
            `Devolución de venta ${venta.folio}`, total, venta.metodo_pago, devolucion.id,
          ]
        );
        await completeOperation(client, {
          usuarioId: req.user.sub,
          operacion: "DEVOLUCION_VENTA",
          clave,
          recursoTipo: "devolucion",
          recursoId: devolucion.id,
        });
        return {
          replay: false,
          devolucion: await cargarDevolucion(client, devolucion.id),
          venta: await cargarVenta(client, venta.id),
        };
      });

      res.status(resultado.replay ? 200 : 201).json({
        venta: resultado.venta,
        devolucion: resultado.devolucion,
      });
    } catch (e) { next(e); }
  }
);

router.get("/", async (req, res, next) => {
  try {
    const r = await query(
      `SELECT v.id, v.folio, v.cliente_id, v.cliente, v.segmento_precio,
              v.metodo_pago, v.total, v.estado, v.creado_en,
              v.caja_id, c.nombre AS caja_nombre, u.nombre AS cajero
       FROM ventas v
       JOIN usuarios u ON u.id=v.usuario_id
       JOIN caja c ON c.id=v.caja_id
       ORDER BY v.id DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const ventaId = parsePositiveId(req.params.id, "venta_id");
    res.json(await cargarVenta({ query }, ventaId));
  } catch (e) { next(e); }
});

function fmt(n) { return "$" + Number(n).toFixed(2); }

module.exports = router;
