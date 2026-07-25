# Navegador y web

La categoría web combina búsqueda/fetch con un navegador renderizado y gestión de evidencia:

- `web_search`, `web_fetch`
- `browser_navigate`, `browser_click`, `browser_type`
- `browser_extract`, `browser_script`, `browser_wait`
- `browser_screenshot`, `artifact_inspect`

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
