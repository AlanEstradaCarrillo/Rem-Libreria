# Protección de `main` y cierre del Bloque 10

Esta guía completa la única evidencia externa pendiente del Bloque 10. El repositorio `AlanEstradaCarrillo/Rem-Libreria` debe permanecer **privado**. No se debe cambiar su visibilidad para habilitar esta función.

## Requisito previo

La cuenta o la organización debe disponer de un plan de GitHub que permita proteger ramas en repositorios privados. La configuración debe realizarla una persona con permisos de administración del repositorio. Si la interfaz solicita ampliar el plan, se requiere una decisión del titular antes de continuar.

## Regla requerida para `main`

En GitHub, abre el repositorio y entra en **Settings → Branches** o **Settings → Rules → Rulesets**, según la interfaz disponible. Crea una regla activa que apunte exactamente a la rama `main` y configura como mínimo:

1. exigir que los cambios lleguen mediante pull request;
2. exigir comprobaciones de estado antes de fusionar;
3. seleccionar el check exacto **`Integración con PostgreSQL`**;
4. exigir que la rama del pull request esté actualizada antes de fusionar;
5. impedir eliminaciones y `force push` sobre `main`;
6. impedir el bypass de estas reglas, incluido para administradores, si el plan y la interfaz lo permiten.

No agregues secretos a la regla ni al workflow. El archivo `.github/workflows/ci.yml` ya utiliza solamente credenciales desechables del PostgreSQL aislado de CI.

## Prueba obligatoria de bloqueo

La existencia visual de la regla no es evidencia suficiente. Debe comprobarse su comportamiento:

1. crea una rama temporal desde el `main` vigente;
2. añade temporalmente una prueba de integración que falle de forma deliberada;
3. abre un pull request hacia `main` y espera a que **`Integración con PostgreSQL`** termine en rojo;
4. confirma que GitHub no permite fusionar el pull request y guarda el enlace de la corrida y una captura o confirmación del bloqueo;
5. retira por completo la prueba deliberada sin fusionarla;
6. confirma que el mismo check vuelve a verde con las 160 pruebas válidas;
7. cierra el pull request sin fusionar cambios de prueba y elimina la rama temporal.

La prueba deliberada nunca debe añadirse a `main`. No debe alterarse una prueba existente para producir el fallo.

## Evidencia que se debe registrar

Para cerrar el Bloque 10, registra en `VERIFICACION.md`:

- fecha y persona responsable de la configuración;
- confirmación de que la rama aparece como protegida;
- nombre exacto del check requerido;
- enlace a la corrida roja;
- evidencia de que el botón de fusión quedó bloqueado;
- enlace a la corrida verde posterior;
- confirmación de que la prueba y la rama temporales fueron retiradas.

Hasta reunir esta evidencia, el estado correcto continúa siendo **🟡 PENDIENTE DE VERIFICACIÓN EXTERNA**.
