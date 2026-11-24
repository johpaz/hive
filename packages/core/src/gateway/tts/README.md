# Kitten TTS local

El gateway instala y arranca Kitten TTS 2 Mini int4 en segundo plano. El paquete de la versión de Hive incluye Python, ONNX Runtime para CPU, los pesos y las voces en español. Después de la instalación, la síntesis funciona sin conexión. Lucía es la voz predeterminada.

Los paquetes se publican por plataforma junto con la versión de Hive. El gateway guarda Kitten en `HIVE_TTS_ROOT/kitten` o en `HIVE_HOME/tts/kitten`. **Providers → Voz** muestra el estado y permite reintentar la instalación o el arranque.

Si el paquete de Hive todavía no está publicado, el gateway instala automáticamente una distribución portátil de Python y prepara Kitten con los pesos oficiales. El primer arranque necesita conexión para descargar los componentes.

Para generar el archivo que publica CI, ejecuta el empaquetador con Python 3.12 y `uv`:

```bash
python3.12 packages/core/src/gateway/tts/build.py /tmp/hive-kitten-bundle
```

Fija `HIVE_KITTEN_ARCHIVE` a la ruta del archivo generado al iniciar el gateway. El archivo `.sha256` debe estar junto al paquete.
