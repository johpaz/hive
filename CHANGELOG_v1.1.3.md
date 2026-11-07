# Changelog — 1.1.3


Compactación con traspaso estructurado, historial recuperable y similitud episódica. Basado en «You don't need long context» (arXiv 2611.05306, https://arxiv.org/abs/2611.05306): contextos cortos y compactados con frecuencia, un estado explícito entre turnos y lectura selectiva del historial.

## Cambiado

- **La compactación conserva datos exactos.** Antes pedía un resumen de 3–5 oraciones; ahora pide un traspaso de seis campos (objetivo, hechos establecidos, cambios, verificación, callejones sin salida y plan) como JSON, lo guarda en `SummaryDoc.structured` y deja el texto renderizado en `summary`, así que los hilos con resumen anterior funcionan sin migrar. Si el modelo responde prosa cae al resumen libre. Medido con `bench/compaction` (Gemini, escenarios sintéticos), la retención de datos tras varias compactaciones pasa de 1–2 % a 74–97 % según el modelo. El traspaso es unas 3 veces más largo que el resumen anterior.
- **Compactación incremental.** Lee solo los mensajes posteriores al resumen previo, que entra por su traspaso, y cuenta los tokens del historial vivo para no recompactar en cada turno.
- **Umbral de compactación alto.** `agent.context.compactionThreshold` (≤ 1) es la parte del espacio útil de entrada (ventana × 0,8) que puede ocupar el contexto **total** del turno —sistema + herramientas + historial—; por defecto **0,65** (antes 0,25 de la ventana). Al historial le toca lo que deja la parte fija, que no se puede compactar y se mide en el turno anterior (hasta entonces, 10K supuestos): con 128K, ~57K de historial; con 0,6, ~51K. Un valor > 1 son tokens de historial. Nunca por encima del 90 % del presupuesto de historial del compilador, nunca por debajo de 2000 tokens. La transcripción que ve el resumen crece con la ventana (de 40 mensajes y 24 000 caracteres a 160 y 100 000). Para volver al comportamiento anterior, fija `compactionThreshold` en tokens (p. ej. 32000). **Ojo:** la ventana del compilador sigue siendo de 15 mensajes (`KEEP_LAST_N_MESSAGES`); entre el mensaje 16 y el umbral, lo anterior llega al modelo solo por la recuperación de «MENSAJES ANTERIORES RELEVANTES» y `conversation_read`, no por un resumen.

## Añadido

- **Recuperación del historial sin llamar al modelo.** La ventana del compilador son los últimos 15 mensajes: lo anterior solo llegaba al modelo si se había compactado. Ahora cada mensaje (de más de 24 caracteres) se indexa en HiveDB al guardarse, en segundo plano y solo con texto (BM25, sin embeddings), y en cada turno el compilador busca en el hilo lo relacionado con lo que dijo el usuario e inyecta hasta 3 mensajes anteriores (500 caracteres cada uno) en «MENSAJES ANTERIORES RELEVANTES». Si parte del hilo quedó fuera de la ventana, el prompt lo dice («HISTORIAL FUERA DE VENTANA») y apunta a `conversation_read`. Cuesta una consulta local por turno y ninguna llamada al modelo. Lo que no cubre: preguntas que no comparten palabras con el mensaje original (paráfrasis) hasta que haya embeddings; y no hay libro de trabajo como en hiveCode, porque Hive no guarda las llamadas a herramientas en el hilo.
- **Historial recuperable.** Al compactar, los mensajes se indexan en HiveDB y `conversation_read` busca por significado en todo el historial, también en lo ya compactado (antes: subcadena sobre los últimos 200 mensajes).
- **Memoria entre hilos** (opt-in, `memory.crossThreadRecall`): los resúmenes de otros hilos se inyectan por relevancia en «CONVERSACIONES RELACIONADAS».
- **Similitud episódica.** Con la memoria entre hilos activa y un HiveDB que traiga `embedQuery`, el compilador pasa `episodicSimilarity` a `buildAgentContext` y añade «EPISODIOS PREVIOS SIMILARES». Con un HiveDB anterior no se activa. Los resúmenes ya indexados se marcan como episodio en su siguiente compactación.
- **Benchmark** (`bun run bench:compaction`): `--fake`, `--hive-credentials` o una clave por variable de entorno.

### Motor de medios nativo para voz en tiempo real (app de escritorio)

- **Crate `hive-media`** (`apps/hive-desktop/crates/hive-media`, independiente de Tauri): captura y reproducción de audio (cpal; PipeWire en Linux), cámara (nokhwa, V4L2 en Linux) y pantalla (xcap; portal ScreenCast en Wayland). Audio PCM16 mono, 16 kHz de subida y 24 kHz de bajada, igual que el protocolo de `/realtime`; vídeo en JPEG.
- **Cancelación de eco real** (WebRTC AEC3 en Rust, `sonora`) con la referencia tomada de lo que realmente suena, más una **compuerta de eco residual** que aprende cuánto eco se cuela por dispositivo. Permite hablar encima de BIA (barge-in) con micrófono y altavoz separados, p. ej. televisor por HDMI, sin que se conteste a sí misma. En la medición real: eco residual 0,0000 y la voz pasa a unos −6 dB del televisor.
- **Interfaz `MediaEngine`** en `packages/hive-ui/src/lib/realtime/engine/`: motor web (WebAudio, el de siempre; web y móvil) y motor nativo (escritorio), con respaldo automático al web si el nativo falla al iniciar. Motor híbrido por defecto: audio por el motor elegido y cámara nativa; la pantalla sigue en el navegador.
- **Ajustes → Audio**: casilla «Audio nativo (experimental)» (preferencia `hive-native-audio`). Con el motor nativo se desactiva el silenciado del micrófono del Modo altavoz, porque el eco ya se cancela.
- **Nuevos comandos Tauri** (`media_*`, `bluetooth_names`) con sus permisos, y transporte de audio/vídeo por bytes crudos (sin base64) entre Rust y la interfaz.
- **Empaquetado:** `release.yml` instala las dependencias de compilación (ALSA, PipeWire, GBM, EGL, Wayland, XCB, clang); los paquetes `.deb` y `.rpm` declaran ahora las bibliotecas de ejecución (PipeWire, ALSA, GBM, EGL, DRM, Wayland, XCB); el manifiesto Flatpak abre el socket de PipeWire y `--device=all` para la cámara. Todos los paquetes del monorepo pasan a 1.1.3.

### Dispositivos de audio y Bluetooth

- **Micrófonos que son solo altavoz.** Altavoces Bluetooth que anuncian perfil manos libres (p. ej. BS-2) aparecen como micrófono. Se etiquetan «· Bluetooth» y hay un control para marcarlos como «solo altavoz» y ocultarlos de la lista de entradas.
- **Salidas Bluetooth más fiables.** Se prefiere el perfil A2DP al de manos libres (HFP), y al elegir una salida se espera hasta 6 s a que el sistema publique el destino con el puerto pedido, que era la causa de que «aparece como salida pero no suena por él» a ratos.
- **Lista de dispositivos limpia en PipeWire:** se filtran `sink_default`, «unknown», monitores y salidas listadas como entrada.

## Corregido

- **La compactación se detenía en hilos largos.** Leía el historial con `getHistory()`, que devuelve los 200 mensajes más antiguos: pasado el mensaje ~200 dejaba de avanzar.
- **BIA se escuchaba a sí misma** por altavoces abiertos (televisor) cuando el micrófono era distinto del altavoz; el Modo altavoz la evitaba solo a costa de no poder interrumpirla. Se resuelve con el audio nativo (ver arriba).
- **La cámara no se podía activar en la app de escritorio en Linux:** WebKitGTK pedía la cámara por el portal de PipeWire, agotaba el tiempo («Unable to open pipewire remote») y dejaba `/dev/video0` ocupado. La cámara nativa usa V4L2 directamente y descarta los nodos de metadatos duplicados.
- **Vista previa de cámara** (`CameraPreview.tsx`): solo llama a `play()` cuando el elemento es un `<video>`.

## Pendiente

- **Audio nativo es experimental.** Verificado en Linux (Fedora, PipeWire, televisor + micrófono USB, con llamada real a BIA). macOS y Windows compilan únicamente en el CI (`release.yml`, `desktop-test.yml`); sin probar con dispositivos reales.
- **Compartir pantalla nativo** sin verificar con una pantalla real; por eso la pantalla sigue en el motor del navegador.
- **Voces suaves** (más de ~10 dB por debajo del televisor) no atraviesan la compuerta de eco; el ajuste se calibró en una sola sala.
- **Modo de una acción por contexto**: existe solo en `@johpaz/hive-sdk` (apagado por defecto) y todavía sin evaluación de extremo a extremo. `hive` no lo tiene.
- La similitud episódica y `embedQuery` necesitan una versión de `@johpaz/hive-db` que aún no está publicada.
