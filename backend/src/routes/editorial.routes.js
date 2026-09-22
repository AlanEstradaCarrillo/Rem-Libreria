const router = require("express").Router();
const { query, tx } = require("../config/db");
const { validate } = require("../middleware/validate");
const { requireAuth, requireRoles } = require("../middleware/auth");
const { round2 } = require("../utils/errors");
const {
  hashRequest,
  getIdempotencyKey,
  claimOperation,
  completeOperation,
} = require("../utils/idempotency");
const {
  idEditorialPositivo,
  cargarColaboradorEditorial,
  listarColaboradoresEditoriales,
  crearColaboradorEditorial,
  actualizarColaboradorEditorial,
  cargarObraEditorial,
  listarObrasEditoriales,
  crearObraEditorial,
  actualizarObraEditorial,
  transicionarObraEditorial,
  vincularColaboradorObra,
  actualizarVinculoColaborador,
  retirarColaboradorObra,
  vincularEdicionObra,
  desvincularEdicionObra,
} = require("../services/editorial-obras.service");
const {
  cargarContratoEditorial,
  listarContratosEditoriales,
  crearContratoEditorial,
  actualizarContratoEditorial,
  transicionarContratoEditorial,
} = require("../services/editorial-contratos.service");
const { z } = require("zod");

router.use(requireAuth);
router.use(requireRoles("ADMIN", "SUPERVISOR"));

const textoOpcional = (max) => z.string().trim().min(1).max(max).optional().nullable();
const fechaSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa AAAA-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Fecha inválida");
const emailSchema = z.string().trim().email().max(254)
  .transform((value) => value.toLowerCase());
const telefonoSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s.-]+$/, "El teléfono contiene caracteres inválidos.");
const paginacionSchema = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(30),
};

const colaboradorCreateSchema = z.object({
  nombre_legal: z.string().trim().min(2).max(160),
  nombre_publico: textoOpcional(160),
  email: emailSchema.optional().nullable(),
  telefono: telefonoSchema.optional().nullable(),
  identificador_fiscal: textoOpcional(40),
  notas: textoOpcional(5000),
});
const colaboradorPatchSchema = colaboradorCreateSchema.partial().extend({
  activo: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Nada que actualizar" });
const colaboradoresQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  incluir_inactivos: z.enum(["true", "false"])
    .transform((value) => value === "true").optional().default(false),
  ...paginacionSchema,
});

const obraCreateSchema = z.object({
  titulo: z.string().trim().min(2).max(240),
  subtitulo: textoOpcional(240),
  sinopsis: textoOpcional(20000),
  idioma: z.string().trim().min(2).max(60).optional().default("Español"),
  fecha_recepcion: fechaSchema.optional(),
  fecha_objetivo_publicacion: fechaSchema.optional().nullable(),
  editor_responsable_usuario_id: z.number().int().positive().optional().nullable(),
  notas: textoOpcional(10000),
});
const obraPatchSchema = obraCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Nada que actualizar" }
);
const obrasQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  estado: z.enum([
    "PROPUESTA", "EVALUACION", "CONTRATADA", "EDICION",
    "DISENO", "IMPRESION", "PUBLICADA", "ARCHIVADA",
  ]).optional(),
  ...paginacionSchema,
});
const obraTransicionSchema = z.object({
  estado: z.enum([
    "PROPUESTA", "EVALUACION", "CONTRATADA", "EDICION",
    "DISENO", "IMPRESION", "PUBLICADA", "ARCHIVADA",
  ]),
  motivo: z.string().trim().min(3).max(500),
});
const vinculoColaboradorSchema = z.object({
  colaborador_editorial_id: z.number().int().positive(),
  rol: z.enum([
    "AUTOR", "TRADUCTOR", "ILUSTRADOR", "EDITOR", "CORRECTOR",
    "COORDINADOR", "DISENADOR",
  ]),
  nombre_credito: textoOpcional(160),
  orden_credito: z.number().int().nonnegative().max(999).optional().default(0),
  credito_publico: z.boolean().optional().default(true),
  notas: textoOpcional(5000),
});
const vinculoColaboradorPatchSchema = vinculoColaboradorSchema.omit({
  colaborador_editorial_id: true,
}).partial().refine((value) => Object.keys(value).length > 0, {
  message: "Nada que actualizar",
});
const edicionVinculoSchema = z.object({
  producto_id: z.number().int().positive(),
  motivo: z.string().trim().min(3).max(500),
});
const motivoSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
});

const porcentajeSchema = z.number().finite().min(0).max(100)
  .transform((value) => Math.round((value + Number.EPSILON) * 10000) / 10000);
const dineroSchema = z.number().finite().nonnegative().max(999999999)
  .transform((value) => round2(value));
const contratoCamposSchema = z.object({
  obra_editorial_id: z.number().int().positive(),
  colaborador_editorial_id: z.number().int().positive(),
  tipo: z.enum(["EDICION", "CESION", "LICENCIA", "COLABORACION"]),
  derechos: z.string().trim().min(3).max(20000),
  territorio: z.string().trim().min(2).max(120).optional().default("México"),
  idioma_derechos: z.string().trim().min(2).max(80).optional().default("Todos"),
  exclusividad: z.boolean().optional().default(false),
  vigente_desde: fechaSchema,
  vigente_hasta: fechaSchema.optional().nullable(),
  base_regalia: z.enum(["VENTA_NETA", "PRECIO_LISTA"]).optional().default("VENTA_NETA"),
  porcentaje_regalia: porcentajeSchema,
  anticipo: dineroSchema.optional().default(0),
  moneda: z.string().trim().length(3).transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), "Moneda inválida")
    .optional().default("MXN"),
  periodicidad_liquidacion: z.enum([
    "MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL", "UNICA",
  ]).optional().default("SEMESTRAL"),
  notas: textoOpcional(10000),
});
const contratoCreateSchema = contratoCamposSchema.refine(
  (value) => !value.vigente_hasta || value.vigente_hasta >= value.vigente_desde,
  { message: "La fecha final no puede ser anterior a la inicial", path: ["vigente_hasta"] }
);
const contratoPatchSchema = contratoCamposSchema.omit({
  obra_editorial_id: true,
  colaborador_editorial_id: true,
}).partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nada que actualizar",
  })
  .refine(
    (value) => !value.vigente_desde || !value.vigente_hasta
      || value.vigente_hasta >= value.vigente_desde,
    { message: "La fecha final no puede ser anterior a la inicial", path: ["vigente_hasta"] }
  );
const contratosQuerySchema = z.object({
  q: z.string().trim().max(160).optional().default(""),
  estado: z.enum(["BORRADOR", "VIGENTE", "SUSPENDIDO", "TERMINADO"]).optional(),
  obra_editorial_id: z.coerce.number().int().positive().optional(),
  colaborador_editorial_id: z.coerce.number().int().positive().optional(),
  ...paginacionSchema,
});
const contratoTransicionSchema = z.object({
  estado: z.enum(["VIGENTE", "SUSPENDIDO", "TERMINADO"]),
  motivo: z.string().trim().min(3).max(500),
});

async function ejecutarIdempotente(req, {
  operacion,
  solicitud,
  recursoTipo,
  crear,
  cargarReplay,
}) {
  const clave = getIdempotencyKey(req);
  const solicitudHash = hashRequest(solicitud);
  return tx(async (client) => {
    const claim = await claimOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      solicitudHash,
    });
    if (claim.replay) {
      return { replay: true, respuesta: await cargarReplay(client, claim.resourceId) };
    }
    const creado = await crear(client, clave);
    await completeOperation(client, {
      usuarioId: req.user.sub,
      operacion,
      clave,
      recursoTipo,
      recursoId: creado.recursoId,
    });
    return { replay: false, respuesta: creado.respuesta };
  });
}

function responderCreacion(res, resultado) {
  res.status(resultado.replay ? 200 : 201).json(resultado.respuesta);
}

router.get(
  "/colaboradores",
  validate(colaboradoresQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await listarColaboradoresEditoriales({ query }, {
        q: req.query.q,
        incluirInactivos: req.query.incluir_inactivos,
        page: req.query.page,
        limit: req.query.limit,
      }));
    } catch (error) { next(error); }
  }
);

router.post(
  "/colaboradores",
  validate(colaboradorCreateSchema),
  async (req, res, next) => {
    try {
      const solicitud = { ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "COLABORADOR_EDITORIAL",
        solicitud,
        recursoTipo: "colaborador_editorial",
        crear: async (client) => {
          const respuesta = await crearColaboradorEditorial(client, {
            nombreLegal: solicitud.nombre_legal,
            nombrePublico: solicitud.nombre_publico ?? null,
            email: solicitud.email ?? null,
            telefono: solicitud.telefono ?? null,
            identificadorFiscal: solicitud.identificador_fiscal ?? null,
            notas: solicitud.notas ?? null,
            usuarioId: req.user.sub,
          });
          return { recursoId: respuesta.id, respuesta };
        },
        cargarReplay: cargarColaboradorEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.get("/colaboradores/:id", async (req, res, next) => {
  try {
    res.json(await cargarColaboradorEditorial({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.patch(
  "/colaboradores/:id",
  validate(colaboradorPatchSchema),
  async (req, res, next) => {
    try {
      res.json(await tx((client) => actualizarColaboradorEditorial(
        client,
        req.params.id,
        req.body
      )));
    } catch (error) { next(error); }
  }
);

router.get("/obras", validate(obrasQuerySchema, "query"), async (req, res, next) => {
  try {
    res.json(await listarObrasEditoriales({ query }, {
      estado: req.query.estado || null,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  } catch (error) { next(error); }
});

router.post("/obras", validate(obraCreateSchema), async (req, res, next) => {
  try {
    const solicitud = {
      ...req.body,
      fecha_recepcion: req.body.fecha_recepcion || new Date().toISOString().slice(0, 10),
    };
    const resultado = await ejecutarIdempotente(req, {
      operacion: "OBRA_EDITORIAL",
      solicitud,
      recursoTipo: "obra_editorial",
      crear: async (client, clave) => {
        const respuesta = await crearObraEditorial(client, {
          titulo: solicitud.titulo,
          subtitulo: solicitud.subtitulo ?? null,
          sinopsis: solicitud.sinopsis ?? null,
          idioma: solicitud.idioma,
          fechaRecepcion: solicitud.fecha_recepcion,
          fechaObjetivoPublicacion: solicitud.fecha_objetivo_publicacion ?? null,
          editorResponsableUsuarioId: solicitud.editor_responsable_usuario_id ?? null,
          notas: solicitud.notas ?? null,
          usuarioId: req.user.sub,
          origenClave: `OBRA:CREACION:${req.user.sub}:${clave}`,
        });
        return { recursoId: respuesta.id, respuesta };
      },
      cargarReplay: cargarObraEditorial,
    });
    responderCreacion(res, resultado);
  } catch (error) { next(error); }
});

router.get("/obras/:id", async (req, res, next) => {
  try {
    res.json(await cargarObraEditorial({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.patch("/obras/:id", validate(obraPatchSchema), async (req, res, next) => {
  try {
    res.json(await tx((client) => actualizarObraEditorial(client, req.params.id, req.body)));
  } catch (error) { next(error); }
});

router.post(
  "/obras/:id/transiciones",
  validate(obraTransicionSchema),
  async (req, res, next) => {
    try {
      const obraId = idEditorialPositivo(req.params.id, "obra_editorial_id");
      const solicitud = { obra_editorial_id: obraId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "TRANSICION_OBRA_EDITORIAL",
        solicitud,
        recursoTipo: "obra_editorial",
        crear: async (client, clave) => {
          const respuesta = await transicionarObraEditorial(client, {
            obraId,
            estadoNuevo: req.body.estado,
            usuarioId: req.user.sub,
            motivo: req.body.motivo,
            origenClave: `OBRA:${obraId}:TRANSICION:${req.user.sub}:${clave}`,
          });
          return { recursoId: respuesta.id, respuesta };
        },
        cargarReplay: cargarObraEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/obras/:id/colaboradores",
  validate(vinculoColaboradorSchema),
  async (req, res, next) => {
    try {
      const obraId = idEditorialPositivo(req.params.id, "obra_editorial_id");
      const solicitud = { obra_editorial_id: obraId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "VINCULO_COLABORADOR_OBRA",
        solicitud,
        recursoTipo: "obra_editorial",
        crear: async (client) => {
          const creado = await vincularColaboradorObra(client, {
            obraId,
            colaboradorId: req.body.colaborador_editorial_id,
            rol: req.body.rol,
            nombreCredito: req.body.nombre_credito ?? null,
            ordenCredito: req.body.orden_credito,
            creditoPublico: req.body.credito_publico,
            notas: req.body.notas ?? null,
            usuarioId: req.user.sub,
          });
          return { recursoId: creado.obra.id, respuesta: creado.obra };
        },
        cargarReplay: cargarObraEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.patch(
  "/obras/:id/colaboradores/:vinculoId",
  validate(vinculoColaboradorPatchSchema),
  async (req, res, next) => {
    try {
      res.json(await tx((client) => actualizarVinculoColaborador(client, {
        obraId: req.params.id,
        vinculoId: req.params.vinculoId,
        cambios: req.body,
      })));
    } catch (error) { next(error); }
  }
);

router.delete("/obras/:id/colaboradores/:vinculoId", async (req, res, next) => {
  try {
    res.json(await tx((client) => retirarColaboradorObra(client, {
      obraId: req.params.id,
      vinculoId: req.params.vinculoId,
    })));
  } catch (error) { next(error); }
});

router.post(
  "/obras/:id/ediciones",
  validate(edicionVinculoSchema),
  async (req, res, next) => {
    try {
      const obraId = idEditorialPositivo(req.params.id, "obra_editorial_id");
      const solicitud = { obra_editorial_id: obraId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "VINCULO_EDICION_OBRA",
        solicitud,
        recursoTipo: "obra_editorial",
        crear: async (client, clave) => {
          const creado = await vincularEdicionObra(client, {
            obraId,
            productoId: req.body.producto_id,
            usuarioId: req.user.sub,
            motivo: req.body.motivo,
            origenClave: `OBRA:${obraId}:EDICION:${req.body.producto_id}:ALTA:${clave}`,
          });
          return { recursoId: creado.obra.id, respuesta: creado.obra };
        },
        cargarReplay: cargarObraEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.post(
  "/obras/:id/ediciones/:productoId/desvinculacion",
  validate(motivoSchema),
  async (req, res, next) => {
    try {
      const obraId = idEditorialPositivo(req.params.id, "obra_editorial_id");
      const productoId = idEditorialPositivo(req.params.productoId, "producto_id");
      const solicitud = { obra_editorial_id: obraId, producto_id: productoId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "DESVINCULO_EDICION_OBRA",
        solicitud,
        recursoTipo: "obra_editorial",
        crear: async (client, clave) => {
          const creado = await desvincularEdicionObra(client, {
            obraId,
            productoId,
            usuarioId: req.user.sub,
            motivo: req.body.motivo,
            origenClave: `OBRA:${obraId}:EDICION:${productoId}:RETIRO:${clave}`,
          });
          return { recursoId: creado.obra.id, respuesta: creado.obra };
        },
        cargarReplay: cargarObraEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.get(
  "/contratos",
  validate(contratosQuerySchema, "query"),
  async (req, res, next) => {
    try {
      res.json(await listarContratosEditoriales({ query }, {
        estado: req.query.estado || null,
        obraId: req.query.obra_editorial_id || null,
        colaboradorId: req.query.colaborador_editorial_id || null,
        q: req.query.q,
        page: req.query.page,
        limit: req.query.limit,
      }));
    } catch (error) { next(error); }
  }
);

router.post(
  "/contratos",
  requireRoles("ADMIN"),
  validate(contratoCreateSchema),
  async (req, res, next) => {
    try {
      const solicitud = { ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "CONTRATO_EDITORIAL",
        solicitud,
        recursoTipo: "contrato_editorial",
        crear: async (client, clave) => {
          const respuesta = await crearContratoEditorial(client, {
            obraId: req.body.obra_editorial_id,
            colaboradorId: req.body.colaborador_editorial_id,
            tipo: req.body.tipo,
            derechos: req.body.derechos,
            territorio: req.body.territorio,
            idiomaDerechos: req.body.idioma_derechos,
            exclusividad: req.body.exclusividad,
            vigenteDesde: req.body.vigente_desde,
            vigenteHasta: req.body.vigente_hasta ?? null,
            baseRegalia: req.body.base_regalia,
            porcentajeRegalia: req.body.porcentaje_regalia,
            anticipo: req.body.anticipo,
            moneda: req.body.moneda,
            periodicidadLiquidacion: req.body.periodicidad_liquidacion,
            notas: req.body.notas ?? null,
            usuarioId: req.user.sub,
            origenClave: `CONTRATO:CREACION:${req.user.sub}:${clave}`,
          });
          return { recursoId: respuesta.id, respuesta };
        },
        cargarReplay: cargarContratoEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

router.get("/contratos/:id", async (req, res, next) => {
  try {
    res.json(await cargarContratoEditorial({ query }, req.params.id));
  } catch (error) { next(error); }
});

router.patch(
  "/contratos/:id",
  requireRoles("ADMIN"),
  validate(contratoPatchSchema),
  async (req, res, next) => {
    try {
      res.json(await tx((client) => actualizarContratoEditorial(
        client,
        req.params.id,
        req.body
      )));
    } catch (error) { next(error); }
  }
);

router.post(
  "/contratos/:id/transiciones",
  requireRoles("ADMIN"),
  validate(contratoTransicionSchema),
  async (req, res, next) => {
    try {
      const contratoId = idEditorialPositivo(req.params.id, "contrato_editorial_id");
      const solicitud = { contrato_editorial_id: contratoId, ...req.body };
      const resultado = await ejecutarIdempotente(req, {
        operacion: "TRANSICION_CONTRATO_EDITORIAL",
        solicitud,
        recursoTipo: "contrato_editorial",
        crear: async (client, clave) => {
          const respuesta = await transicionarContratoEditorial(client, {
            contratoId,
            estadoNuevo: req.body.estado,
            usuarioId: req.user.sub,
            motivo: req.body.motivo,
            origenClave: `CONTRATO:${contratoId}:TRANSICION:${req.user.sub}:${clave}`,
          });
          return { recursoId: respuesta.id, respuesta };
        },
        cargarReplay: cargarContratoEditorial,
      });
      responderCreacion(res, resultado);
    } catch (error) { next(error); }
  }
);

module.exports = router;
