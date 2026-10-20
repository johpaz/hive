# Por dentro de un enjambre

John Alexander Páez Arias · DevOpsDays Bogotá 2026

Duración: 30 minutos (27 de contenido + 3 de preguntas).

Presentación editable basada en la versión de Descargas con una sola portada. Foto proporcionada por John. El original se conserva. Los diagramas son formas y texto editables. Las notas están también dentro del PowerPoint.

El contenido técnico se contrastó con el código y documentación locales el 8 de octubre de 2026. La demo propuesta todavía requiere ensayo; la captura de Office3D es ilustrativa.

| Lámina | Inicio | Duración | Tema |
|---|---|---|---|
| 1 | 00:00 | 0:30 | Por dentro de un enjambre |
| 2 | 00:30 | 0:30 | John Alexander Páez Arias |
| 3 | 01:00 | 0:45 | Responder es solo una parte del trabajo |
| 4 | 01:45 | 0:30 | Tres piezas para operar un enjambre |
| 5 | 02:15 | 1:30 | La arquitectura, de extremo a extremo |
| 6 | 03:45 | 1:15 | El harness convierte intención en ejecución |
| 7 | 05:00 | 1:30 | Un lease identifica al dueño temporal |
| 8 | 06:30 | 1:15 | Una caída deja una pregunta pendiente |
| 9 | 07:45 | 1:30 | El loop decide, actúa y vuelve a observar |
| 10 | 09:15 | 1:00 | Cargar capacidades cuando hacen falta |
| 11 | 10:15 | 1:30 | Jev decide qué necesita cada paso |
| 12 | 11:45 | 1:30 | El oráculo hace visibles las decisiones |
| 13 | 13:15 | 1:15 | Delegar también exige un contrato |
| 14 | 14:30 | 1:15 | La evidencia acompaña al resultado |
| 15 | 15:45 | 1:30 | HiveDB conserva el estado del sistema |
| 16 | 17:15 | 1:15 | Un motor, varias formas de consultar |
| 17 | 18:30 | 1:15 | Una versión protege la transición del job |
| 18 | 19:45 | 1:00 | Observar causas, además de mensajes |
| 19 | 20:45 | 2:30 | Una tarea, varias entregas verificables |
| 20 | 23:15 | 0:45 | Qué debemos seguir midiendo y cuidando |
| 21 | 24:00 | 0:45 | Tres prácticas para llevar a tu plataforma |
| 22 | 24:45 | 1:00 | Hive: app de escritorio o instalación con Bun |
| 23 | 25:45 | 1:00 | Construir tu aplicación con Hive SDK |
| 24 | 26:45 | 0:15 | Código y documentación para continuar |
| 25 | 27:00 | 3:00 | Gracias · Preguntas |

## 1. Por dentro de un enjambre

Abrir con una pregunta: ¿qué pasa cuando un agente dice “listo”, pero el proceso se cayó antes de confirmar el resultado? La charla muestra cómo Hive conecta ejecución, recuperación y evidencia. No presentar cifras de rendimiento ni resultados de demo sin haberlos medido.

Fuentes: Título del programa del evento; plantilla del organizador.

## 2. John Alexander Páez Arias

Presentarme desde el proyecto: trabajo en Hive, un runtime de agentes local-first. Completar oralmente mi experiencia personal sin añadir cargos o credenciales no confirmados. Explicar que hoy vamos a abrir el runtime, no recorrer todas las funciones de la interfaz.

Fuentes: README.md.

## 3. Responder es solo una parte del trabajo

Plantear un caso hipotético: “analiza este archivo y genera un reporte”. El modelo puede emitir una respuesta válida sin que el archivo exista o esté correcto. La dificultad operativa aparece con fallos, contexto incompleto y efectos externos. Estas son motivaciones de diseño, no resultados históricos medidos.

Fuentes: docs/architecture/runtime.md.

## 4. Tres piezas para operar un enjambre

Dar el mapa mental: harness es el marco operativo; loop es el ciclo de decisión y acción; datos conservan estado, capacidades y evidencia. La demo unirá las tres piezas. Evitar presentar “enjambre” como una topología distribuida con garantías no implementadas.

Fuentes: docs/architecture/overview.md.

## 5. La arquitectura, de extremo a extremo

Leer de izquierda a derecha: canal, gateway y coordinador. El coordinador descubre capacidades y delega en especialistas. Los especialistas usan herramientas nativas o MCP. El harness organiza la ejecución y HiveDB conserva estado y evidencia. Las flechas son relaciones lógicas simplificadas; no implican que cada escritura pase por una transacción común.

Fuentes: docs/architecture/overview.md.

## 6. El harness convierte intención en ejecución

Definir harness como los mecanismos que rodean la llamada al modelo. Distinguir Job: unidad programada en una cola; Run: ciclo de un agente con su checkpoint. La conversación define una lane para ordenar turnos. Los presupuestos de iteraciones, tokens y turnos dependen del tipo de ejecución y configuración.

Fuentes: packages/core/src/gateway/job-store.ts; packages/core/src/agent/run-store.ts.

## 7. Un lease identifica al dueño temporal

Explicar lease como un permiso temporal de propiedad del trabajo. claimJob usa expectedVersion para ganar una transición pending→running; boot_id identifica al proceso propietario. La renovación mantiene el lease. Si el gateway cae, el arranque recupera trabajos según estado, lease y política. La cola ordena los turnos del mismo lane. Eso no garantiza exactamente una ejecución de cada efecto externo.

Fuentes: packages/core/src/gateway/job-store.ts; docs/architecture/runtime.md.

## 8. Una caída deja una pregunta pendiente

Recorrer la ventana crítica: el checkpoint se guarda antes de la llamada a la herramienta; el efecto puede haber ocurrido antes de que se guarde el resultado. En resume, agent-loop inyecta un resultado sintético [interrupted] para las llamadas pendientes. No reproduce automáticamente esa llamada en ese bloque de recuperación: el modelo decide si reintenta o continúa. Para efectos externos se requiere readback, idempotencia o política explícita; no prometer exactly-once.

Fuentes: packages/core/src/agent/agent-loop.ts.

## 9. El loop decide, actúa y vuelve a observar

Narrar una iteración: construir contexto, invocar proveedor, interpretar texto y llamadas, ejecutar herramientas, agregar resultados al siguiente paso. Para runs durables hay checkpoints antes y después de herramientas. Las herramientas independientes pueden paralelizarse según el runtime y sus políticas. Se termina al responder, delegar, agotar límites, abortar o fallar. Existen detección de loops y falta de progreso.

Fuentes: packages/core/src/agent/agent-loop.ts; docs/architecture/runtime.md.

## 10. Cargar capacidades cuando hacen falta

Explicar el costo de cargar el catálogo completo: ruido y espacio ocupado en el contexto. Hive arranca con herramientas esenciales y search_knowledge consulta el catálogo de tools, skills, MCP y reglas. capability-search usa queryHybrid. No fijar el número de herramientas esenciales: hay diferencias entre README y docs/runtime. Introducir las siguientes dos láminas: Jev asesora esa selección y las decisiones del loop.

Fuentes: packages/core/src/agent/capability-search.ts; docs/architecture/runtime.md.

## 11. Jev decide qué necesita cada paso

Definir Jev como plano de decisión opcional sobre OpenRouter Decisions. Responde preguntas cerradas con probabilidades y opciones; el modelo de texto del agente redacta y ejecuta. Tres puntos: planJevContext selecciona historial, herramientas, skills, notas y reglas y recomienda especialista; planJevIteration poda resultados viejos y orienta continue/delegate/discover/finish; jevWantsParallel decide solo sobre lotes candidatos previamente seguros. El último resultado, el contexto reciente y herramientas esenciales tienen protecciones del runtime. Sin clave o ante fallo se conserva el flujo clásico. Timeout: tres segundos por decisión; cooldown: sesenta segundos después de tres fallos consecutivos. Los extractos de contexto viajan a OpenRouter; no describir Jev como inferencia local. En resume se omite Jev.

Fuentes: docs/internals/jev.md; packages/core/src/agent/jev-planner.ts.

## 12. El oráculo hace visibles las decisiones

El esquema de esta lámina representa el componente JevOracle; no es una captura de una decisión real. En Office3D el cristal violeta flota sobre el coordinador y un rayo señala al agente asesorado por cada nueva decisión. El chip muestra tipo de decisión, tokens estimados y latencia. JevPanel enseña estado, última decisión, costo y aporte por agente; el dashboard ofrece rollups. El ahorro de tokens es una estimación contra el contexto clásico (caracteres divididos por cuatro), y puede resultar negativo; no afirmar una reducción medida ni ahorro neto garantizado. Un estado fallback se muestra con otro color y el runtime sigue por la vía clásica. En la demo mostrar el oráculo solo si Jev está activo y se generan decisiones nuevas.

Fuentes: docs/internals/jev.md; packages/hive-ui/src/modules/office3d/scene/JevOracle.tsx.

## 13. Delegar también exige un contrato

El coordinador elige un agente de catálogo; el runtime fija objetivo, aceptación, herramientas, skills, workspace, recursos, proveedor y IDs. Delegaciones hermanas pueden agruparse. El gateway continúa los jobs y un turno de fan-in evalúa entregas. task_revise devuelve feedback al mismo worker. Explicar que especializar también reduce herramientas y recursos disponibles.

Fuentes: docs/architecture/runtime.md; packages/core/src/agent/delegation-runtime.ts.

## 14. La evidencia acompaña al resultado

Describir proof packet como un paquete de evidencia, no una prueba formal de corrección. Incluye intención, criterios, checks ejecutados, evidencia y límites conocidos. buildProofPacket rechaza marcar éxito sin al menos un check y evidencia no vacía. Eso valida estructura mínima, no la verdad universal del resultado. Los criterios con checkTool tienen verificación determinista; los otros requieren juicio del coordinador.

Fuentes: packages/core/src/agent/proof-packet.ts; docs/architecture/runtime.md.

## 15. HiveDB conserva el estado del sistema

Presentar HiveDB como motor embebido en Rust expuesto por N-API a Bun/Node. En Hive es la única base persistente. Conserva configuración, agentes, conversación, runs, jobs y evidencia en documentos y eventos; los binarios de artefactos viven en filesystem y sus metadatos en HiveDB. La ruta deriva de HIVE_HOME. No prometer que todos los documentos de Hive se reconstruyen del event log.

Fuentes: packages/core/src/storage/hivedb.ts; docs/architecture/overview.md.

## 16. Un motor, varias formas de consultar

Distinguir capas: redb para documentos y event log; tantivy para búsqueda lexical BM25; HNSW para búsqueda vectorial aproximada; RRF para combinar rankings. La API queryHybrid no implica que cada instalación tenga vectores: en el accessor de Hive se usa HiveDB.open sin configuración explícita de embedder. Las capacidades vectoriales necesitan configuración o vectores. No usar benchmarks del README como mediciones de la charla.

Fuentes: node_modules/@johpaz/hive-db/README.md; packages/core/src/storage/hivedb.ts.

## 17. Una versión protege la transición del job

Mostrar el extracto real de claimJob. Dos competidores pueden leer la misma versión; expectedVersion permite que solo uno gane la escritura para ese job. El otro vuelve a leer o sale. La protección es por documento y transición; no es una transacción distribuida ni asegura exactly-once de llamadas externas. El fragmento se recortó para enfocarse en las líneas decisivas.

Fuentes: packages/core/src/gateway/job-store.ts · extracto de claimJob.

## 18. Observar causas, además de mensajes

Separar memoria de conversación y registro de ejecución. Los IDs permiten asociar turno, run, tarea, agente y artefactos. El log causal conserva intención, cambios de estado y llamadas. Las suscripciones de HiveDB son en proceso y solo entregan eventos nuevos; no hacen replay histórico automáticamente. Usar causalThread/read para histórico cuando se necesite. Office3D es una superficie de actividad, no una prueba suficiente de éxito.

Fuentes: packages/core/src/storage/causal-events.ts; docs/architecture/runtime.md.

## 19. Una tarea, varias entregas verificables

Demo sugerida, NO ejecutada durante la preparación. Preparar un CSV sintético de 5 servicios con estado y latencia (ver servicios-demo.csv). Pedir: “Lee servicios-demo.csv. Genera reporte-devops.md con la tabla completa, los servicios degradados, el criterio de degradación y recomendaciones. Verifica leyendo el archivo final. No inventes datos.” Mostrar descubrimiento/delegación si ocurre, ejecución, artefacto y readback. El resultado esperado es un reporte que conserve las 5 filas y marque pagos y notificaciones como degradados por estado != ok o latencia > 500 ms. No forzar una topología de agentes: el coordinador puede resolver directamente. Tener un reporte de respaldo preparado y claramente identificado. La captura de la slide es ilustrativa de la interfaz, no evidencia de esta demo. Evitar reiniciar el gateway en vivo en estos tres minutos; usar el diagrama de recuperación para explicar esa parte.

Fuentes: docs/assets/office3d-screenshot.jpg · captura ilustrativa; caso de demo propuesto.

## 20. Qué debemos seguir midiendo y cuidando

Exponer límites como decisiones de ingeniería. Un proveedor local o remoto afecta latencia, calidad y disponibilidad. Los reintentos necesitan idempotencia y políticas ante efectos externos. La recuperación depende de checkpoints y política de resume; no todo turno corto de chat comienza durable. HiveDB embebido se abre de forma exclusiva: evitar procesos separados accediendo al mismo directorio. Para producción probar recuperación, backup/restore y retención. No afirmar HA horizontal ni garantías que el código no ofrece.

Fuentes: docs/architecture/runtime.md; packages/core/src/storage/causal-events.ts.

## 21. Tres prácticas para llevar a tu plataforma

Cerrar con tres acciones aplicables aunque no usen Hive: definir aceptación antes de ejecutar; conservar checkpoints y resolver incertidumbre de efectos; entregar evidencia enlazada al resultado. El punto central es operar el ciclo completo, no confiar en una frase del modelo.

Fuentes: Síntesis de la charla.

## 22. Hive: app de escritorio o instalación con Bun

Presentar dos rutas con la misma importancia. App de escritorio: descargar el instalador de Windows, macOS o Linux desde https://github.com/johpaz/hive/releases/latest; instalar y abrir la app, que trae el gateway embebido. No requiere instalar Bun, Docker ni Git. Configurar proveedor y modelo en el asistente. Para terminal: Bun >= 1.4.2 según package.json; instalar Hive 1.1.0, hive start y hive doctor. El gateway usa 127.0.0.1:18790 por defecto. Instaladores documentados: Windows .exe o .msi; macOS .dmg; Linux .deb, .rpm o Flatpak. La instalación no se ejecutó durante la preparación. Versiones verificadas el 8 de octubre de 2026 mediante bun pm view.

Fuentes: docs/guides/instalacion.md; package.json; github.com/johpaz/hive/releases/latest.

## 23. Construir tu aplicación con Hive SDK

Elegir el SDK para integrar el harness en una app propia con herramientas, agentes e interfaz de negocio. La vía rápida usa hives create-app, comprobada en el CLI y README del SDK local. Instalar el CLI global, crear proyecto, instalar dependencias, copiar .env.example y configurar allí el proveedor antes de ejecutar bun run dev. Si ya existe una app Bun, usar bun add @johpaz/hive-sdk@0.7.2 e importar createAgent/defineTool según README. El SDK publicado es TypeScript y usa APIs de Bun: no anunciar compatibilidad directa con Node. Bun >= 1.4.2. Los comandos se verificaron en documentación y código, no se instalaron ni ejecutaron durante la preparación. Versión 0.7.2 verificada en npm el 8 de octubre de 2026.

Fuentes: hive-sdk/README.md; hive-sdk/package.json; npm @johpaz/hive-sdk.

## 24. Código y documentación para continuar

Mostrar repositorios de Hive, Hive SDK y HiveDB y la documentación de Jev. Las URLs se tomaron de los repositorios locales; no se inventó un enlace público a esta presentación. Compartir los slides después de decidir dónde publicarlos.

Fuentes: README.md; hive-sdk/README.md; docs/internals/jev.md.

## 25. Gracias · Preguntas

Reservar tres minutos para preguntas. Preguntas probables: qué garantiza un checkpoint, qué significa un lease, qué se verifica sin LLM y cómo se usa el motor embebido. Responder con el alcance real: recuperar estado no equivale a confirmar un efecto externo; proof packet no sustituye un check; HiveDB requiere respetar propiedad del directorio.

Fuentes: Cierre de la charla.

## Ensayo de la demo

1. Copiar `servicios-demo.csv` al workspace autorizado de Hive.
2. Enviar el prompt de la lámina 19.
3. Abrir el reporte y verificar las cinco filas, el umbral y los dos servicios degradados.
4. Comprobar qué herramientas y agentes se usaron; no prometer una delegación que no ocurra.
5. Si Jev está activo, mostrar el cristal y el panel de decisiones de Office3D. Comparar costo, latencia y tokens estimados sin anunciar ahorro neto garantizado.
6. Preparar una grabación o reporte de respaldo, identificado como tal, si la red o el modelo fallan.

## Instalación y versiones

Comandos de las láminas 22 y 23 contrastados con README, package.json y CLI de los repositorios locales. Versiones npm consultadas mediante `bun pm view` el 8 de octubre de 2026: [Hive 1.1.0](https://www.npmjs.com/package/@johpaz/hive-agents), [Hive SDK 0.7.2](https://www.npmjs.com/package/@johpaz/hive-sdk). No se instalaron paquetes ni se ejecutó la demo durante la preparación.

## Decisiones editoriales

- Se conservaron la portada seleccionada, logo, paleta y pie del evento.
- No se añadieron cargos, métricas, benchmarks ni enlaces públicos a slides sin confirmación.
- Jev es opcional y remoto por OpenRouter; el flujo clásico continúa ante un fallo.
- El cristal de Jev se dibujó como esquema editable, no como captura de una ejecución real.
- `queryHybrid` es una API: los vectores y el embedder son capacidades que requieren configuración.
- `expectedVersion` protege una escritura por documento; no implica transacción distribuida.
- Reanudación de una llamada interrumpida: resultado desconocido, no replay automático garantizado.
