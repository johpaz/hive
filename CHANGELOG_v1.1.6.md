# Changelog — 1.1.6

Los agentes ya entienden los archivos que envías por el chat: Word, Excel, PowerPoint, PDF y texto llegan como archivos reales que se leen y se editan, y el agente puede devolverte la versión corregida por el mismo canal. Las imágenes las describe un modelo de visión que eliges tú, aparte del modelo del chat.

## Añadido

- **Adjuntos que el agente puede leer.** Un PDF, Word, Excel, PowerPoint, csv, txt o md enviado por la web, Telegram, WhatsApp, Discord o Slack se guarda como archivo con su extensión real. El agente recibe un aviso con el nombre, el tipo, el tamaño, el número de páginas o diapositivas, la ruta, el `artifact_id` y una vista previa corta, y lee el contenido completo cuando lo necesita. Antes el documento se mandaba a un modelo de visión como si fuera una imagen: fallaba con Word y Excel y recortaba los PDF. Las herramientas `office_leer_pdf`, `office_leer_docx`, `office_leer_xlsx` y `office_leer_pptx` aceptan ahora `artifact_id` además de `ruta`. Los adjuntos se conservan 7 días; después hay que reenviarlos.
- **Devolver el archivo corregido.** Nueva herramienta `send_file`: entrega un archivo al chat desde el que escribió el usuario. Funciona por Telegram, WhatsApp, Discord, Slack y la web, donde aparece como una tarjeta descargable con su nombre.
- **Edición de documentos en el lugar.** Tres herramientas nuevas que cambian un archivo existente sin rehacerlo desde cero y guardan una copia `<nombre>_corregido`, nunca pisan el original:
  - `office_editar_xlsx` cambia solo las celdas indicadas (valor o fórmula) y conserva el formato del resto.
  - `office_editar_docx` reemplaza texto aunque Word lo haya partido en varios fragmentos con formato distinto, y puede añadir párrafos al final. Conserva estilos, tablas e imágenes.
  - `office_editar_pptx` reemplaza texto en las diapositivas, con la opción de limitarlo a una y de incluir las notas del orador. Conserva diseño, imágenes y gráficos.
- **Lectura de PDF sin modelos.** El texto sale de la capa de texto del propio archivo, conservando renglones y columnas (una tabla sigue pareciéndose a una tabla) y separando las páginas. Cada llamada tiene un tope de 40.000 caracteres y devuelve `siguiente_pagina` para continuar. Un PDF con contraseña o dañado da un error claro, y un PDF escaneado, que no tiene texto, se avisa como tal en vez de inventar contenido.
- **Modelo analizador de imágenes.** En Providers → Imagen hay un selector «Modelo analizador», independiente del modelo del chat y común a todos los canales. Cuando el modelo del agente no ve imágenes, ese modelo describe y transcribe la imagen y el agente recibe el texto. Si no eliges ninguno, se usa el OCR por proveedor de siempre. Solo acepta modelos con visión. Rutas nuevas: `GET` y `PUT /api/multimodal/analyzer`.
- **Modelos con visión.** Qwen 3.5, 3.6 y 3.8 son multimodales y ahora figuran con visión, así que aparecen en la pestaña Imagen:
  - **OpenRouter:** Qwen4 Max, Qwen3.8 Flash, Qwen3.8 Omni Flash, Qwen3.8 27B, Qwen3.6 Plus, Qwen3.6 35B A3B y Qwen3 VL 235B; Qwen3.7 Flash gana visión.
  - **DashScope:** Qwen 3.6 Flash y Qwen 3.5 Omni Plus ganan visión.
  - **ModelScope:** Qwen3.8 27B, Qwen3.5 122B, 35B y 27B, y visión para Qwen3.5 397B.
  - **HiveAgents:** inventario revisado contra el servidor. Qwen3.6 35B y Qwen3.8 27B pasan a llevar visión y entra Qwen3.5 9B, un modelo ligero.

## Cambiado

- **Los documentos ya no pasan por un modelo de visión.** PDF, Word, Excel, PowerPoint y texto se leen de forma nativa. El modelo analizador se reserva para imágenes sueltas (png, jpg, webp y gif).
- **Más tipos de archivo en Discord y Slack.** Aceptan ahora Excel, PowerPoint, csv, md, json y cualquier `text/*`; antes ignoraban todo lo que no fuera pdf, doc, docx o txt.
- **`office_leer_pptx` lee en el orden real de la presentación**, incluye las notas del orador y devuelve cada texto una sola vez (antes lo repetía en `texto` y `fragmentos`). Como los demás lectores, tiene un tope de tamaño con `desde_diapositiva` para continuar.
- **`office_escribir_pdf`, `_docx`, `_xlsx` y `_pptx` respetan el workspace del agente.** Una ruta fuera de él devuelve un error claro en vez de escribir ahí.
- **Límites de adjuntos:** 50 MB en el chat web y en los canales, y 20 MB en Telegram, que es lo máximo que Telegram deja descargar a un bot. El WebSocket del servidor acepta mensajes de hasta 80 MB.

## Corregido

- **Un adjunto grande no se enviaba desde el chat web.** El mensaje local guardaba el archivo completo en el navegador y un `.pptx` de 10 MB superaba la cuota, lo que cortaba el envío sin avisar. Ahora los documentos no se guardan en `localStorage`, tampoco las imágenes ni los audios enormes, y si la cuota se llena el mensaje se envía igual. Además, Bun cortaba el WebSocket por encima de 16 MB sin decir nada. La interfaz avisa cuando un archivo supera el límite.
- **Una imagen que no se podía leer llegaba vacía al agente.** Si el análisis fallaba, el error solo iba al log y el agente respondía que no veía el archivo. Ahora recibe el motivo y te lo explica, y el mensaje de error combina la causa del modelo analizador con la del OCR de respaldo.
- **El modelo analizador recortaba dos veces el prefijo del proveedor** (`nvidia/nvidia/x` llegaba como `x`) y daba 404. Ahora se envía la clave del modelo tal cual.
- **`office_leer_pdf` no funcionaba.** `pdfjs` v5 exige un `workerSrc` no vacío y la herramienta lo dejaba en `""`, así que fallaba con «No workerSrc specified». Ahora registra el worker en memoria, sin depender de rutas de archivo. Además, dentro del ejecutable compilado (app de escritorio y paquete) `pdfjs` moría con «DOMMatrix is not defined», porque en desarrollo se las presta `@napi-rs/canvas` y en el ejecutable no existe; ahora se le dan versiones mínimas, ya que para extraer texto no hace falta dibujar. La lectura de PDF, Word, Excel y PowerPoint y la edición se comprobaron dentro de un ejecutable compilado.
- **Las herramientas de Office no arrastran la base de datos al worker.** El ayudante que resuelve `artifact_id` consultaba HiveDB, lo que habría roto la compilación de la app de escritorio y del paquete (el worker de herramientas no puede contener el binding nativo). Ahora localiza el archivo en disco por su id, validado como UUID, y una prueba nueva compila el worker y falla si aparece HiveDB. `send_file` se ejecuta en el hilo principal, como `notify`, porque necesita el envío por canal del proceso principal.
- **Desactivar un modelo con `/` en el id daba 404** («API Error: 404 Not Found»), por ejemplo `anthropic/claude-opus-5`. El id no se codificaba en la URL.
- **Archivos privados de Slack.** Los archivos y las imágenes de Slack solo se descargan con el token del bot; sin él devolvían una página de login. Ahora el adaptador los descarga con el token.
- **Telegram avisa cuando no puede descargar un archivo.** Antes, un archivo de más de 20 MB o una descarga fallida solo iban al log y el mensaje llegaba vacío al agente. Ahora recibes el motivo en el chat. En los demás canales, si un adjunto falla y no hay texto, ya no se ejecuta el agente con un mensaje vacío.
- **El chat abre en el último mensaje.** Empezaba en la parte superior cuando el historial del servidor reemplazaba al guardado en el navegador con otra cantidad de mensajes, o cuando imágenes y markdown terminaban de cargar después de colocar el scroll. Ahora se queda pegado al final mientras el contenido crece y deja de seguirte si subes a leer.
- **La pestaña Imagen muestra primero los modelos activos.**
- **Catálogo de modelos.** HiveAgents: el archivo del Qwen3.8 27B es ahora `Qwen3.8-27B-UD-Q6_K_XL.gguf`; el anterior (`Q4_K_XL`) ya no existe en el servidor.

## Al actualizar

- Los agentes que usaban el Qwen3.8 27B de HiveAgents quedan sin modelo, porque cambió el id del archivo. Hay que volver a elegirlo una vez en la interfaz.
- El modelo analizador es opcional y empieza en «Ninguno». Si lo configuras, elige uno con visión y que sigas teniendo disponible: NVIDIA retira modelos sin avisar y un modelo retirado hace que la imagen no se lea.
- Hay que recompilar la interfaz para ver la tarjeta de descarga, el selector del analizador y el nuevo comportamiento del scroll.

## Límites conocidos

- Se procesa un solo adjunto por mensaje.
- Un PDF escaneado (solo imágenes) no se puede leer: no hay OCR en esta versión.
- `office_editar_docx` edita el cuerpo del documento, no encabezados ni pies. `office_editar_xlsx` puede perder gráficos e imágenes, porque `exceljs` no los conserva por completo. `office_editar_pptx` cambia texto existente y no añade ni quita diapositivas.
- Si el usuario no tiene el chat web abierto, un archivo enviado con `send_file` no se entrega ni queda en cola: el fallo se devuelve al agente.

## Pruebas

- Ingesta de adjuntos, clasificación por extensión y `send_file` hacia el canal, con documentos reales de Excel, PDF y PowerPoint (`tests/attachment-ingest.test.ts`, `tests/send-file-and-ingest.test.ts`).
- Extracción de texto de PDF con archivos generados: renglones, columnas, tope, escaneado y archivo inválido (`tests/pdf-text.test.ts`).
- Lectura y edición de PowerPoint, incluido el caso de diapositivas reordenadas, y edición de Word y Excel, con el original intacto y el workspace respetado (`tests/pptx-tools.test.ts`, `tests/office-editar.test.ts`).
- Bundle del tool worker sin dependencias nativas y búsqueda de adjuntos por id (`tests/tool-worker-bundle.test.ts`).
- Modelo analizador: validación, imagen, PDF fuera de alcance y error del proveedor (`tests/vision-analyzer.test.ts`).
- Scroll del chat: carga con historial, historial reemplazado y crecimiento del contenido (`ChatHistory.test.tsx`).
- `tests/model-sync.test.ts` actualizado por los modelos nuevos de OpenRouter.
