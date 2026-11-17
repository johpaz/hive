# Changelog — 1.1.5

Los avisos de las tareas programadas llegan a todos tus canales con la hora correcta, los documentos de Office salen con estilo, los modelos se actualizan solos desde cada proveedor y BIA gana cuerpo y expresión.

## Añadido

- **Documentos de Office con estilo.** `office_escribir_pdf`, `office_escribir_docx`, `office_escribir_xlsx` y `office_escribir_pptx` generan ahora documentos con el mismo modelo que el SDK de Rust, en vez de texto plano:
  - **PDF:** bloques (títulos, párrafos con negrita, cursiva, subrayado, color y enlaces, listas con un nivel anidado, tablas con el encabezado repetido entre páginas y cebra, citas, código, reglas, espacios y saltos de página), temas `modern`, `classic`, `corporate` y `minimal` con colores y fuentes sobreescribibles, y encabezado y pie con `{page}`, `{pages}` y `{title}`. `contenido` acepta markdown simple (`#`, `-`, `1.`, `>`, tablas con `|`, `---`). Los caracteres fuera del alfabeto latino occidental (un emoji, por ejemplo) se sustituyen por `?` y la respuesta lo informa.
  - **Word:** estilos reales de título con la fuente y el color del tema, tablas con encabezado en color, cebra y bordes, listas con viñetas y numeradas, citas, código, y encabezado y pie con número de página real.
  - **Excel:** encabezado con estilo, fila fija y autofiltro por defecto, y anchos ajustados al contenido. Por columna admite formato (fecha, fecha y hora, hora, entero, decimal, miles, porcentaje, moneda, texto o un código de Excel), ancho, negrita, color, relleno, alineación y ajuste de texto. Las fechas ISO se guardan como fechas reales y un texto que empieza por `=` nunca se evalúa como fórmula.
  - **PowerPoint:** temas `modern`, `light`, `dark`, `corporate` y `warm`, portada con fondo y subtítulo, barra de acento, número de diapositiva y notas del presentador.
  - Los parámetros anteriores (`parrafos`, `tablas`, `contenido`, `diapositivas`) siguen funcionando, así que las tareas y el informe de reuniones no cambian. Excel pasa a escribirse con `exceljs`, porque `xlsx` no guarda estilos de celda.
- **Sincronización de modelos con cada proveedor.** Al arrancar, en segundo plano, Hive pregunta a cada proveedor **activo** qué modelos tiene y actualiza la base de datos: ventana de contexto, tipo, capacidades y, cuando el proveedor lo publica, el precio. Un modelo nuevo entra apagado para no llenar la interfaz de cientos de opciones (los de Ollama, encendidos como siempre). Lo que ya configuraste (nombre, encendido, activo y precio) se respeta. Un modelo que el proveedor ya no lista —NVIDIA retira modelos sin avisar y responde 410— no se borra, porque puede haber agentes apuntándole: se marca como retirado y se desmarca si vuelve. Un fallo de red o de clave no toca nada y se informa por proveedor sin mostrar la clave. `POST /api/models/refresh` lo ejecuta a demanda y `HIVE_MODEL_SYNC=0` lo desactiva.
- **Obscura se instala solo.** La primera vez que una herramienta `obscura_*` no encuentra el binario, lo descarga (versión fijada v0.2.7) en `~/.hive/bin`. Si falla, el error explica por qué. `HIVE_OBSCURA_AUTO_INSTALL=0` lo desactiva.
- **BIA con cuerpo y expresión.** El cuerpo deja de ser una pieza rígida: el modelo trae un esqueleto de 14 huesos (columna, pecho, cuello, cabeza, hombros, brazos, antebrazos, alas y cola) y cada estado mueve los suyos: la cabeza se ladea al pensar y asiente con el énfasis de la voz, las alas aletean al celebrar, la cola se mece con retardo y el antebrazo acompaña el ademán de la mano. La cara suma cejas, mejillas y comisuras: abre las cejas al escuchar, frunce una más que la otra al pensar, sube mejillas y cejas en el éxito y junta el ceño en una alerta.

## Cambiado

- **Las tareas programadas avisan por todos los canales activos.** Antes el resultado salía por un solo canal (el de la tarea, el preferido o uno por prioridad). Ahora va a todos los canales activos y conectados, sin distinción, tanto si la tarea termina bien como si falla. Cada canal recibe el aviso en su propio hilo, y si uno falla los demás se envían igual.
- **Fechas en tu zona horaria.** El aviso de cada tarea lleva la hora de finalización en tu zona (por ejemplo `17/11/2026 16:22:02 (America/Bogota)`). `cron.list` devuelve `next_run` y `last_run` ya convertidos, con el campo `timezone`, y `cron.create` confirma la próxima ejecución en tu zona en vez de la del servidor.
- **Catálogo de NVIDIA revisado el 2026-11-16** contra `/v1/models` y con llamadas reales, de texto y de herramientas. Salen de la lista los modelos retirados o que ya no responden: Nemotron 3 Super, GLM 5.2, MiniMax M3, Kimi K3 y DeepSeek V4 Flash. Entran Nemotron 3.5 Super VL 120B (ahora el recomendado en el asistente de configuración), Nemotron 3.5 Bolt E4B, Nemotron 3 Nano Omni 30B y varios más que llaman herramientas. Que un proveedor liste un modelo no garantiza que funcione, así que solo quedan los comprobados.
- **Catálogo de voz y tiempo real:** Gemini 3.8 Live (tiempo real), Gemini 3.8 Flash TTS y Flash Lite TTS, Qwen Audio 3.1 TTS Flash y los modelos Eleven V4, V4 Turbo y V3 Conversational. Entran solo los que Hive sabe ejecutar.
- **La lista de modelos disponibles de un proveedor** usa ahora la misma consulta que la sincronización, e incluye Gemini y Anthropic.

## Pruebas

- Pruebas nuevas de los avisos de tareas programadas a varios canales y de la conversión de fechas a la zona del usuario (`tests/cron-notify-all-channels.test.ts`).
- Pruebas de la sincronización de modelos: modelos nuevos, actualizados y retirados (`tests/model-sync.test.ts`).
- Pruebas de generación de PDF, Word, Excel y PowerPoint que abren los archivos y comprueban los estilos aplicados (`tests/office-write-styles.test.ts`).
- Pruebas del movimiento del cuerpo de BIA (`cuerpo.test.ts`).
