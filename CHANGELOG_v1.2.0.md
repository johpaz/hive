# Changelog — 1.2.0

Hive ya se conecta de forma nativa a tu cuenta de Google, crea imágenes desde el chat web y desde Telegram, y habla con una voz local nueva que funciona sin conexión. Todo lo que crea para ti queda en una carpeta visible de tu equipo, no escondido junto a la base de datos.

## Añadido

- **Cuenta de Google nativa.** En Ajustes → Perfil puedes conectar tu cuenta de Google y usarla también para entrar a Hive («Continuar con Google»). Hive es de un solo usuario: ese botón solo entra con la cuenta que ya vinculaste desde una sesión autenticada y nunca crea cuentas nuevas. Vincular Google en una instancia abierta también la protege con inicio de sesión.
- **21 herramientas de Google** (categoría `google`, visibles en la lista de configuración):
  - **Gmail (13):** buscar, leer mensajes e hilos, enviar, responder y reenviar (con adjuntos tomados de los artefactos de Hive), borradores (guardar, listar, enviar, borrar), marcar como leído, archivar, etiquetar y mover a la papelera, etiquetas y descarga de adjuntos.
  - **Calendar (5):** consultar eventos, crear, editar y borrar, y ver la disponibilidad (libre y ocupado).
  - **Drive (3):** buscar, descargar (los documentos de Google se exportan) y subir archivos. Nunca sobrescribe.
- **Tres especialistas de Google** en el catálogo de agentes: correo, calendario y Drive. Nacen **apagados** y se activan solos cuando conectas esa parte de tu cuenta; al desconectar se apagan, y si apagas uno a mano Hive lo respeta. Activar uno sin conexión devuelve un error claro y la pantalla de Agentes enlaza al perfil. Con esto el catálogo pasa de 9 a 12 agentes.
- **Confirmación antes de actuar.** Enviar, responder o reenviar un correo, borrar eventos, borradores o etiquetas y crear eventos con invitados piden `confirmed=true` antes de ejecutarse. Marcar como leído, archivar o etiquetar es reversible y no la pide. No existe el borrado permanente de correos, a propósito.
- **Google en la app de escritorio y en `localhost`.** Google bloquea el inicio de sesión dentro de ventanas embebidas, así que en la app de escritorio el gateway abre el navegador del sistema y la ventana espera el resultado. La URI de retorno se calcula por solicitud (también con el puerto aleatorio del escritorio) y el panel de conexión la muestra para diagnosticar `redirect_uri_mismatch`. El instalador compila `HIVE_GOOGLE_CLIENT_ID` y `HIVE_GOOGLE_CLIENT_SECRET`; en ejecución mandan `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, que son las mismas credenciales de hive-cloud. Opcionales: `GOOGLE_REDIRECT_URI` y `GOOGLE_SCOPES`.
- **Crear imágenes.** Nueva herramienta `image_generate` (categoría `image`): describes lo que quieres, con un formato opcional (cuadrado, horizontal, vertical, 4:3 o 3:4), y la imagen aparece en el chat web y en Telegram. Los coordinadores saben que pueden crearlas cuando hay un modelo elegido, y si falta, la herramienta te indica dónde configurarlo.
- **Selector de modelo de imágenes.** En Providers → Imagen hay un bloque «Modelo generador de imágenes» junto al analizador de visión. Muestra los modelos de los providers que saben generar imágenes (hoy NVIDIA) y exige su API key. Rutas nuevas: `GET` y `PUT /api/multimodal/image-model`.
- **Modelos de imagen en el catálogo.** Nuevo tipo de modelo `image` con FLUX.2 Klein 4B y FLUX.1 Schnell de NVIDIA, verificados con la API real. No aparecen en el selector de modelos de chat de los agentes.
- **Voz local con Kitten TTS.** Kitten TTS 2 Mini (int4, español) reemplaza a Piper, con Lucía como voz predeterminada. Funciona sin conexión una vez instalado, arranca solo con el gateway y Providers → Voz muestra su estado, deja reintentar y permite escuchar una muestra con otra voz o texto. Cada release publica un paquete por plataforma (Linux x64 y arm64, macOS x64 y arm64, Windows x64) con Python, ONNX Runtime para CPU, los pesos y las voces. Si el paquete de tu versión aún no existe, el gateway lo instala desde las fuentes oficiales con `uv`, y esa primera vez necesita conexión.
- **Más modelos de transcripción.** NVIDIA (Parakeet y Canary, con un endpoint propio), ElevenLabs Scribe v2 y v3 y GPT Transcribe de OpenAI. La transcripción por proveedor se resuelve por catálogo en vez de una lista fija de Groq y OpenAI.

## Cambiado

- **Lo que Hive crea queda en una carpeta visible.** Las herramientas guardan sus archivos en el workspace del agente o, si no tiene, en `~/Hive` (se cambia con `HIVE_OUTPUT_DIR`), con nombres legibles como `2026-11-24_2158_abeja-robot.jpg` que nunca pisan un archivo existente:
  - `imagenes/` para las imágenes generadas,
  - `descargas/` para los adjuntos de Gmail y los archivos de Drive,
  - `capturas/` para las capturas del navegador,
  - `reuniones/` para los informes de reunión en .docx, siempre en `~/Hive` porque se generan sin agente.

  Siguen en `~/.hive/artifacts` los resultados grandes de herramientas MCP y las copias de los adjuntos que subes al chat. Si mueves o borras un archivo creado, su referencia en el chat queda sin contenido.
- **Las imágenes generadas no caducan.** Los demás artefactos conservan su retención de 7 días.
- **Piper desaparece.** Los modelos y canales que usaban Piper se migran a Kitten y las voces de Piper salen del catálogo. Se retiran la descarga de modelos, el servidor local anterior y su tarjeta de la interfaz.
- **El release se publica antes que npm y Docker.** Ambos esperan a que exista el release de GitHub, para que ningún paquete publicado apunte a archivos que todavía no están.

## Corregido

- **La imagen generada desaparecía al recargar.** El historial del chat no guardaba qué imágenes entregó cada respuesta, y al cerrar y abrir la app o la pestaña se perdían. Ahora se guardan con la respuesta.
- **La imagen salía rota con el inicio de sesión activo.** Una etiqueta `<img>` no puede enviar el token del gateway y la descarga recibía 401. El chat descarga ahora la imagen con el token por cabecera, sin ponerlo en la URL.
- **Pedir «envíamela por correo» regeneraba la imagen.** El modelo solo veía el texto de su respuesta anterior. Ahora conoce el `artifact_id` de lo que ya entregó y lo usa para adjuntar o enviar sin crear otra.
- **Bee decía que no podía crear imágenes.** Los coordinadores descubren las herramientas con `search_knowledge`, y no la buscaba. Su prompt ahora le indica cómo encontrarla.
- **Cuenta de Google ya conectada con agentes apagados.** Quien conectó antes de esta versión veía sus tres especialistas inactivos; la primera vez que Hive detecta la conexión los activa, y desde entonces respeta lo que apagues a mano.
- **La app de escritorio en Windows no abre ventanas de consola** al arrancar o instalar Kitten.
- **Typecheck de la CI.** `tests/a2ui-complete.test.ts` ya no rompe `bun run lint`.

## Para quien publica

- Hace falta un cliente OAuth de Google de tipo **Aplicación de escritorio** y los secrets `HIVE_GOOGLE_CLIENT_ID` y `HIVE_GOOGLE_CLIENT_SECRET` en GitHub para que el instalador traiga Google. Un cliente de tipo Web solo sirve con el puerto 18790 y con cada URI de retorno registrada.
- Los permisos de Gmail (`gmail.modify`, `gmail.send`) y `drive.readonly` son restringidos: en producción exigen la verificación de la app de Google.
- NVIDIA ofrece la generación de imágenes gratis solo como cuenta de prueba, con límites de solicitudes. Su API alojada no permite editar fotos propias, así que no hay herramienta de edición de imágenes.
