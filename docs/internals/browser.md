# Navegador y web

La categoría web combina búsqueda/fetch con un navegador renderizado y gestión de evidencia:

- `web_search`, `web_fetch`
- `browser_navigate`, `browser_click`, `browser_type`
- `browser_extract`, `browser_script`, `browser_wait`
- `browser_screenshot`, `artifact_inspect`

## El motor

Las tools no hablan con un navegador concreto sino con la interfaz `BrowserBackend` (`tools/web/browser-backend.ts`). La única implementación es `WebViewBackend`: `Bun.WebView` in-process sobre un Chromium del sistema.

| | Bun.WebView (in-process) |
|---|---|
| Motor | Chrome/Chromium del sistema; WebKit sólo en un mac sin ninguno |
| `evaluate` | ~0,3 ms |
| `snapshot` | ~2 ms (árbol de accesibilidad por CDP) |
| `screenshot` | ~54 ms |
| Instalación | Ninguna. Requiere un navegador instalado, o `BUN_CHROME_PATH` |
| Headless | Sí — Bun lanza el navegador con `--headless` |

Hasta agosto de 2026 había un segundo backend, `agent-browser`, que hablaba con un CLI por subprocesos. Existía porque se creía que el WebView necesitaba entorno gráfico; medido en Bun 1.4 no es así. Lo que quedaba era su costo: ~40 ms de `Bun.spawn` por operación (contra ~0,3 ms), un `bun add agent-browser@latest` que corría **en producción** al primer uso, y ~88 MB más su propia copia de Chrome. Se retiró. `tools.browser.backend: "agent-browser"` se sigue aceptando en la config: avisa una vez y usa el WebView.

Cinco detalles del motor que están resueltos adentro y conviene conocer:

- **Una sola operación pendiente por vista.** Dos llamadas solapadas fallan con `ERR_INVALID_STATE`; el backend las serializa en una cola. El límite es por vista: varias instancias sí trabajan en paralelo.
- **`click()` sobre un selector inexistente no falla: espera para siempre.** Como la cola es de una sola vía, ese cuelgue se llevaba puesto todo el navegador. Por eso el backend comprueba que el elemento exista antes, y las operaciones que pueden colgarse llevan un tope de 15 s tras el cual la vista se descarta.
- **`goBack()`/`goForward()` no resuelven con páginas HTTP reales** (con `data:` URLs sí, que es por lo que pasaba desapercibido). El historial se maneja por CDP: `Page.getNavigationHistory` + `Page.navigateToHistoryEntry`.
- **El snapshot sale del árbol de accesibilidad de Chrome** (`Accessibility.getFullAXTree`), el mismo que recibe un lector de pantalla. Sin CDP —motor WebKit— se cae a un recorrido del DOM que imita el mismo formato (`- rol "nombre" [ref=eN]`).
- **Como root, Chromium no arranca sin `--no-sandbox`**, y Bun no lo pasa ni deja agregar argumentos. El Dockerfile apunta `BUN_CHROME_PATH` a un wrapper que agrega esa bandera y `--disable-dev-shm-usage`. Cualquier despliegue propio que corra como root necesita lo mismo.

Con motor WebKit (un mac sin ningún Chromium) no hay CDP: sin árbol de accesibilidad, sin sesión persistente, sin clics reales en `computer_use_task`, y `screenshot()` ignora formato y recorte. `hive doctor` lo reporta como advertencia.

## Sesión persistente

Las tools de navegador comparten sesiones administradas en el proceso principal. `browser_navigate` establece el contexto; las siguientes acciones operan sobre la página viva. Los selectores deben ser estables y cada mutación debe comprobar un estado posterior.

Como el perfil del WebView no sobrevive al proceso, las cookies se guardan y restauran a mano (`tools/web/browser-session.ts`): se leen con `Network.getAllCookies` después de navegar o hacer clic —con una ventana de 3 s para no guardar cinco veces durante un login— y se devuelven con `Network.setCookies` antes de la primera página del proceso siguiente. Van al almacén de secretos (keychain del sistema o la colección cifrada), nunca a un JSON en claro: una cookie de sesión vale lo mismo que la contraseña.

Se apaga con `tools.browser.persistSession: false` o `HIVE_BROWSER_PERSIST_SESSION=0`. Ojo con una consecuencia del motor: mientras haya varias vistas abiertas en el mismo proceso, Bun les da el mismo perfil de Chrome, así que dos agentes que naveguen a la vez comparten cookies.

## Capturas

`browser_screenshot` registra la imagen en el artifact store en lugar de depender de un path temporal. Devuelve un identificador que puede inspeccionarse y adjuntarse a un proof packet. La integridad se verifica con SHA-256.

## Uso seguro

- Comprueba dominio y estado antes de escribir o hacer clic.
- No confirmes compras, publicaciones, envíos o eliminaciones sin autorización.
- No extraigas cookies ni secretos al resultado del agente.
- Usa `browser_extract` para evidencia estructurada y una captura cuando el estado visual sea material.
- Informa bloqueos del sitio; no intentes eludir desafíos antiabuso.
