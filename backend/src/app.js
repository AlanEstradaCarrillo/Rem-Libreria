const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const { query } = require("./config/db");
const { errorHandler } = require("./utils/errors");
const { recordOperationalError } = require("./utils/observability");

function createApp() {
  const app = express();

  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", "data:", "https:", "http:"],
      },
    },
  }));
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  if (corsOrigins.length > 0) {
    app.use(cors({ origin: corsOrigins, credentials: false }));
  }
  app.use(express.json({ limit: "200kb" }));

  app.use("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiados intentos. Espera unos minutos." },
  }));

  app.use("/api/tienda", rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes a la tienda. Intenta de nuevo en unos minutos." },
  }));
  app.use("/api/tienda/pedidos", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 40,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === "GET",
    message: { error: "Demasiados intentos de pedido. Espera unos minutos." },
  }));

  app.get("/api/health", async (req, res) => {
    const ts = new Date().toISOString();
    try {
      await query("SELECT 1");
      res.json({ ok: true, database: "ready", ts });
    } catch (error) {
      console.error("Comprobación de PostgreSQL fallida:", error.message);
      void recordOperationalError(error, { event: "postgres_healthcheck_failed" });
      res.status(503).json({ ok: false, database: "unavailable", ts });
    }
  });
  app.use("/api/auth", require("./routes/auth.routes"));
  app.use("/api/tienda", require("./routes/tienda.routes"));
  app.use("/api/usuarios", require("./routes/usuarios.routes"));
  app.use("/api/categorias", require("./routes/categorias.routes"));
  // Debe montarse antes del router /productos para que ":id" no capture
  // el segmento reservado "importaciones".
  app.use("/api/productos/importaciones", require("./routes/productos-importaciones.routes"));
  app.use("/api/productos", require("./routes/productos.routes"));
  app.use("/api/precios", require("./routes/precios.routes"));
  app.use("/api/inventario", require("./routes/reposicion-conteos.routes"));
  app.use("/api/inventario", require("./routes/inventario.routes"));
  app.use("/api/proveedores", require("./routes/proveedores.routes"));
  app.use("/api/compras", require("./routes/compras.routes"));
  app.use("/api/clientes", require("./routes/clientes.routes"));
  app.use("/api/cotizaciones", require("./routes/cotizaciones.routes"));
  app.use("/api/editorial", require("./routes/editorial.routes"));
  app.use("/api/editorial", require("./routes/editorial-tirajes.routes"));
  app.use("/api/editorial", require("./routes/editorial-regalias.routes"));
  app.use("/api/editorial", require("./routes/editorial-consignaciones.routes"));
  app.use("/api/pedidos", require("./routes/pedidos.routes"));
  app.use("/api/ventas", require("./routes/ventas.routes"));
  app.use("/api/caja", require("./routes/caja.routes"));
  app.use("/api/reportes", require("./routes/reportes.routes"));
  app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

  const frontendDir = path.resolve(__dirname, "../../frontend");
  app.use(express.static(frontendDir));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
