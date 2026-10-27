# Endpoints compatibles con OpenAI

Hive puede enviar conversaciones a un endpoint compatible con **Chat Completions** mediante el proveedor OpenAI y una URL base personalizada. La compatibilidad depende del servidor y del modelo: responder texto no garantiza soporte de herramientas, streaming o métricas de uso.

## Configuración desde la UI

1. Abre **Proveedores** y pulsa **CONFIG** en la tarjeta **OpenAI**.
2. Introduce la clave del endpoint en **API Key** y su URL en **Base URL (opcional)**. Por ejemplo, `https://api.example.com/v1`: Hive envía las peticiones a `https://api.example.com/v1/chat/completions`. Conserva cualquier prefijo que requiera tu servidor y no añadas `/chat/completions` a la URL base.
3. Pulsa **Guardar** y habilita el proveedor. Cambiar esta tarjeta afecta a los agentes que usan ese proveedor; comprueba sus modelos antes de conversar.
4. Añade el modelo al proveedor usando su ID real en la API. Puedes usar **Descubrir** si el servidor permite listar modelos o introducirlo manualmente. Configura la ventana de contexto, las capacidades y las tarifas según el modelo y el servicio.
5. Asigna el proveedor y el modelo al coordinador o al agente que quieras usar y prueba una conversación corta.

La URL se guarda como `base_url` en HiveDB y se pasa al cliente como `baseUrl`. La clave se envía como `Authorization: Bearer …`; usa una clave del endpoint elegido. El adaptador OpenAI requiere una clave no vacía incluso con una URL local. El formulario permite conservar la clave existente al dejar su campo vacío.

Si el servicio local no requiere autenticación, introduce un valor de ejemplo no vacío, como `local-placeholder`, en **API Key**. El servidor debe aceptar o ignorar la cabecera `Authorization: Bearer local-placeholder` que Hive enviará. Si rechaza cualquier cabecera de autenticación, no es compatible con esta configuración del proveedor OpenAI.

La configuración persistente se administra desde la UI; `hive config edit` está deshabilitado. Consulta [Configuración](configuracion.md) para el directorio de datos y las variables de entorno. No guardes claves reales en ejemplos o repositorios.

## Qué comprobar

- **Respuesta normal:** el servidor devuelve `choices[0].message.content`. Hive convierte `usage.prompt_tokens` y `usage.completion_tokens` en tokens de entrada y salida.
- **Streaming:** el servidor devuelve eventos SSE de Chat Completions y termina con `data: [DONE]`. Hive solicita `stream_options.include_usage` y lee el último evento de uso aunque tenga `choices: []`. Si el error menciona `stream_options` o `include_usage`, Hive reintenta automáticamente sin ese campo; puede haber respuesta sin métricas de uso.
- **Herramientas:** el modelo debe admitir llamadas nativas a funciones. Hive ensambla los fragmentos de `tool_calls[].function.arguments`; la continuación conserva el mensaje del asistente y el resultado con su `tool_call_id` correspondiente.
- **Autenticación:** un HTTP 401 se propaga como error. Revisa la clave y que la URL pertenezca al servicio que la emitió.

Una URL equivocada o un ID de modelo no disponible puede producir HTTP 404. Una API exclusivamente de Responses no cumple este contrato de Chat Completions. Los campos y comportamientos específicos de otros adaptadores no se activan por cambiar la URL de OpenAI.

## Pruebas reproducibles

```bash
bun test tests/openai-compatible-endpoint.test.ts tests/stream-usage.test.ts tests/llm-retry.test.ts
```

`openai-compatible-endpoint.test.ts` usa el adaptador OpenAI real y su SDK contra un servidor HTTP local, con claves ficticias. Cubre la ruta personalizada, Bearer, uso sin streaming, argumentos de herramientas fragmentados, uso en el evento final, continuación con resultado de herramienta y errores 401 con y sin streaming. No ejecuta herramientas reales ni certifica un servicio externo. Las otras suites cubren métricas de streaming y políticas de reintento existentes.
