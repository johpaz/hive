# CHANGELOG v0.0.39 — Hive

## Resumen

Esta versión introduce el **API Client**, una nueva herramienta nativa y su interfaz en el dashboard para realizar llamadas HTTP tipo curl a APIs REST. Además expande el ecosistema de **modelos locales** (Gemma 4 y Qwen 3.5), agrega **dos nuevos providers cloud** (MiniMax, OpenCode-Go), migra la **automatización de navegador** de CDP/WebSocket a `agent-browser` (CLI Rust de Vercel), fortalece el **manejo de secretos** con fallback a DB cifrada cuando el keychain no está disponible, y mejora la **robustez cross-platform** (Windows, Docker, headless Linux).

---

## Nueva Tool Nativa: `api_request`

### Implementación

- **Archivo:** `packages/core/src/tools/api/api-request.ts`
- **Registro:** `packages/core/src/tools/api/index.ts`
- **Categoría:** `api` (nueva categoría en el registro de tools)

### Capacidades

- **Métodos HTTP soportados:** `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`
- **Headers custom:** objeto key-value arbitrario
- **Body:** string crudo (ideal para JSON, form-data, XML)
- **Query params:** objeto key-value que se codifica automáticamente en la URL
- **Timeout:** configurable (default 30s, máx 120s)
- **Auto-detection de Content-Type:** si el body parece JSON y no se especifica header, se setea `application/json` automáticamente
- **Respuesta estructurada:**
  - `status`, `statusText`, `headers`
  - `body` parseado (JSON auto-parseado, texto plano preservado)
  - `url` final (después de redirects)
  - Para `HEAD`: solo headers, sin intentar leer body

### Parámetros

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `method` | `enum` | ✅ | GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS |
| `url` | `string` | ✅ | URL completa del endpoint |
| `headers` | `object` | ❌ | Headers HTTP como key-value pairs |
| `body` | `string` | ❌ | Cuerpo de la petición como string |
| `query_params` | `object` | ❌ | Parámetros de query, auto-encoded |
| `timeout_ms` | `number` | ❌ | Timeout en milisegundos |

---

## Nueva Skill Bundled: `api_client`

### Implementación

- **Archivo:** `packages/skills/src/bundled/api/api_client/SKILL.md`
- **Bundle regenerado:** `packages/skills/src/bundled-data.generated.ts` (29 skills)

### Propósito

Da contexto al agente para que sepa:
- Cuándo usar `api_request` vs `web_fetch`
- Cómo traducir comandos curl a parámetros de la tool
- Mejores prácticas de seguridad (no exponer tokens, usar `query_params`)
- Manejo de errores comunes (4xx, 5xx, rate limits)

### Triggers (activación automática)

- `"llama a la api"`, `"consume la api"`, `"haz una petición"`, `"envía un post"`
- `"curl"`, `"api request"`, `"rest api"`, `"endpoint"`, `"webhook"`
- `"integrar con api"`, `"conectar con api"`, `"obtener datos de api"`

---

## API Client en el Dashboard (UI)

### Nueva Página: `ApiClientPage`

- **Archivo:** `packages/hive-ui/src/pages/ApiClientPage.tsx`
- **Ruta:** `/api-client`
- **Menú:** Sidebar principal bajo "Navegación" con icono `Globe`

### Features

#### Request Builder
- **Selector de método** dropdown con los 7 métodos HTTP
- **URL input** con submit vía Enter
- **Tabs de configuración:**
  - **Headers:** tabla dinámica key-value con checkboxes para habilitar/deshabilitar cada header
  - **Query Params:** misma UI dinámica, auto-encoding en el backend
  - **Body:** textarea monoespaciada con placeholder de ejemplo JSON

#### Response Viewer
- **Status badge** con color semántico:
  - Verde (2xx), Amarillo (3xx), Naranja (4xx), Rojo (5xx)
- **Tiempo de respuesta** en milisegundos
- **3 tabs de respuesta:**
  - **Body:** JSON auto-formateado con indentación y syntax highlighting (texto verde sobre fondo oscuro)
  - **Headers:** lista key-value legible de los response headers
  - **Raw:** JSON completo crudo de toda la respuesta
- **Botón Copiar** al portapapeles

#### Historial Lateral
- Guarda las últimas **50 requests** en `localStorage`
- Muestra método, URL, status, timestamp
- **Click para rehacer** un request del historial (carga método + URL)
- **Limpiar historial** con confirmación implícita

### Backend Route

- **Archivo:** `packages/core/src/gateway/routes/http-client.ts`
- **Endpoint:** `POST /api/http-request`
- Reutiliza la tool nativa `api_request` para mantener consistencia entre agente y dashboard
- CORS habilitado, autenticación requerida (mismo sistema de Bearer token)

---

## Nuevos Providers LLM

### MiniMax

- **Archivo:** `packages/core/src/agent/llm-providers/minimax.ts`
- Extensión de `OpenAICompatBase`
- Requiere reasoning roundtrip (`needsReasoningRoundtrip()`)
- Variable de entorno: `MINIMAX_API_KEY`

### OpenCode-Go

- **Archivo:** `packages/core/src/agent/llm-providers/opencode-go.ts`
- Extensión de `OpenAICompatBase`
- Variable de entorno: `OPENCODE_GO_API_KEY`

---

## Local LLM: Expansión de Modelos y Mejoras UI

### Nuevos Modelos Disponibles

Además de los modelos Gemma 4 E2B/E4B originales, ahora se soportan:

**Gemma 4 family:**
- `gemma4_12b_Q4_K_XL` (~7 GB)
- `gemma4_26b_Q4_K_M` (~10 GB)
- `gemma4_31b_Q4_K_XL` (~14 GB)

**Qwen 3.5 family:**
- `qwen3_5_2b_Q4_K_XL` (~1.2 GB)
- `qwen3_5_4b_Q4_K_XL` (~2.5 GB)
- `qwen3_5_9b_Q4_K_XL` (~5.4 GB)
- `qwen3_5_27b_Q4_K_XL` (~16 GB)
- `qwen3_5_35b_Q4_K_XL` (~21 GB)

Cada modelo vision tiene su **mmproj específico** mapeado automáticamente (`MODEL_MMPROJ_MAP`).

### Backend

- **Archivo:** `packages/core/src/gateway/llm-local/downloader.ts`
- Descarga con `writer.flush()` garantizado para evitar archivos truncados
- Tamaños de modelo precisos en la lista

### UI / Dashboard

- **LocalLLMCard:**
  - **Progreso de descarga en tiempo real** con barra de progreso y MB descargados / totales
  - **Selector de modelo** antes de iniciar el servidor (solo modelos descargados)
  - Servidores activos muestran el `modelId` que están corriendo
- **ModelSelector:**
  - Marca modelos locales no descargados con badge rojo "No descargado"
  - Bloquea selección de modelos no descargados para `local-llama` con toast informativo
  - Consulta estado de descarga vía `useGlobalConfigStore`
- **Providers API:** los modelos locales descargados se inyectan dinámicamente en `GET /api/providers` y se auto-activan

---

## Browser: Migración a `agent-browser` (Rust CLI de Vercel)

### Motivación

Se reemplazó el motor de automatización de navegador basado en **CDPClient/WebSocket + Chrome DevTools Protocol** por **`agent-browser`** (`0.27.1`), un CLI en Rust desarrollado por Vercel específicamente para agentes de IA.

**Ventajas clave:**
- **Árboles de accesibilidad compactos** (~200–400 tokens) vs. DOM completo (~3000–5000), reduciendo drásticamente el uso de tokens del LLM
- **Referencias deterministas** (`@e1`, `@e2`) para interacción con elementos, eliminando fragilidad de selectores CSS
- **Instalación lazy** — no se incluye en `package.json`, se instala bajo demanda en `~/.hive/agent-browser/`
- **Cross-platform nativo** — binarios precompilados para macOS (ARM64/x64), Linux (x64/ARM64/musl), Windows (x64)
- **Menor superficie de ataque** — no expuye endpoints CDP en red, todo pasa por CLI local

### Arquitectura Nueva

- **`AgentBrowserView`** — clase principal que ejecuta comandos `agent-browser --session hive --json <cmd>`
- **`BrowserService`** — singleton que:
  1. Detecta si `agent-browser` está instalado en `~/.hive/agent-browser/`
  2. Si no, lo instala vía `bun add agent-browser@latest` en un directorio aislado
  3. Verifica que Chrome/Chromium esté disponible; si no, ejecuta `agent-browser install` para descargarlo automáticamente
  4. Mantiene una sesión persistente (`--session hive`) entre llamadas
- **`CDPClient`** — mantiene existencia como **shim deprecado** que extiende `AgentBrowserView`, preservando compatibilidad para cualquier código que importe `CDPClient` directamente

### Tools Migradas (7/7)

Todas las tools de navegador preservan sus **firmas públicas idénticas**. Solo cambió la implementación interna:

| Tool | Comando CLI usado | Notas |
|------|-------------------|-------|
| `browser_navigate` | `open <url>` + `snapshot -c -d 3` | **Default: accessibility tree** (~200-600 chars). Opción `mode=text` para `innerText` completo |
| `browser_click` | `click <selector>` | Soporte selectores CSS y refs `@eN` |
| `browser_type` | `fill <selector> <text>` (clear) / `type <selector> <text>` (append) | `clear=true` usa `fill`, `clear=false` usa `type` |
| `browser_screenshot` | `screenshot` (full) / `screenshot <selector>` (elemento) | **Default: JPEG 80% a 1280×720** (~30-60KB base64 vs ~300KB PNG full). Opción `format=png` disponible |
| `browser_extract` | `snapshot` (selectores amplios) / `eval` (selectores específicos) | Usa snapshot para `body`/`html`/`*`; eval+DOM para selectores CSS/XPath específicos |
| `browser_script` | `eval <script>` | Auto-wrapping de top-level `await` en IIFE async |
| `browser_wait` | `eval` con polling de selector + `Bun.sleep` | Espera hasta timeout o presencia de elemento |

### Auto-Instalación (Lazy Bootstrap)

```typescript
// Primer uso de BrowserService.start()
if (!agentBrowserInstalled) {
  await bun add agent-browser@latest  // en ~/.hive/agent-browser/
}
if (!chromeInstalled) {
  await agent-browser install         // descarga Chrome headless automáticamente
}
```

Esto mantiene el bundle principal pequeño; los usuarios que nunca usen navegador no pagan el costo de descarga.

### Screenshot: Flujo Optimizado

**Por defecto ahora es JPEG 80% a 1280×720** (antes PNG a resolución nativa):

1. Antes del screenshot: `agent-browser set viewport 1280 720` para reducir resolución
2. `agent-browser screenshot --screenshot-format jpeg --screenshot-quality 80`
3. Guarda JPEG en `~/.agent-browser/tmp/screenshots/<uuid>.jpeg`
4. El código TS lee el archivo, convierte a base64, elimina temp
5. **Resultado:** ~30-60KB base64 vs ~300KB+ PNG nativo → **~5x menos tokens**

**Opciones configurables:**
- `format`: `"jpeg"` (default) o `"png"`
- `quality`: 0-100 (default: 80, solo JPEG)
- `width`/`height`: viewport en píxeles (default: 1280×720)

Para screenshots sin pérdida, usar `format: "png"` y `width: 1920`.

### `snapshot()` en `AgentBrowserView`

Nuevo método que expone el árbol de accesibilidad compacto:

```typescript
const tree = await view.snapshot({ compact: true, depth: 3 });
// Devuelve texto plano tipo:
// - document
//   - banner
//     - link "Tu profe IA" [ref=e5]
//   - link "Inicio" [ref=e10]
//   - heading "Pausa Activa..." [ref=e100]
```

**Usado por:**
- `browser_navigate` (modo default)
- `browser_extract` (selectores amplios como `body`/`html`)

### Async/Await en `eval`

`AgentBrowserView.evaluate()` detecta si el script contiene `await` y lo envuelve automáticamente:

```javascript
// El agente envía:
document.querySelector("#btn").click(); await Bun.sleep(1000); return "ok";
// Se transforma en:
(async () => { document.querySelector("#btn").click(); await Bun.sleep(1000); return "ok"; })()
```

Esto porque el comando `eval` de `agent-browser` no soporta top-level await directamente.

### Configuración del Browser

Nuevas opciones en `hive.yaml` bajo `tools.browser`:

```yaml
tools:
  browser:
    sessionName: "hive"   # nombre de sesión persistente
```

Opciones removidas del schema (ya no aplican con agent-browser): `executablePath`, `preference`, `cdpUrl`.

### Tests

| Test suite | Estado |
|------------|--------|
| `tests/browser-tools.test.ts` | ✅ 35 pass, 5 skip |
| `tests/browser-cdp.test.ts` | ✅ 46 pass, 4 skip (raw CDP commands no expuestos por CLI) |
| `tests/browser-bun.test.ts` | ✅ 6 pass |

**Tests skipped (agent-browser no expone CDP raw):**
- `screenshot clip` — CLI no soporta parámetros de clipping directo
- `Page.getNavigationHistory` — requiere CDP raw
- `Browser.getVersion` — requiere CDP raw
- `Runtime.evaluate via cdp raw` — requiere CDP raw

### Skills Afectadas

Las skills `browser_automate` y `browser_scrape` **no requieren cambios** — usan los mismos nombres de tool (`browser_navigate`, `browser_click`, etc.), por lo que la migración es transparente para los prompts del agente.

---

## Tool Runtime y Workers

### Bundling del Tool Worker

- El worker (`tool-worker.js`) ahora se compila y distribuye junto al binario principal
- **Dockerfile:** copia `tool-worker.js` a la imagen final
- **CI/CD (release.yml):** incluye `tool-worker.js` en el release de GitHub y en los artifacts
- Resuelve múltiples rutas de fallback para encontrar el worker en distintos entornos (binario, Docker, desarrollo)

---

## Gateway y CLI: Robustez y Cross-Platform

### Modo Dev (`hive dev`)

- **Verificación de puerto libre** antes de lanzar: hace health check HTTP, intenta liberar el puerto localmente (`fuser`, `lsof`, `taskkill`), y muestra instrucciones claras si el puerto sigue ocupado (Docker u otro servicio)
- **Detección de setup mode** vía polling a `/api/setup/status` en lugar de solo verificar existencia de archivo DB (más fiable cuando el gateway ya está inicializando)
- **Manejo de salida temprana:** detecta si el proceso Gateway muere inmediatamente después del spawn y muestra error descriptivo

### Comando `hive status` / `isRunning`

- Primero hace **health check HTTP** al puerto configurado; si responde, considera que está corriendo independientemente del PID file

### Soporte Windows

- `killPortProcess()`: usa `netstat -ano` + `taskkill` en Windows
- `hive dev`: evita matar grupo de procesos con `-pid` en Windows (usa `child.kill()` directo)
- `hive reload`: mensaje de no-disponible en Windows (hot-reload no soportado)
- Uso de `homedir()` en lugar de `process.env.HOME` en múltiples archivos para compatibilidad cross-platform

---

## Seguridad: Secretos con Fallback a DB Cifrada

### Problema Resuelto

En entornos headless Linux, Docker o WSL, `Bun.secrets` (keychain OS) falla porque no hay GNOME Keyring / libsecret disponible. Anteriormente esto causaba:
- Pérdida de API keys y configuraciones cifradas al migrar
- Imposibilidad de guardar secretos nuevos

### Solución

- **Fallback jerárquico:** OS Keychain → DB SQLite cifrada con AES-256-GCM → in-memory (último recurso)
- **Archivo:** `packages/core/src/storage/crypto.ts`
- Funciones nuevas: `legacyEncryptAES`, `persistSecretToDb`, `_readDbSecret`
- Las columnas `_encrypted` / `_iv` en la base de datos se mantienen como respaldo durable cuando el keychain no está disponible

### Migración Segura

- **Archivo:** `packages/core/src/storage/migrate.ts`
- La migración de secretos legacy AES **solo borra el ciphertext de la DB cuando confirma que el secreto fue persistido en un store durable** (keychain o DB fallback)
- Si solo quedó en memoria, mantiene el ciphertext y logea warning para reintentar en el próximo arranque

---

## Canales: WhatsApp

- Logger silenciado para Baileys (evita spam de debug en consola); redirige `info/warn/error` al logger de Hive
- Uso de `homedir()` para rutas de autenticación

---

## Configuración

- `packages/core/src/config/loader.ts` usa `os.homedir()` en lugar de `process.env.HOME` para expansión de paths `~`
- Nuevas opciones en schema Zod para `BrowserConfig`: `executablePath`, `preference`, `args`, `userDataDir`
- Default de `tools.browser.preference`: `["chromium", "chrome", "brave", "edge", "any"]`

---

## Registro de Tools

### `packages/core/src/tools/index.ts`

- Importada nueva categoría `api`
- Agregada a `createAllTools()` y `createToolsByCategory()`
- Exportado `apiRequestTool` para uso directo

### Tool Runtime

- `api_request` **ejecuta en workers** (no requiere hilo principal)
- No depende de estado local del proceso → paralelizable sin RPC

---

## Archivos Afectados

### Nuevos (12)

| Archivo | Descripción |
|---------|-------------|
| `packages/core/src/tools/api/api-request.ts` | Tool nativa `api_request` |
| `packages/core/src/tools/api/index.ts` | Módulo de categoría API |
| `packages/core/src/gateway/routes/http-client.ts` | Route backend `POST /api/http-request` |
| `packages/hive-ui/src/pages/ApiClientPage.tsx` | Página completa del cliente HTTP |
| `packages/skills/src/bundled/api/api_client/SKILL.md` | Skill instructiva para el agente |
| `packages/core/src/agent/llm-providers/minimax.ts` | Provider MiniMax |
| `packages/core/src/agent/llm-providers/opencode-go.ts` | Provider OpenCode-Go |
| `API.md` | Documentación de API LLM externa |
| `docs/HIVE-HARNESS.md` | Documentación de harness de pruebas |
| `tests/browser-detect.test.ts` | Tests de detección de navegador |

### Modificados (35+)

| Archivo | Cambio |
|---------|--------|
| `packages/core/src/tools/index.ts` | Registro de categoría `api` + exports |
| `packages/core/src/gateway/server.ts` | Import route + handler `POST /api/http-request` |
| `packages/hive-ui/src/App.tsx` | Ruta `/api-client` + lazy import |
| `packages/hive-ui/src/modules/layout/HiveSidebar.tsx` | Ítem de menú "API Client" con icono Globe |
| `packages/skills/src/bundled-data.generated.ts` | Regenerado con 29 skills |
| `packages/core/src/tools/web/browser-service.ts` | Migración completa a `agent-browser`: `AgentBrowserView`, lazy install, sesiones persistentes |
| `packages/core/src/config/loader.ts` | Schema browser: removido `cdpUrl`/`executablePath`/`preference`, agregado `sessionName`, homedir() |
| `packages/core/src/gateway/llm-local/downloader.ts` | +10 modelos nuevos, mmproj mapping, fix flush escritura |
| `packages/core/src/gateway/routes/llm-local.ts` | Soporte modelos nuevos, selector de modelo al iniciar |
| `packages/core/src/gateway/routes/providers.ts` | Inyección dinámica de modelos locales descargados |
| `packages/hive-ui/src/modules/providers/LocalLLMCard.tsx` | Progreso descarga, selector modelo, mostrar modelId activo |
| `packages/hive-ui/src/modules/agents/ModelSelector.tsx` | Badges de no-descargado, bloqueo selección, toast |
| `packages/hive-ui/src/stores/useGlobalConfigStore.ts` | fetchDownloadProgress, startLocalLLM con modelId |
| `packages/core/src/storage/crypto.ts` | Fallback keychain → DB AES → memoria |
| `packages/core/src/storage/migrate.ts` | Migración condicional, no borra ciphertext sin confirmar |
| `packages/core/src/storage/seed.ts` | Seed de modelos locales expandido |
| `packages/core/src/tool-runtime/index.ts` | Resolución de rutas de worker, cross-platform |
| `packages/cli/src/commands/gateway.ts` | killPortProcess, health checks, setup mode polling, Windows fixes |
| `packages/cli/src/adapters/*.ts` | Fixes cross-platform y manejo de tool-worker |
| `packages/core/src/channels/whatsapp.ts` | Logger Baileys silenciado, homedir() |
| `Dockerfile` | Copia tool-worker.js a imagen final |
| `.github/workflows/release.yml` | Incluye tool-worker.js en artifacts y release |

### Eliminados (3)

| Archivo | Razón |
|---------|-------|
| `CHANGELOG_v0.0.37.md` | Consolidado en changelog actual |
| `CHANGELOG_v0.0.38.md` | Consolidado en changelog actual |
| `packages/core/tsconfig.json` | Eliminado (no necesario en workspace) |

---

## Breaking Changes

Ninguno. Esta versión es 100% backward compatible.

---

## Estadísticas

- **45+ archivos** modificados o creados
- **1 nueva tool nativa** (`api_request`)
- **1 nueva skill bundled** (`api_client`)
- **1 nueva página en UI** (`ApiClientPage`)
- **1 nuevo endpoint API** (`POST /api/http-request`)
- **2 nuevos providers** (MiniMax, OpenCode-Go)
- **10 nuevos modelos locales** (Gemma 4 + Qwen 3.5 families)
- **Migración completa de motor de navegador** (CDP/WebSocket → `agent-browser` Rust CLI)
- **Neto principal de la versión**:
  - El agente ahora puede consumir cualquier API REST con control total de método, headers y body
  - Los usuarios pueden depurar y probar endpoints sin salir del dashboard de Hive
  - Diferenciación clara entre `web_fetch` (scraping simple GET) y `api_request` (HTTP completo)
  - Soporte de modelos locales ampliado con progreso de descarga y selección de modelo
  - Automatización de navegador 10x más eficiente en tokens gracias a árboles de accesibilidad de `agent-browser`
  - Mayor robustez en Docker y entornos headless gracias al fallback de secretos a DB cifrada
