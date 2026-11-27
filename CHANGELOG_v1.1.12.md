# Changelog — 1.1.12

Las herramientas de servidores MCP ya no hacen fallar a Gemini ni a NVIDIA: Hive limpia sus esquemas antes de enviarlos.

## Corregido

- **Error 400 al usar herramientas MCP con Gemini o NVIDIA.** Muchos servidores MCP publican esquemas con construcciones que esas APIs rechazan, como `x-google-identifier` («Unknown name») o referencias `$ref` sin resolver. Ahora Hive expande las referencias locales (`$ref`, `$defs` y `definitions`, con tope para las circulares) y quita las extensiones `x-*`, `$schema`, `$id` y `$comment` antes de enviar la herramienta. Los nombres de propiedades y los valores de `enum`, `default` y `const` se conservan tal cual.
- **Misma limpieza para todos los proveedores y para la voz en tiempo real.** Aplica a los proveedores compatibles con OpenAI, a Gemini y a Gemini Live, y también a las herramientas MCP al compilar el contexto de un agente.
