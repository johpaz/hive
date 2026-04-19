# Browser Automation — CDPClient

Hive incluye 7 herramientas de automatización web que lanzan **Chrome o Brave de forma visible** y los controlan mediante Chrome DevTools Protocol (CDP) vía WebSocket. El usuario ve en tiempo real cada acción que el agente realiza.

---

## Cómo funciona

```
Agent
  └─ browser_navigate / browser_click / ...
        └─ BrowserService  (browser-service.ts)
              └─ CDPClient
                    ├─ Bun.spawn → flatpak run com.brave.Browser (o Chrome nativo)
                    │                  └─ --remote-debugging-port=9222
                    └─ WebSocket → ws://localhost:9222/devtools/page/...
                                        └─ Chrome DevTools Protocol (CDP)
```

**El browser abre visible:** El usuario ve cada navegación, clic y escritura en tiempo real.

**Detección automática del browser** (en orden de prioridad):
1. Variable de entorno `BUN_CHROME_PATH=/ruta/a/chrome`
2. Binarios nativos: `/usr/bin/google-chrome`, `/usr/bin/brave-browser`, `/usr/bin/chromium`, etc.
3. Flatpak: `com.google.Chrome`, `com.brave.Browser`, `org.chromium.Chromium`, `com.microsoft.Edge`
4. macOS: `/Applications/Google Chrome.app/...`, `/Applications/Brave Browser.app/...`
5. Windows: `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, etc.

**Puerto CDP:** 9222 (singleton — una instancia a la vez).

---

## Herramientas del agente

### `browser_navigate`

Abre una URL en el browser y retorna el texto renderizado (con JavaScript ejecutado).

**Cuándo usar:** Sitios con contenido dinámico (React, Vue, Angular, SPAs). Para páginas estáticas, `web_fetch` es más rápido.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `url` | string | Sí | URL a navegar |
| `waitFor` | string | No | Selector CSS a esperar antes de retornar |
| `timeout` | number | No | Timeout en ms (default: 30000) |

```json
// Retorno exitoso
{
  "ok": true,
  "url": "https://ejemplo.com",
  "finalUrl": "https://ejemplo.com/redirected",
  "content": "Texto limpio de la página...",
  "length": 4200
}
```

Elimina `<script>`, `<style>`, `<iframe>` antes de retornar el texto. Espera a `document.readyState === 'complete'`.

---

### `browser_click`

Hace clic en un elemento identificado por selector CSS. Hace scroll automático al elemento antes de clicar.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS del elemento |
| `url` | string | No | Navegar aquí antes de hacer clic |
| `timeout` | number | No | Timeout en ms (default: 30000) |

```json
// Retorno exitoso
{
  "ok": true,
  "message": "Successfully clicked element: button.submit",
  "selector": "button.submit",
  "url": "https://ejemplo.com/form"
}
```

El clic se realiza con eventos reales de mouse (`mouseMoved` → `mousePressed` → `mouseReleased`) via CDP, no via `.click()` de JavaScript.

---

### `browser_type`

Escribe texto en un campo de formulario. Limpia el campo antes por defecto.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS del input |
| `text` | string | Sí | Texto a escribir |
| `url` | string | No | Navegar aquí antes de escribir |
| `clear` | boolean | No | Limpiar el campo antes (default: `true`) |
| `timeout` | number | No | Timeout en ms (default: 30000) |

```json
// Retorno exitoso
{
  "ok": true,
  "message": "Typed \"Hola mundo\" into input#search",
  "selector": "input#search",
  "text": "Hola mundo",
  "url": "https://ejemplo.com",
  "length": 10
}
```

---

### `browser_screenshot`

Captura screenshot de la página actual como PNG en base64.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `url` | string | No | Navegar aquí antes del screenshot |
| `fullPage` | boolean | No | Capturar página completa (default: `false`) |
| `selector` | string | No | Capturar solo el elemento que coincida |

```json
// Retorno exitoso
{
  "ok": true,
  "url": "https://ejemplo.com",
  "screenshot": "<base64 PNG>",
  "format": "png",
  "encoding": "base64",
  "fullPage": false,
  "viewport": { "width": 1280, "height": 800 }
}
```

Cuando se pasa `selector`, usa el bounding box del elemento para hacer un clip del screenshot.

---

### `browser_extract`

Extrae texto, atributos o links de elementos usando selectores CSS o XPath.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS o XPath (prefijo `xpath:`) |
| `url` | string | No | Navegar aquí antes de extraer |
| `attribute` | string | No | `text` (default), `href`, `src`, `alt`, `innerHTML` |
| `all` | boolean | No | `true` = todos los matches (default), `false` = solo el primero |
| `timeout` | number | No | Timeout en ms (default: 30000) |

```json
// Retorno exitoso
{
  "ok": true,
  "url": "https://ejemplo.com",
  "selector": "h2.titulo",
  "attribute": "text",
  "count": 3,
  "data": ["Título 1", "Título 2", "Título 3"]
}
```

Ejemplos de selector:
```
"h1"                             → todos los h1
"a.nav-link"                     → links de navegación
"xpath://div[@class='precio']"   → XPath
"[data-testid='product-card']"   → atributo data
```

Si el selector no aparece antes del timeout, el tool intenta la extracción de todas formas (no falla).

---

### `browser_script`

Ejecuta JavaScript arbitrario en el contexto de la página y retorna el resultado.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `script` | string | Sí | Código JS a ejecutar en la página |
| `url` | string | No | Navegar aquí antes de ejecutar |
| `timeout` | number | No | Timeout en ms (default: 30000) |

```json
// Retorno exitoso
{
  "ok": true,
  "url": "https://ejemplo.com",
  "result": { "precio": "99.99", "stock": 5 },
  "scriptLength": 120
}
```

El script se ejecuta como función async — puede usar `await`:
```js
// Ejemplo: extraer datos estructurados
const items = [];
document.querySelectorAll('.producto').forEach(el => {
  items.push({ nombre: el.querySelector('h3').textContent, precio: el.querySelector('.precio').textContent });
});
return items;
```

---

### `browser_wait`

Espera a que un selector CSS o condición JS sea verdadera. Útil para páginas con carga dinámica.

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | No* | Selector CSS o `xpath:...` a esperar |
| `condition` | string | No* | Expresión JS que debe ser truthy |
| `url` | string | No | Navegar aquí antes de esperar |
| `timeout` | number | No | Timeout en ms (default: 30000) |
| `state` | string | No | `visible` (default), `hidden`, `attached` |

*Al menos uno de `selector` o `condition` es obligatorio.

```json
// Retorno exitoso
{
  "ok": true,
  "found": true,
  "url": "https://ejemplo.com",
  "selector": "#resultados",
  "state": "visible",
  "elapsedMs": 1240
}
```

---

## Flujos de uso típicos

**Abrir una página y leer su contenido:**
```
browser_navigate(url="https://sitio.com")
```

**Esperar contenido dinámico antes de extraer:**
```
browser_navigate(url="https://spa.com")
browser_wait(selector="#resultados-cargados", timeout=10000)
browser_extract(selector=".item-precio", attribute="text", all=true)
```

**Rellenar y enviar un formulario:**
```
browser_navigate(url="https://sitio.com/contacto")
browser_type(selector="#nombre", text="Juan Pérez")
browser_type(selector="#email", text="juan@email.com")
browser_type(selector="#mensaje", text="Hola, necesito información.")
browser_click(selector="button[type=submit]")
browser_extract(selector=".mensaje-exito", attribute="text")
```

**Extraer todos los links de una página:**
```
browser_extract(url="https://sitio.com", selector="a", attribute="href", all=true)
```

**Screenshot de un componente específico:**
```
browser_screenshot(url="https://sitio.com", selector=".hero-banner")
```

**Ejecutar JS personalizado para extraer datos complejos:**
```
browser_script(
  url="https://tienda.com/productos",
  script="return Array.from(document.querySelectorAll('.producto')).map(p => ({ nombre: p.querySelector('h3').textContent, precio: p.querySelector('.precio').textContent }))"
)
```

---

## CDPClient — API de bajo nivel

El `CDPClient` es el motor que usa `BrowserService` internamente. Los tools del agente lo usan via `getBrowserService().getView()`.

### Métodos

```typescript
// Navegación
navigate(url: string): Promise<void>
  // Navega y espera document.readyState === 'complete'. Timeout: 30s.

back(): Promise<void>       // Botón atrás
forward(): Promise<void>    // Botón adelante
reload(): Promise<void>     // Recargar página

// Evaluación
evaluate<T>(script: string): Promise<T>
  // Ejecuta script como función async en la página. Soporta await.
  // Wrap automático: (async () => { return (script) })()

// Interacción
click(selector: string): Promise<void>
  // Scroll al elemento + eventos reales de mouse via CDP.
  // Lanza error si el selector no existe.

type(text: string): Promise<void>
  // Escribe en el campo enfocado. Usa Input.insertText (CDP).

press(key: string, options?: { modifiers?: string[] }): Promise<void>
  // Tecla. Modificadores: "Alt", "Control", "Meta", "Shift".
  // Ejemplo: press("a", { modifiers: ["Control"] }) → Ctrl+A

scroll(dx: number, dy: number): Promise<void>     // window.scrollBy
scrollTo(selector: string): Promise<void>         // scrollIntoView smooth

// Visual
screenshot(options?: {
  format?: "png" | "jpeg" | "webp"    // default: "png"
  quality?: number
  clip?: { x, y, width, height, scale }
}): Promise<string>   // Retorna base64

resize(width: number, height: number): Promise<void>
  // Cambia viewport via Emulation.setDeviceMetricsOverride

// CDP raw
cdp<T>(method: string, params?: Record<string, unknown>): Promise<T>
  // Comando CDP directo. Ejemplo: cdp("Page.enable")

// Ciclo de vida
close(): void
CDPClient.closeAll(): void   // Cierra todas las instancias
```

### Propiedades

```typescript
url: string     // URL actual (actualizada tras cada navigate)
title: string   // (siempre "")
loading: boolean // (siempre false)
```

### Funciones auxiliares

```typescript
// packages/core/src/tools/web/browser-service.ts

waitForSelector(view, selector, timeout?): Promise<void>
  // Polling cada 100ms hasta que !!document.querySelector(selector)

waitForCondition(view, expression, timeout?): Promise<void>
  // Polling cada 100ms hasta que la expresión JS sea truthy

screenshotElement(view, selector): Promise<string>
  // Clip screenshot del bounding box del elemento. Retorna base64 PNG.
```

---

## Comparativa con `web_fetch`

| | `web_fetch` | browser tools |
|---|---|---|
| Motor | HTTP nativo (Bun fetch) | Chrome/Brave real via CDP |
| JavaScript | No | Sí |
| Velocidad | ~200ms | ~2-5s |
| Uso ideal | Páginas estáticas, APIs REST | SPAs, sitios con JS, formularios |
| Screenshots | No | Sí (`browser_screenshot`) |
| Clic / escritura | No | Sí (`browser_click`, `browser_type`) |
| Browser visible | No | Sí — el usuario ve las acciones |

---

## Instalación del browser

El sistema detecta automáticamente el browser. Si no hay ninguno:

```bash
# Fedora / RHEL
sudo dnf install chromium

# Ubuntu / Debian
sudo apt install chromium-browser

# Flatpak (cualquier distro)
flatpak install flathub com.google.Chrome
flatpak install flathub com.brave.Browser

# Manual — indicar ruta explícita
export BUN_CHROME_PATH=/ruta/a/chrome
```

---

## Archivos relevantes

| Archivo | Descripción |
|---------|-------------|
| `packages/core/src/tools/web/browser-service.ts` | `CDPClient` + `BrowserService` singleton + helpers |
| `packages/core/src/tools/web/browser-navigate.ts` | Tool `browser_navigate` |
| `packages/core/src/tools/web/browser-click.ts` | Tool `browser_click` |
| `packages/core/src/tools/web/browser-type.ts` | Tool `browser_type` |
| `packages/core/src/tools/web/browser-screenshot.ts` | Tool `browser_screenshot` |
| `packages/core/src/tools/web/browser-extract.ts` | Tool `browser_extract` |
| `packages/core/src/tools/web/browser-script.ts` | Tool `browser_script` |
| `packages/core/src/tools/web/browser-wait.ts` | Tool `browser_wait` |
| `packages/core/src/gateway/initializer.ts` | Inicializa `BrowserService` al arrancar |
| `tests/browser-tools.test.ts` | Tests unitarios (33 tests, mock sin Chrome real) |
