const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

const BACKEND_ROOT = path.resolve(__dirname, "../..");

function ejecutarServidorSinBase() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/nonexistent",
        JWT_SECRET: process.env.JWT_SECRET || "x".repeat(64),
        PORT: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("El servidor no falló a tiempo sin PostgreSQL."));
    }, 8000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
}

test("arranque reproducible, readiness PostgreSQL y frontend sin errores básicos", { timeout: 30000 }, async () => {
  const environment = await createIntegrationEnvironment();
  try {
    const health = await apiRequest(environment.baseUrl, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.database, "ready");

    const rootUrl = environment.baseUrl.replace(/\/api$/, "");
    const corsResponse = await fetch(`${rootUrl}/api/health`, {
      headers: { Origin: "https://origen-no-configurado.example" },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(corsResponse.headers.get("access-control-allow-origin"), null);

    const tiendaResponse = await fetch(`${rootUrl}/tienda.html`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(tiendaResponse.status, 200);
    assert.match(await tiendaResponse.text(), /<link rel="icon" href="data:,">/);

    const sinBase = await ejecutarServidorSinBase();
    assert.notEqual(sinBase.code, 0);
    assert.match(sinBase.output, /No se pudo iniciar Librería REM/);
    assert.doesNotMatch(sinBase.output, /API y PostgreSQL disponibles/);
  } finally {
    await environment.cleanup();
  }
});
