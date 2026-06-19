# Agent Form-Fill Eval — GoFest 2026 Mock

Test end-to-end real que verifica que el coordinador de Hive (Bee) puede llenar un formulario web usando las herramientas de browser, mantener el contexto de la tarea y no quedarse atascado.

## ¿Qué hace?

1. Levanta un servidor local con un formulario de registro estilo GoFest 2026.
2. Inicializa el `AgentLoop` real, el `BrowserService` real y la base de datos de Hive.
3. Le pide al coordinador que llene el formulario.
4. Verifica que:
   - Use `browser_navigate`, `browser_type` y `browser_click` correctamente.
   - Complete los campos requeridos.
   - Responda al usuario con un resumen relevante.
   - No se quede en bucle ni colgado.

## Requisitos

- Base de datos de Hive inicializada (`~/.hive/data/hive.db`).
- Agente coordinador configurado.
- `agent-browser` instalado y Chrome/Chromium disponible.
- API key del proveedor LLM configurada (la que use el coordinador).

## Cómo correr

```bash
export BROWSER_TESTS=1
export AGENT_FORM_EVAL=1
bun test tests/agent-form-fill-eval.test.ts --timeout 180000
```

## Gate

El test solo corre cuando `AGENT_FORM_EVAL=1` está definido. Sin esa variable, Bun lo salta completamente:

```bash
bun test tests/agent-form-fill-eval.test.ts
# → 4 skip
```

## Estructura

| Archivo | Descripción |
|---------|-------------|
| `tests/agent-form-fill-eval.test.ts` | Suite de test end-to-end. |
| `tests/fixtures/gofest-form.html` | Formulario mock servido localmente. |
| `packages/core/src/agent/agent-loop.ts` | Loop del agente con protección anti-atasco. |
| `packages/core/src/agent/stuck-loop.ts` | Detector de bucles y stalls. |

## Protecciones anti-atasco implementadas

El agent loop ahora incluye varias salvaguardas para evitar que el usuario se quede esperando sin respuesta:

1. **Wall-clock timeout**: cada invocación tiene un límite de tiempo (default 5 minutos, configurable por `agent.max_wall_clock_ms`). Si se excede, se retorna un mensaje al usuario.
2. **Max iterations**: ya existía, ahora se complementa con síntesis forzada.
3. **StuckLoopDetector**: detecta cuando la misma tool se llama ≥3 veces con los mismos argumentos y error. Primero advierte al modelo, y si persiste, rompe el loop notificando al usuario.
4. **Stall detection**: detecta iteraciones consecutivas sin herramientas de progreso (`browser_type`, `browser_click`, `browser_navigate`, `browser_script`). Después de 3 iteraciones sin avance advierte; después de 5 rompe con un mensaje al usuario.

## Criterios de aprobación

El test principal pasa si:

- El agente navega al formulario.
- Completa al menos 4 campos con `browser_type`/`browser_click`.
- La respuesta final menciona GoFest, el formulario o Hive.
- No se detectan eventos de bucle o stall.
- El formulario queda en estado "Listo para enviar".

El test anti-atasco pasa si:

- El agente navega a una página rota.
- No se queda colgado más de 60 segundos.
- Responde al usuario explicando el problema.

## Costo y duración típica

Con Gemini `gemini-3-flash-preview`, cada ejecución completa consume aproximadamente:

- Tokens de entrada: ~70K–160K
- Tokens de salida: ~500–1000
- Costo estimado: ~$0.03–$0.08 USD
- Duración: ~25–75 segundos

Por eso el test está protegido por `AGENT_FORM_EVAL=1` y no corre en CI por defecto.

## Solución de problemas

### "Browser tools not registered"

Asegúrate de llamar `activateBrowserTools()` antes de construir el `AgentLoop` y de que la tabla `tools` tenga las herramientas de browser.

### El agente no encuentra las herramientas de browser

El contexto inicial solo incluye 4 tools mínimas. El agente debe usar `search_knowledge(query="browser")` para descubrirlas. Si el modelo no lo hace, revisa que `tools_fts` esté poblada.

### El agente recarga la página y pierde los datos

El fixture guarda los valores en `window.__hiveFormData` justo antes del submit, por lo que el test puede verificarlos aunque el agente vuelva a navegar después.

## Mantenimiento

- Si se cambian los IDs o labels del fixture, actualiza las aserciones del test.
- Si se agregan nuevas protecciones anti-atasco, considera añadir un caso de test que las ejercite.
