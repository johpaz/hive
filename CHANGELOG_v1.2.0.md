# Changelog — 1.2.0

Nace el estudio de video de Hive: crea reels verticales completos, con tu voz, música, subtítulos y gráficos, desde la pestaña Video o pidiéndoselo al agente Director de video. Sirve tanto con personajes como sin ellos, con tarjetas de gráficos y narración.

## Añadido

- **Estudio de video (pestaña Video).** Crea reels verticales de principio a fin: guion, escenas, voz, música, subtítulos y unión final. Los clips los genera Gemini Omni, las imágenes Nano Banana, y el agente **Director de video** puede armar y producir un reel desde el chat. Antes de producir se muestra el costo estimado y la aprobación se da solo desde la interfaz.
  - **Tres tipos de escena:** clip de Gemini, **tarjeta de gráficos** (título, cifra con barra, lista, cita, comparación o llamada a la acción; se dibuja en tu equipo, no cuesta nada y el texto sale exacto, con acentos y ñ) e **imagen con movimiento** (una imagen de Nano Banana con zoom o paneo suave, de unos US$0.04). Las tarjetas necesitan Chrome o el navegador integrado de Hive.
  - **Identidad visual:** 6 estilos (Pulso suizo, Terciopelo, Señal suave, Tipografía fuerte, Deriva de datos y Corte oscuro) o colores propios. Cambiarla redibuja las tarjetas sin costo.
  - **Reels sin personaje:** una voz en off narra las escenas. Si no eliges una voz de ElevenLabs, la locución la genera Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`, con el 2.5 como respaldo) con la misma clave del estudio.
  - **Tu voz con ElevenLabs:** clonada, ajustada palabra por palabra a los labios de Gemini o en modo narración. La clave se lee de la base de datos de Hive, igual que la de Gemini. Hay botones de etiquetas de entonación (`[curious]`, `[excited]`, `[serious]`) y el guionista escribe con frases cortas, gancho, contrastes y palabras clave en mayúsculas.
  - **Efectos de voz:** micrófono de estudio, podcast, íntima, radio, teléfono, megáfono, cinematográfica y sala amplia, por personaje o por escena, con sugerencias automáticas según el texto. Son gratis y se aplican al armar el audio final. El de estudio mide el tono de cada voz y se ajusta, para no apagar una voz oscura ni dejar con siseo una brillante.
  - **Música de fondo con Lyria 3.5:** instrumental, suave y según el tema del reel (unos US$0.08, incluidos en el costo que apruebas). Baja sola cuando habla la voz.
  - **Audio final de una sola vez:** el video se une sin sonido y la pista se arma al terminar desde los clips originales, con un solo AAC y una normalización final a unos −15 LUFS. Si falla, se usa el método anterior y se avisa.
  - **Rehacer la voz sin pagar el video:** cada escena conserva su clip original de Gemini, así que cambiar voz, ajustes o efecto no regenera ni cobra el clip.
  - **Recorte automático** del silencio al inicio y al final de cada escena hablada.

## Cambiado

- **Cada escena guarda su clip original de Gemini.** Cambiar la voz, sus ajustes o el efecto ya no regenera ni cobra el clip, solo la voz.
- **El costo que apruebas incluye la música**, y la aprobación se da solo desde la interfaz.

## Corregido

- **La voz se trababa, con eco o apagada.** La voz sincronizada se rehízo: coloca cada pieza en su punto más silencioso con fundidos de 4 ms, evita estirar de más y cae a un método más simple si ffmpeg no puede. Un MP3 de ElevenLabs con tramos muy cortos ya no hace fallar el ajuste.
- **La voz sonaba «de tarro».** Las voces clonadas salen oscuras (casi sin agudos). El efecto de estudio recorta el cuerpo turbio de 220 a 700 Hz, sube la claridad y limita el aire, y la mezcla ya no sale a −12 LUFS pegada al techo.
- **La voz en off recortaba el video.** En escenas sin audio propio, la narración cortaba la escena a lo que duraba la voz y las tarjetas se cortaban antes de su salida.
- **Error `net::ERR_FILE_NOT_FOUND` al dibujar tarjetas.** La página se pasaba al navegador como archivo temporal que a veces no veía; ahora se entrega directamente.
- **Transiciones que caían a corte directo** al mezclar tarjetas y clips de Gemini, por bases de tiempo distintas (`First input link main timebase`). Ahora se normalizan antes de unir.

## Para quien publica

- Las tarjetas de gráficos necesitan Chrome o Chromium (o `BUN_CHROME_PATH`); el estudio usa el mismo navegador integrado que los subtítulos y la herramienta de navegación. Sin él, esas escenas fallan con un aviso claro.
- Hacen falta las claves de Gemini (clips, imágenes, música y voz en off) y, para voces propias, la de ElevenLabs, que se guardan en la base de datos de Hive.
- No probado con servicios reales: el modo de cambio de voz (`convert`) y la clonación de voz de ElevenLabs.
