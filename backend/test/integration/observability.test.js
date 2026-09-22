const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { apiRequest, createIntegrationEnvironment } = require("../helpers/integration-env");

async function readLogEventually(filePath) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const contents = await fs.readFile(filePath, "utf8");
      if (contents.trim()) return contents.trim().split("\n").map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("No se escribió el registro persistente dentro del tiempo esperado.");
}

test("los errores HTTP quedan registrados sin incluir credenciales ni cuerpos", { timeout: 30000 }, async () => {
  const logPath = path.join(os.tmpdir(), `libra-pos-errors-${process.pid}-${Date.now()}.jsonl`);
  process.env.ERROR_LOG_FILE = logPath;
  const environment = await createIntegrationEnvironment();
  try {
    const response = await apiRequest(environment.baseUrl, "/productos");
    assert.equal(response.status, 401);

    const entries = await readLogEventually(logPath);
    const entry = entries.at(-1);
    assert.equal(entry.event, "http_error");
    assert.equal(entry.status, 401);
    assert.equal(entry.method, "GET");
    assert.equal(entry.path, "/api/productos");
    assert.doesNotMatch(JSON.stringify(entry), /password|authorization|DATABASE_URL/i);
  } finally {
    await environment.cleanup();
    await fs.rm(logPath, { force: true });
  }
});
