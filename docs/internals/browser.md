# Navegador y web

La categoría web combina búsqueda/fetch con un navegador renderizado y gestión de evidencia:

- `web_search`, `web_fetch`
- `browser_navigate`, `browser_click`, `browser_type`
- `browser_extract`, `browser_script`, `browser_wait`
- `browser_screenshot`, `artifact_inspect`

## Backends

Las tools no hablan con un navegador concreto sino con la interfaz `BrowserBackend` (`tools/web/browser-backend.ts`). Hay dos implementaciones:

| | `agent-browser` (default) | `webview` |
|---|---|---|
| Motor | Chrome, vía el CLI de agent-browser | `Bun.WebView`: WebKit en macOS, Chrome en el resto |
| Ejecución | Un subproceso por operación | In-process |
| Costo por llamada | ~68 ms de piso | ~0,25 ms un `evaluate` |
| Instalación | ~75 MB + descarga de Chrome, diferida al primer uso | Ninguna, pero Chrome tiene que estar instalado (o `BUN_CHROME_PATH`) |
| Headless | Sí | Sí con motor chrome; el motor webkit necesita macOS |

Se elige con `tools.browser.backend` (`"agent-browser"`, `"webview"` o `"auto"`) o con la variable `HIVE_BROWSER_BACKEND`, que pisa la config. `auto` toma `webview` sólo si hay motor utilizable.

El default sigue siendo `agent-browser` porque es el que no depende de que haya un Chrome instalado: se lo descarga solo. `webview` conviene cuando ya hay Chrome y el agente hace muchas operaciones seguidas, que es donde los ~68 ms por llamada se acumulan.

Dos detalles del backend `webview` que están resueltos adentro pero conviene conocer:

- `Bun.WebView` acepta **una sola operación pendiente por vez**; dos llamadas solapadas fallan con `ERR_INVALID_STATE`. El backend las serializa en una cola interna.
- No expone árbol de accesibilidad, así que `snapshot()` se sintetiza recorriendo el DOM, imitando el formato de agent-browser (`- rol "nombre" [ref=eN]`) para que el modelo vea lo mismo con cualquiera de los dos.

## Sesión

Las tools de navegador comparten sesiones administradas en el proceso principal. `browser_navigate` establece el contexto; las siguientes acciones operan sobre la página viva. Los selectores deben ser estables y cada mutación debe comprobar un estado posterior.

## Capturas

`browser_screenshot` registra la imagen en el artifact store en lugar de depender de un path temporal. Devuelve un identificador que puede inspeccionarse y adjuntarse a un proof packet. La integridad se verifica con SHA-256.

## Uso seguro

- Comprueba dominio y estado antes de escribir o hacer clic.
- No confirmes compras, publicaciones, envíos o eliminaciones sin autorización.
- No extraigas cookies ni secretos al resultado del agente.
- Usa `browser_extract` para evidencia estructurada y una captura cuando el estado visual sea material.
- Informa bloqueos del sitio; no intentes eludir desafíos antiabuso.
