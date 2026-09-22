const express = require("express");
const { z } = require("zod");
const { tx, query } = require("../config/db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { ApiError } = require("../utils/errors");
const { parsePositiveId } = require("../services/caja.service");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const {
  MAX_CSV_BYTES,
  PREVIEW_PAGE_SIZE,
  buildPreview,
  publicRow,
  publicImport,
  summaryFromImport,
  rawHash,
  persistPreview,
  loadImport,
  listPreviewRows,
  applyPreview,
} = require("../services/importacion-catalogo.service");

const router = express.Router();
router.use(requireAuth, requireRoles("ADMIN", "SUPERVISOR"));

const previewQuerySchema = z.object({
  nombre_archivo: z.string().trim().min(1).max(255)
    .regex(/^[^\\/\0\r\n]+\.csv$/iu, "El nombre debe corresponder a un archivo .csv."),
  modo: z.literal("CREAR_Y_ACTUALIZAR"),
}).strict();
const rowsQuerySchema = z.object({
  resultado: z.enum(["TODAS", "CREAR", "ACTUALIZAR", "SIN_CAMBIOS", "RECHAZAR"])
    .optional().default("TODAS"),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(PREVIEW_PAGE_SIZE),
}).strict();
const confirmationSchema = z.object({
  hash_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  confirmar_omision_rechazadas: z.boolean(),
}).strict();

const csvTextParser = express.text({
  type: ["text/csv", "application/csv"],
  limit: MAX_CSV_BYTES,
});

function parseCsvText(req, res, next) {
  if (!req.is("text/csv") && !req.is("application/csv")) {
    return next(new ApiError(415, "Se requiere Content-Type text/csv con contenido UTF-8."));
  }
  csvTextParser(req, res, (error) => {
    if (!error) return next();
    if (error.type === "entity.too.large" || error.status === 413) {
      return next(new ApiError(413, "El CSV excede el límite de 2 MiB."));
    }
    return next(new ApiError(400, "No se pudo leer el archivo CSV."));
  });
}

router.post(
  "/previsualizar",
  validate(previewQuerySchema, "query"),
  parseCsvText,
  async (req, res, next) => {
    try {
      const result = await tx(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const preview = await buildPreview(client, req.body);
        const persisted = await persistPreview(client, {
          preview,
          usuarioId: req.user.sub,
          archivoNombre: req.query.nombre_archivo,
          contenidoHash: rawHash(req.body),
        });
        return {
          importacion: publicImport(persisted.importRow),
          resumen: persisted.summary,
          filas: {
            page: 1,
            limit: PREVIEW_PAGE_SIZE,
            total: persisted.rows.length,
            resultados: persisted.rows.slice(0, PREVIEW_PAGE_SIZE).map(publicRow),
          },
        };
      });
      res.status(201).json(result);
    } catch (error) { next(error); }
  }
);

router.get(
  "/:id/filas",
  validate(rowsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const importId = parsePositiveId(req.params.id, "importacion_id");
      const action = req.query.resultado === "TODAS" ? null : req.query.resultado;
      const rows = await listPreviewRows({ query }, {
        importId,
        usuarioId: req.user.sub,
        action,
        page: req.query.page,
        limit: req.query.limit,
      });
      res.json(rows);
    } catch (error) { next(error); }
  }
);

router.post(
  "/:id/confirmar",
  validate(confirmationSchema),
  async (req, res, next) => {
    try {
      const importId = parsePositiveId(req.params.id, "importacion_id");
      const key = getIdempotencyKey(req);
      const requestHash = hashRequest({
        importacion_id: importId,
        hash_sha256: req.body.hash_sha256,
        confirmar_omision_rechazadas: req.body.confirmar_omision_rechazadas,
      });
      const result = await tx(async (client) => {
        const claim = await claimOperation(client, {
          usuarioId: req.user.sub,
          operacion: "IMPORTACION_CATALOGO",
          clave: key,
          solicitudHash: requestHash,
        });
        const resourceId = claim.replay ? claim.resourceId : importId;
        if (Number(resourceId) !== importId) {
          throw new ApiError(409, "La clave idempotente corresponde a otra importación.");
        }
        let importRow = await loadImport(client, resourceId, req.user.sub, { lock: true });
        if (String(importRow.contenido_sha256).trim() !== req.body.hash_sha256) {
          throw new ApiError(409, "El hash no corresponde a la previsualización guardada.");
        }
        if (Number(importRow.filas_rechazadas) > 0
            && !req.body.confirmar_omision_rechazadas) {
          throw new ApiError(400, "Confirma expresamente que las filas rechazadas se omitirán.");
        }
        if (Number(importRow.filas_crear) + Number(importRow.filas_actualizar) === 0
            && importRow.estado !== "APLICADA") {
          throw new ApiError(400, "La previsualización no contiene filas para crear o actualizar.");
        }
        const previouslyApplied = importRow.estado === "APLICADA";
        if (!previouslyApplied) {
          importRow = await applyPreview(client, { importRow, usuarioId: req.user.sub });
        }
        if (!claim.replay) {
          await completeOperation(client, {
            usuarioId: req.user.sub,
            operacion: "IMPORTACION_CATALOGO",
            clave: key,
            recursoTipo: "catalogo_importacion",
            recursoId: importRow.id,
          });
        }
        return {
          replay: claim.replay || previouslyApplied,
          body: {
            importacion: publicImport(importRow),
            resumen: summaryFromImport(importRow),
          },
        };
      });
      res.status(result.replay ? 200 : 201).json(result.body);
    } catch (error) { next(error); }
  }
);

module.exports = router;
