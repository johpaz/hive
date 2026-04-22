# ¿Por Qué Hive?

## Tu colmena de agentes IA. Local-first. Multi-canal. Open source. Construido desde Colombia para el mundo.

---

## La respuesta corta

Porque Hive no es un chatbot más. Es un enjambre completo de agentes inteligentes que trabajan en equipo, aprenden solos, viven en tu computador y te escuchan por Telegram, Discord, WhatsApp, Slack o la web — todo al mismo tiempo.

---

## Ventajas de la infraestructura

### 1. Corre donde quieras, incluso en lo más pequeño

Hive no exige servidores potentes ni computadoras caras. Funciona en una Raspberry Pi Zero 2W con solo 512 MB de memoria. También corre en tu laptop, en un servidor en la nube, o desde una memoria USB que llevas en el bolsillo. No necesitas instalar bases de datos externas, ni servidores adicionales, ni configuraciones complicadas. Una sola carpeta, un solo comando, y ya está funcionando.

### 2. Tus datos se quedan contigo

Todo —conversaciones, memoria, configuración, historial— vive en un solo archivo que está en tu computador. Nada se envía a servidores de Hive. Las únicas conexiones externas son las llamadas a los proveedores de IA que tú mismo configuras. Tus llaves de acceso se guardan cifradas de forma militar (AES-256). Si prefieres cero conexión a internet, puedes usar modelos locales con Ollama y Hive funciona completamente sin red.

### 3. Se aprende solo

Hive tiene un motor llamado ACE (Adaptive Context Engine) que observa cada cosa que hace, detecta patrones y automáticamente escribe reglas para mejorar la próxima vez. No necesitas programar nada ni ajustar configuraciones. El sistema se vuelve más inteligente con el uso, solo, sin intervención humana.

### 4. Muchos agentes, un solo cerebro coordinador

No es un solo asistente genérico. Hive despliega un enjambre: cada agente tiene su especialidad, sus herramientas y su contexto aislado. Un coordinador central distribuye las tareas, los trabajadores especializados las ejecutan en paralelo cuando es posible, y se comunican entre ellos por un bus interno de mensajes. Es como tener un equipo de expertos en lugar de un solo empleado que sabe de todo un poco.

### 5. Multicanal desde el primer día

El mismo agente te responde por Telegram, Discord, WhatsApp, Slack y una interfaz web integrada. No creas bots separados para cada plataforma. Uno solo, presente en todos lados.

### 6. Más de 100 herramientas listas para usar

Hive trae consigo más de 100 herramientas nativas: navegar internet de forma automatizada, resolver captchas, leer y escribir documentos de Office (PDF, Word, Excel, PowerPoint), buscar en la web, ejecutar comandos, manejar calendarios y tareas programadas, procesar voz y texto, generar gráficos y tableros visuales, y mucho más. No necesitas instalar complementos para lo básico — ya está incluido.

### 7. Navegador real que resuelve captchas solo

Hive incluye un navegador visible que puedes ver operando en tiempo real. Navega, hace clic, llena formularios, toma capturas de pantalla y resuelve captchas de forma automática usando visión artificial. No necesitas servicios externos costosos de resolución de captchas.

### 8. Ética integrada, no un parche posterior

Cada agente arranca con un bloque de ética como la primera instrucción que recibe. El agente sabe qué puede y qué no puede hacer, y esos límites no se pueden saltar con un prompt ingenioso. Es una constitución, no una sugerencia.

### 9. Se extiende sin límites

Si las 100+ herramientas nativas no son suficientes, Hive soporta el Protocolo de Contexto de Modelos (MCP) para conectar servicios externos: bases de datos, APIs, motores de búsqueda, lo que necesites. También puedes crear habilidades (skills) en formato Markdown que guían el comportamiento del agente sin escribir una sola línea de código. Y si necesitas delegar tareas de programación, Hive puentea con agentes externos como Claude Code, Gemini CLI o OpenCode.

### 10. Un solo archivo es toda tu información

Toda la base de conocimiento, historial, memoria, reglas aprendidas y configuración vive en un solo archivo SQLite. Quieres hacer respaldo? Copia el archivo. Quieres migrar? Copia el archivo. Quieres llevar tu agente completo en una USB? Copia el archivo. No hay undocumented dependencies ni services intricados que reprovisionar.

### 11. TOON: el formato que ahorra ~40% de tokens por mensaje

Hive no envía datos al modelo de IA en formato JSON como todo el mundo. Usa TOON (Token-Oriented Object Notation), un formato de serialización compacto que convierte `{"nombre": "Juan", "edad": 30}` en algo mucho más breve: `nombre: Juan\nedad: 30`. Cada resultado de herramienta, cada respuesta de MCP, cada bloque de contexto que viaja hacia el modelo pasa por TOON. Hive además calcula cuántos tokens y cuántos dólares te ahorra cada compresión y lo registra para que lo veas en el dashboard. En un uso sostenido, ese 40% de ahorro por objeto se traduce en facturas significativamente más bajas del proveedor de IA.

### 12. Context Compiler: solo lo que importa, cuando importa

Antes de cada turno, el Context Compiler decide exactamente qué ve el modelo. No le vuelca toda la conversación y todas las herramientas. Aplica cuatro estrategias inteligentes:

- **ESCRIBIR**: Las notas importantes se guardan en un bloc persistente que se inyecta fresco cada turno, sin repetir toda la conversación.
- **SELECCIONAR**: Solo 4 herramientas base se cargan siempre. Las demás se descubren dinámicamente cuando el agente las necesita vía `search_knowledge`. Lo mismo con las habilidades: 3 mínimas siempre presentes, hasta 4 adicionales solo si son relevantes para el mensaje actual. Y del playbook de reglas aprendidas, máximo 5 por turno.
- **COMPRIMIR**: Si la conversación supera los 6.000 tokens, los mensajes antiguos se resumen en un bloque compacto en vez de arrastrarlos completos.
- **AISLAR**: Los agentes trabajadores reciben solo el contexto de su tarea específica y 4 herramientas. Nada de basura del coordinador.

El resultado: cada llamada al modelo de IA lleva el mínimo indispensable de tokens. Ni más, ni menos. Tu bolsillo lo nota.

### 13. Búsqueda inteligente con FTS5: no pagas por lo que no usas

Hive tiene más de 100 herramientas, 30+ habilidades y un playbook que crece con el uso. Si inyectara todo eso en cada llamada, gastarías miles de tokens en descripciones de herramientas que el agente no necesita en ese momento. En vez de eso, Hive usa FTS5 (búsqueda de texto completo de SQLite) con ranking bm25 para encontrar exactamente lo relevante:

- **Herramientas**: De más de 100 disponibles, solo se inyectan las que tienen relación semántica con tu mensaje, ponderando más el nombre exacto y la descripción. El resto ni se menciona.
- **Habilidades**: De 30+ skills, máximo 4 por turno, seleccionadas por relevancia y disparadores explícitos.
- **Playbook**: De cientos de reglas aprendidas, máximo 5 por turno, las más relevantes al tema de la conversación.
- **Herramientas MCP**: Las que conectes desde servidores externos también se indexan y se descubren por búsqueda, no se inyectan todas a ciegas.

Todo esto se sincroniza al arrancar y se actualiza automáticamente cuando agregas o quitas componentes. El agente descubre lo que necesita cuando lo necesita — no pagas tokens por herramientas que están dormidas.

### 14. Documentos de Office como ciudadano de primera clase

No necesitas convertir tus archivos para que el agente los entienda. Hive lee y escribe PDF, Word, Excel y PowerPoint de forma nativa. Puedes pedirle que genere un informe en Word, que analice una hoja de cálculo o que cree una presentación completa, todo sin herramientas externas.

### 15. Voz: habla y escucha

Hive transcribe audio a texto y convierte texto a voz. Puedes enviarle notas de voz por cualquier canal y él las procesa, o pedirle que te responda hablando. No es solo texto — es comunicación multimodal.

### 16. Tareas programadas: no necesitas estar presente

Crea tareas que se ejecuten cada hora, cada día, cada semana o cuando tú definas. Hive las corre automaticamente, te notifica cuando terminan, y guarda el historial de cada ejecución. Es como tener un asistente que trabaja mientras duermes.

### 17. HiveLearn: educación adaptativa con 16 agentes

Hive incluye un sistema educativo donde 16 agentes especializados trabajan en paralelo para generar lecciones personalizadas según tu edad, nivel y estilo de aprendizaje. Incluye gamificación con puntos, rachas y logros, monitoreo de atención por cámara web, y contenido interactivo con diagramas, ejercicios y evaluaciones. Funciona incluso con modelos locales via Ollama.

### 18. Código transparente, sin cajas negras

Más de 50.000 líneas de TypeScript escrito desde cero. Sin dependencias de frameworks de agentes externos. Sin capas de abstracción que ocultan lo que realmente pasa. Cada llamada a cada proveedor de IA es directa y visible. Si algo falla, puedes ver exactamente dónde y por qué.

### 19. Despliegue en segundos

Tres opciones, todas simples:
- **Docker**: Una imagen de 120 MB, un comando y listo.
- **Binario**: Un archivo de 50 MB que descargas y ejecutas, sin安装ar nada más.
- **npm**: Un paquete de 12 MB que instalas globalmente con un solo comando.

En todas arranca un asistente de 4 pasos que te guía para configurar proveedor, agente, ética y canales. Sin archivos YAML manuales, sin drafting configs.

### 20. Interfaz visual de administración

Hive incluye un dashboard web donde gestionas agentes, herramientas, habilidades, canales, memoria, historial y proveedores de IA sin tocar la terminal. Pero si prefieres la terminal, todo también funciona por CLI.

---

## En resumen

| Necesitas | Hive lo hace |
|---|---|
| Ahorro de tokens | TOON (~40%), Context Compiler, FTS5 selectivo |
| Privacidad | Todo local, cifrado, sin telemetría |
| Portabilidad | Un archivo, una USB, wherever |
| Simplicidad | Un comando, un asistente, listo |
| Inteligencia | Se aprende solo con cada uso |
| Potencia | Enjambre de agentes especializados |
| Presencia | Telegram, Discord, WhatsApp, Slack, Web |
| Herramientas | 100+ nativas, más MCP ilimitado |
| Recursos | Funciona en una Raspberry Pi |
| Gobierno | Ética constitucional integrada |
| Transparencia | Código visible, sin frameworks ocultos |

---

**Hive no es un asistente. Es una colmena. Y la colmena siempre es más inteligente que la abeja sola.**