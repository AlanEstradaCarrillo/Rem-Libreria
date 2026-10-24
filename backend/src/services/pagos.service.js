// backend/src/services/pagos.service.js — medios de pago de ventas, cancelaciones y devoluciones
const { ApiError } = require("../utils/errors");

const MEDIOS_PAGO = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"];

// Trabaja en centavos enteros para que las sumas de pagos no dependan del redondeo binario.
function centavos(valor) {
  return Math.round(Number(valor) * 100);
}

function fmtMonto(valor) {
  return "$" + (Number(valor)).toFixed(2);
}

/**
 * Normaliza el cobro de una venta directa. Acepta el pago único clásico
 * (metodo_pago + recibido) o una lista de medios cuya suma debe ser exactamente
 * el total calculado por el servidor.
 */
function normalizarMediosCobro({ total, metodo_pago, recibido, pagos }) {
  if (!pagos) {
    if (metodo_pago === "EFECTIVO" && (recibido == null || recibido < total)) {
      throw new ApiError(400, `Pago insuficiente: se requieren ${fmtMonto(total)}.`);
    }
    return [{
      metodo_pago,
      monto: Number(total),
      recibido: metodo_pago === "EFECTIVO" ? Number(recibido) : null,
    }];
  }

  const suma = pagos.reduce((acumulado, pago) => acumulado + centavos(pago.monto), 0);
  if (suma !== centavos(total)) {
    throw new ApiError(
      400,
      `Los pagos suman ${fmtMonto(suma / 100)} y el total de la venta es ${fmtMonto(total)}.`
    );
  }
  for (const pago of pagos) {
    if (pago.metodo_pago === "EFECTIVO") {
      if (pago.recibido == null || centavos(pago.recibido) < centavos(pago.monto)) {
        throw new ApiError(400, `El efectivo recibido debe ser de al menos ${fmtMonto(pago.monto)}.`);
      }
    } else if (pago.recibido != null) {
      throw new ApiError(400, "Solo el pago en efectivo admite monto recibido.");
    }
  }
  return pagos.map((pago) => ({
    metodo_pago: pago.metodo_pago,
    monto: Number(pago.monto),
    recibido: pago.metodo_pago === "EFECTIVO" ? Number(pago.recibido) : null,
  }));
}

/** Una venta con más de un medio se registra como MIXTO; con uno, conserva su medio. */
function metodoResumen(medios) {
  const conMonto = medios.filter((medio) => centavos(medio.monto) > 0);
  const usados = conMonto.length ? conMonto : medios.slice(0, 1);
  return usados.length > 1 ? "MIXTO" : usados[0].metodo_pago;
}

/**
 * Reparte un importe de reverso (cancelación o devolución) entre los medios de la
 * venta. Reparte en proporción al saldo que aún no se ha reversado por medio, y
 * usa el método de los mayores restos para que los centavos cuadren exactamente.
 * Nunca reparte más que el saldo pendiente de cada medio.
 */
function repartirReverso({ importe, mediosVenta, reversadoPorMedio }) {
  const saldos = mediosVenta.map((medio) => ({
    metodo_pago: medio.metodo_pago,
    saldo: centavos(medio.monto) - centavos(reversadoPorMedio.get(medio.metodo_pago) || 0),
  }));
  const saldoTotal = saldos.reduce((acumulado, medio) => acumulado + medio.saldo, 0);
  const importeCentavos = centavos(importe);
  if (importeCentavos > saldoTotal) {
    throw new ApiError(409, "La devolución supera el importe cobrado pendiente de reembolsar.");
  }

  const asignados = saldos.map((medio) => {
    const exacto = saldoTotal === 0 ? 0 : (importeCentavos * medio.saldo) / saldoTotal;
    return { ...medio, base: Math.floor(exacto), resto: exacto - Math.floor(exacto) };
  });
  let faltantes = importeCentavos - asignados.reduce((acumulado, medio) => acumulado + medio.base, 0);
  const porResto = [...asignados].sort((a, b) => b.resto - a.resto);
  for (const medio of porResto) {
    if (faltantes === 0) break;
    if (medio.base < medio.saldo) {
      medio.base += 1;
      faltantes -= 1;
    }
  }
  return asignados.map((medio) => ({ metodo_pago: medio.metodo_pago, monto: medio.base / 100 }));
}

/** Suma por medio lo ya reversado de una venta, a partir de sus movimientos de reverso. */
function acumularReversos(filas) {
  const mapa = new Map();
  for (const fila of filas) {
    mapa.set(fila.metodo_pago, (mapa.get(fila.metodo_pago) || 0) + Number(fila.monto));
  }
  return mapa;
}

/** Inserta los medios de un movimiento. Un reverso sin importe conserva un único medio. */
async function registrarMedios(client, movimientoId, medios) {
  const conMonto = medios.filter((medio) => centavos(medio.monto) > 0);
  const usados = conMonto.length ? conMonto : medios.slice(0, 1);
  for (const medio of usados) {
    await client.query(
      `INSERT INTO movimiento_pagos (movimiento_id, metodo_pago, monto, recibido, cambio)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        movimientoId,
        medio.metodo_pago,
        medio.monto,
        medio.recibido ?? null,
        medio.recibido != null ? Number((medio.recibido - medio.monto).toFixed(2)) : null,
      ]
    );
  }
}

module.exports = {
  MEDIOS_PAGO,
  normalizarMediosCobro,
  metodoResumen,
  repartirReverso,
  acumularReversos,
  registrarMedios,
};
