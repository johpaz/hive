# Changelog — Hive 1.0.5

Fecha: 2026-08-25

Hive 1.0.5 presenta **HiveLive**, la nueva experiencia de conversación en tiempo real de Hive, y a **BIA**, su interfaz de voz. BIA escucha, habla, puede recibir cámara o pantalla y coordina la colmena de agentes cuando una petición requiere trabajo real. La versión también fortalece la aplicación de escritorio, la automatización del navegador y la observabilidad del razonamiento de los modelos.

## Añadido

- **HiveLive**: nueva consola de voz en tiempo real disponible desde la interfaz de Hive.
  - Conversación de audio bidireccional mediante Gemini Live.
  - Transcripción, latencia, uso y costo estimado visibles durante la sesión.
  - Selección de voz e idioma, con variantes de español para Colombia, México, Argentina, España y Estados Unidos, además de inglés y portugués de Brasil.
  - Cámara y pantalla compartida como contexto visual para la conversación.
- **BIA, la voz de Hive**: nueva identidad visual y conversacional que actúa como interfaz del coordinador.
  - Avatar 3D y retrato optimizado para equipos con menor capacidad gráfica.
  - Estados visuales para escucha, habla, procesamiento, éxito y error.
  - Narración breve del progreso de la colmena sin exponer mensajes internos.
- **Delegación desde la voz**: BIA puede enviar solicitudes al coordinador y mantener informada a la persona mientras trabajan los especialistas.
  - Consulta del estado de tareas sin duplicar delegaciones.
  - Entrega de hitos y resultados dentro de la sesión en tiempo real.
  - Soporte para grupos de agentes trabajando en paralelo.
- **Controles de audio de escritorio**:
  - Selección de micrófono y salida de audio desde HiveLive o Ajustes.
  - Activación de perfiles de salida HDMI, USB y otros dispositivos reportados por el sistema operativo.
  - Modo altavoz para evitar que BIA se interrumpa a sí misma cuando el micrófono recoge su propia voz.
- **Controles de visualización de escritorio**: ajuste de zoom nativo y panel compartido de pantalla y audio.
- **Computer use y navegador integrado**:
  - Nuevas acciones de interacción visual e ingreso de datos.
  - Sesiones de navegador persistentes para conservar estado y autenticación entre operaciones.
  - Mejor manejo de imágenes, capturas y eventos de entrada.
- **Razonamiento visible**: la interfaz puede mostrar el razonamiento transmitido por proveedores compatibles, con adaptación para las distintas familias de modelos.

## Cambiado

- El backend del navegador se consolidó sobre WebView para reducir dependencias y evitar instalar un navegador adicional en producción.
- El onboarding y el catálogo de modelos reconocen modelos de tipo `realtime` y configuran HiveLive cuando existe un proveedor compatible.
- La aplicación de escritorio incorpora permisos nativos específicos para consultar dispositivos, cambiar la salida de audio y ajustar el zoom.
- La selección de modelo y las guías de proveedores distinguen las capacidades necesarias para voz en tiempo real.
- La UI empaquetada incluye los recursos 3D y visuales de BIA.
- Los flujos de CI y la aplicación de escritorio se actualizaron a Bun 1.4.

## Corregido

- Persistencia de sesiones y contexto en el navegador integrado.
- Procesamiento de imágenes y capturas usadas por herramientas visuales.
- Eventos de teclado, ratón y escritura en flujos de computer use.
- Cierre de procesos del navegador desde el gateway.
- Manejo de dispositivos de audio y perfiles de salida en la aplicación de escritorio.
- Reintentos de construcción del instalador `.dmg` ante fallos intermitentes de macOS.
- Las herramientas de Excel cargan `xlsx` bajo demanda y ahora explican cómo recuperar la instalación si falta esa dependencia, en lugar de mostrar un error interno del módulo.

## Notas de HiveLive

- Compartir cámara o pantalla incrementa el consumo y puede reducir la duración disponible de la sesión en tiempo real.
- En Linux, el modo altavoz evita el eco bloqueando el micrófono mientras BIA habla. Para interrupción de voz full-duplex mediante altavoces abiertos se recomienda configurar la cancelación de eco de PipeWire y seleccionar su micrófono virtual en HiveLive.
- BIA delega el trabajo que requiere investigación, archivos, documentos, APIs, código o automatizaciones; los saludos y las aclaraciones conversacionales se responden directamente.
- La supervisión humana sigue siendo necesaria: la cámara y la pantalla aportan contexto, pero no convierten una inferencia del modelo en un hecho verificado.

## Compatibilidad

- Actualización compatible con las instalaciones 1.0.x existentes.
- HiveLive requiere un modelo y proveedor con capacidad de audio en tiempo real.
- La aplicación de escritorio continúa disponible para Windows, macOS y Linux; npm y Docker siguen siendo alternativas compatibles.
