# Artefactos administrados

El artifact store guarda en disco contenido que no debe viajar por la ventana de contexto y entrega una referencia liviana en su lugar. Cada artefacto tiene dueño, hash SHA-256, tamaño y vencimiento a los siete días.

## Qué se convierte en artefacto

`browser_screenshot` registra ahí sus capturas. `mcp-result-normalizer.ts` hace lo mismo con lo que devuelven los servidores MCP: bloques binarios (`image`, `audio`, `resource` con `blob`) y bloques de texto de más de 20.000 caracteres — configurable con `HIVE_MCP_INLINE_MAX_CHARS`.

El modelo recibe entonces un `artifact_ref` con `artifact_id`, `mime_type`, tamaño y un preview corto. Para un JSON se agregan además la cantidad de elementos y las claves del primero, que es lo que permite apuntar una búsqueda en vez de paginar a ciegas.

## Cómo se leen de vuelta

- `artifact_inspect` devuelve metadatos e integridad. Nunca contenido.
- `artifact_read` devuelve el texto: por tramos (`offset`/`limit`) o con `search`, que responde con extractos alrededor de cada coincidencia. El ancho de esos extractos se ajusta con `context`, y el total devuelto está acotado sin importar cuántas coincidencias haya.

Los artefactos binarios se rechazan en `artifact_read`: para una imagen la referencia ya viaja sola hasta el chat o el canal.

Cuando un resultado trae un `artifact_ref` de texto, el agent loop mete `artifact_read` en el loadout de inmediato. La alternativa —esperar a que el modelo lo descubra por `search_knowledge`— cuesta una iteración y depende de que se le ocurra buscarlo: en el incidente que originó esta tool, un resultado de 245 KB de Gmail terminó con el agente llamando a `artifact_inspect`, recibiendo metadatos, gastando el resto de sus iteraciones a ciegas y muriendo en una síntesis vacía.
