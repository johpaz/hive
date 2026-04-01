# 🌐 Browser Tools

Hive incluye 7 herramientas de automatización web que usan **Chromium real** (vía [Puppeteer](https://pptr.dev)). Permiten navegar sitios con JavaScript, extraer datos, interactuar con formularios y tomar capturas de pantalla.

---

## Arquitectura

```
Agent
  └─ browser_navigate / browser_click / ...
        └─ BrowserService  (packages/core/src/tools/web/browser-service.ts)
              └─ puppeteer.launch()  → Chromium headless
                    └─ Página persistente  ← reutilizada por todos los tools
```

**Página persistente:** Chromium abre una sola página que se reutiliza entre llamadas. Esto evita el overhead de abrir/cerrar el browser en cada tool call. Si la página se cierra inesperadamente, `BrowserService.getPage()` la recrea automáticamente.

**Inicio automático:** Cuando el Gateway arranca, `initializeBrowserService()` llama a `browserService.start()`, que ejecuta `puppeteer.launch()`. Puppeteer descarga y gestiona su propio binario de Chromium (~170 MB, solo la primera vez).

---

## Herramientas

### `browser_navigate`

Navega a una URL y retorna el texto renderizado de la página (con JS ejecutado).

**Cuándo usar:** Sitios con contenido dinámico (React, Vue, Angular, SPAs). Para páginas estáticas, `web_fetch` es más rápido.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `url` | string | Sí | URL a navegar |
| `waitFor` | string | No | Selector CSS a esperar antes de retornar |
| `timeout` | number | No | Timeout en ms (default: 30000) |

**Retorno:**
```json
{
  "ok": true,
  "url": "https://ejemplo.com",
  "finalUrl": "https://ejemplo.com/redirected",
  "content": "Texto limpio de la página...",
  "length": 4200,
  "statusCode": 200
}
```

**Notas:**
- Elimina `<script>`, `<style>`, `<iframe>` antes de retornar el texto
- `finalUrl` puede diferir de `url` si hubo redirects
- `waitUntil` interno: `"domcontentloaded"` (compatible con Chromium)

---

### `browser_extract`

Extrae texto, atributos o links de elementos específicos usando selectores CSS o XPath.

**Cuándo usar:** Scraping estructurado cuando se sabe exactamente qué elementos extraer.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS o XPath (prefijo `xpath:`) |
| `url` | string | No | Navegar a esta URL antes de extraer |
| `attribute` | string | No | `text` (default), `href`, `src`, `alt`, `innerHTML` |
| `all` | boolean | No | `true` = todos los matches (default), `false` = solo el primero |
| `timeout` | number | No | Timeout en ms (default: 30000) |

**Retorno:**
```json
{
  "ok": true,
  "url": "https://ejemplo.com",
  "selector": "h2.titulo",
  "attribute": "text",
  "count": 3,
  "data": ["Título 1", "Título 2", "Título 3"]
}
```

**Ejemplos de selector:**
```
"h1"                          → primer/todos los h1
"a.nav-link"                  → links de navegación
"xpath://div[@class='precio']"  → XPath
"[data-testid='product-card']" → atributo data
```

**Notas:**
- Si el selector no aparece en el timeout, el tool intenta la extracción de todas formas (no falla)
- El wait interno está limitado a 10 segundos independientemente del `timeout` total

---

### `browser_screenshot`

Toma una captura de pantalla de la página actual (o navega primero si se pasa `url`).

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `url` | string | No | Navegar a esta URL antes del screenshot |
| `fullPage` | boolean | No | Capturar página completa (default: `false`) |
| `selector` | string | No | Capturar solo el elemento que coincida con este selector |

**Retorno:**
```json
{
  "ok": true,
  "url": "https://ejemplo.com",
  "screenshot": "<base64 PNG>",
  "format": "png",
  "encoding": "base64",
  "fullPage": false,
  "viewport": { "width": 1920, "height": 1080 }
}
```

---

### `browser_click`

Hace clic en un elemento de la página.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS del elemento a clickear |
| `url` | string | No | Navegar aquí antes de hacer clic |
| `timeout` | number | No | Timeout en ms (default: 30000) |

**Retorno:**
```json
{
  "ok": true,
  "message": "Successfully clicked element: button.submit",
  "selector": "button.submit",
  "url": "https://ejemplo.com/form"
}
```

---

### `browser_type`

Escribe texto en un campo de formulario.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | Sí | Selector CSS del input |
| `text` | string | Sí | Texto a escribir |
| `url` | string | No | Navegar aquí antes de escribir |
| `clear` | boolean | No | Limpiar el campo antes (default: `true`) |
| `timeout` | number | No | Timeout en ms (default: 30000) |

---

### `browser_script`

Ejecuta JavaScript arbitrario en el contexto de la página y retorna el resultado.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `script` | string | Sí | Código JS a ejecutar |
| `url` | string | No | Navegar aquí antes de ejecutar |
| `timeout` | number | No | Timeout en ms (default: 30000) |

**Retorno:**
```json
{
  "ok": true,
  "url": "https://ejemplo.com",
  "result": { "precio": "99.99", "stock": 5 },
  "scriptLength": 120
}
```

**Ejemplo de script:**
```js
return { title: document.title, links: document.querySelectorAll('a').length }
```

---

### `browser_wait`

Espera a que un selector CSS, XPath o condición JS sea verdadera.

**Parámetros:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `selector` | string | No | Selector CSS o XPath a esperar |
| `condition` | string | No | Expresión JS que debe ser truthy |
| `url` | string | No | Navegar aquí antes de esperar |
| `timeout` | number | No | Timeout en ms (default: 30000) |
| `state` | string | No | `visible` (default), `hidden`, `attached` |

Al menos uno de `selector` o `condition` es requerido.

---

## Flujo típico de automatización

```
1. browser_navigate  →  cargar la página
2. browser_wait      →  esperar que el contenido dinámico cargue (opcional)
3. browser_extract   →  extraer datos estructurados
   o browser_click   →  interactuar con un botón/link
   o browser_type    →  llenar un formulario
4. browser_screenshot → capturar evidencia visual (opcional)
```

**Ejemplo — extraer precios de un e-commerce:**
```
browser_navigate(url="https://tienda.com/productos")
browser_extract(selector=".precio", attribute="text", all=true)
```

**Ejemplo — llenar y enviar un formulario:**
```
browser_navigate(url="https://sitio.com/contacto")
browser_type(selector="#nombre", text="Juan Pérez")
browser_type(selector="#email", text="juan@email.com")
browser_click(selector="button[type=submit]")
browser_extract(selector=".mensaje-exito", attribute="text")
```

---

## Diferencia con `web_fetch`

| | `web_fetch` | `browser_navigate` |
|---|---|---|
| Motor | HTTP nativo (Bun) | Chromium real |
| JavaScript | No | Sí |
| Velocidad | ~200ms | ~2-5s |
| Uso ideal | Páginas estáticas, APIs | SPAs, sitios con JS |
| Screenshots | No | Sí (`browser_screenshot`) |
| Interacción | No | Sí (click, type) |

---

## Archivos relevantes

| Archivo | Descripción |
|---------|-------------|
| `packages/core/src/tools/web/browser-service.ts` | Singleton de Chromium, gestión de página persistente |
| `packages/core/src/tools/web/browser-navigate.ts` | Tool `browser_navigate` |
| `packages/core/src/tools/web/browser-extract.ts` | Tool `browser_extract` |
| `packages/core/src/tools/web/browser-screenshot.ts` | Tool `browser_screenshot` |
| `packages/core/src/tools/web/browser-click.ts` | Tool `browser_click` |
| `packages/core/src/tools/web/browser-type.ts` | Tool `browser_type` |
| `packages/core/src/tools/web/browser-script.ts` | Tool `browser_script` |
| `packages/core/src/tools/web/browser-wait.ts` | Tool `browser_wait` |
| `packages/core/src/gateway/initializer.ts` | Inicia `BrowserService` al arrancar el Gateway |
