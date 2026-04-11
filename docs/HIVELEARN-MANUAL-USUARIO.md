# Manual de Usuario: HiveLearn

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [¿Qué es HiveLearn?](#qué-es-hivelearn)
3. [Primeros Pasos](#primeros-pasos)
4. [Flujo de Aprendizaje](#flujo-de-aprendizaje)
5. [Interfaz de Usuario](#interfaz-de-usuario)
6. [Sistema de Gamificación](#sistema-de-gamificación)
7. [Monitor de Atención](#monitor-de-atención)
8. [Historial de Sesiones](#historial-de-sesiones)
9. [Configuración](#configuración)
10. [Preguntas Frecuentes](#preguntas-frecuentes)

---

## Introducción

Bienvenido al manual de usuario de **HiveLearn**, el sistema de aprendizaje adaptativo impulsado por inteligencia artificial del ecosistema Hive. Este documento le guiará a través de todas las funcionalidades disponibles para aprovechar al máximo su experiencia de aprendizaje.

---

## ¿Qué es HiveLearn?

HiveLearn es un módulo de aprendizaje adaptativo que genera lecciones personalizadas utilizando un **enjambre de 16 agentes de IA especializados** que trabajan en paralelo. El sistema está diseñado para:

- **Adaptarse a tu perfil**: Ajusta el contenido según tu edad, nivel educativo y estilo de aprendizaje
- **Generar contenido personalizado**: Crea explicaciones, ejercicios, cuestionarios, diagramas y código según tus necesidades
- **Monitorizar tu atención**: Utiliza la webcam para analizar tu nivel de concentración durante la lección
- **Gamificar el aprendizaje**: Sistema de puntos XP, vidas, rachas y logros
- **Evaluar tu progreso**: Exámenes finales y micro-cuestionarios para medir tu comprensión

### Características Principales

- **16 agentes de IA** trabajando en paralelo para generar contenido educativo
- **Aprendizaje adaptativo**: Las lecciones se ajustan dinámicamente según tu desempeño
- **Interfaz interactiva**: Visualización de grafos con React Flow para navegar entre nodos de contenido
- **Monitor de atención**: Análisis de concentración mediante webcam
- **Sistema de gamificación**: XP, vidas, rachas y logros
- **Cache inteligente**: Reutiliza contenido generado previamente para mayor velocidad

---

## Primeros Pasos

### Requisitos Previos

1. **Servidor Hive en ejecución**: Asegúrate de que el servidor principal de Hive esté activo
2. **Ollama configurado**: HiveLearn utiliza el modelo **Gemma 4** servido localmente a través de Ollama
3. **Navegador web moderno**: Chrome, Firefox, Edge o Safari actualizados
4. **Webcam (opcional)**: Para habilitar el monitor de atención

### Acceso a HiveLearn

1. Abre tu navegador web y navega a la interfaz de Hive
2. En el menú principal, selecciona **HiveLearn**
3. Serás redirigido al panel de configuración de HiveLearn

### Configuración Inicial

Al acceder a HiveLearn por primera vez:

1. **Selecciona el Proveedor de IA**: Elige el modelo de lenguaje que deseas utilizar
2. **Configura el modelo**: Se recomienda `gemma4:2b` para mayor velocidad
3. **Verifica la conexión**: El sistema comprobará que Ollama esté disponible

---

## Flujo de Aprendizaje

HiveLearn sigue un flujo estructurado en **7 pasos** para generar lecciones personalizadas:

### Paso 1: Selección de Proveedor

**Pantalla**: `Provider Select`

En esta pantalla inicial:
- Selecciona el proveedor de IA disponible
- Elige el modelo específico (ej. `gemma4:2b`)
- Verifica que la conexión esté activa

**Acción**: Haz clic en **"Continuar"** una vez configurado.

### Paso 2: Creación del Perfil del Estudiante

**Pantalla**: `Profile`

El sistema recopila información para adaptar la lección:

**Campos del formulario**:

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| **Edad** | Tu edad actual | 25 |
| **Nivel educativo** | Nivel de conocimientos | Principiante, Intermedio, Avanzado |
| **Estilo de aprendizaje** | Cómo prefieres aprender | Visual, Auditivo, Kinestésico |
| **Duración de sesión** | Tiempo deseado | 15, 30, 45 minutos |

**Adaptaciones automáticas**:
- **Niños (5-12 años)**: 5 nodos de contenido, tono amigable y motivador
- **Adolescentes (13-17 años)**: 8 nodos, tono equilibrado
- **Adultos (18+ años)**: 10 nodos, tono técnico y detallado

**Acción**: Completa el formulario y haz clic en **"Siguiente"**.

### Paso 3: Definición del Objetivo de Aprendizaje

**Pantalla**: `Goal`

Ingresa qué deseas aprender:

**Ejemplos de objetivos**:
- "Aprender los fundamentos de Python"
- "Entender el sistema solar y los planetas"
- "Comprender las ecuaciones cuadráticas"
- "Aprender sobre la Revolución Francesa"

**Consejo**: Sé lo más específico posible para obtener mejores resultados.

**Acción**: Escribe tu objetivo y haz clic en **"Generar Lección"**.

### Paso 4: Generación de la Lección (Enjambre de IA)

**Pantalla**: `Loading`

Mientras el enjambre de agentes trabaja, verás:

- **Barra de progreso**: Muestra el avance general de la generación
- **Estado de agentes**: Cada uno de los 16 agentes muestra su estado en tiempo real:
  - ⏳ **Pendiente**: Esperando su turno
  - 🔄 **Ejecutando**: Trabajando en su tarea
  - ✅ **Completado**: Finalizó exitosamente
  - ❌ **Fallido**: Error en la ejecución (se reintenta automáticamente)

**Fases de generación**:

1. **Tier 0 (Secuencial)**: 
   - `ProfileAgent`: Crea tu perfil de adaptación
   - `IntentAgent`: Extrae el tema y objetivos
   - `StructureAgent`: Diseña la estructura curricular

2. **Tier 1 (Paralelo)**: Se ejecutan simultáneamente para cada nodo:
   - `ContentAgent`: Genera contenido educativo
   - `VisualAgent`: Crea diagramas, imágenes y animaciones

3. **Tier 2 (Paralelo)**:
   - `GamificationAgent`: Asigna XP y logros
   - `EvaluationAgent`: Prepara el examen final

4. **Post-procesamiento**:
   - `CoordinatorAgent`: Revisa la coherencia pedagógica

**Tiempo estimado**: 2-5 minutos dependiendo de la complejidad.

### Paso 5: Canvas Interactivo

**Pantalla**: `Canvas`

Una vez generada la lección, se muestra un **grafo interactivo** con nodos conectados:

#### Navegación del Canvas

- **Zoom**: Usa la rueda del ratón o los botones `+` y `-`
- **Pan**: Arrastra el fondo para moverte
- **Seleccionar nodo**: Haz clic en cualquier nodo para ver su contenido

#### Tipos de Nodos

El sistema genera diversos tipos de contenido visual:

| Tipo de Nodo | Descripción | Icono |
|--------------|-------------|-------|
| **Explicación** | Teoría y conceptos fundamentales | 📖 |
| **Ejercicio** | Práctica guiada paso a paso | ✏️ |
| **Quiz** | Preguntas de verificación | ❓ |
| **Código** | Ejemplos de código ejecutables | 💻 |
| **Diagrama SVG** | Visualizaciones vectoriales | 📊 |
| **Infografía** | Resúmenes visuales | 🎨 |
| **Animación** | Contenido animado interactivo | 🎬 |
| **Gráfico** | Charts y gráficos de datos | 📈 |
| **Imagen** | Imágenes educativas | 🖼️ |
| **Audio** | Narración y explicación auditiva | 🔊 |
| **GIF** | Guías animadas paso a paso | 🎞️ |
| **Reto** | Desafíos integradores | 🏆 |
| **Hito** | Contenido de celebración | ⭐ |

#### Panel Lateral de Contenido

Al hacer clic en un nodo, se abre un panel lateral con:

- **Contenido principal**: Explicación detallada del concepto
- **Elementos visuales**: Imágenes, diagramas o animaciones según el tipo
- **Micro-cuestionario**: En nodos de ejercicio, podrás responder preguntas rápidas
- **Botón de completar**: Marca el nodo como completado

#### Micro-Cuestionarios

Algunos nodos incluyen preguntas de verificación:

1. Lee la pregunta cuidadosamente
2. Selecciona la respuesta correcta entre las opciones
3. Haz clic en **"Enviar"**
4. Recibirás retroalimentación inmediata

**Propósito**: Validar tu comprensión antes de avanzar.

### Paso 6: Evaluación Final

**Pantalla**: `Evaluation`

Al completar todos los nodos, se activa el examen final:

**Características**:
- **5 preguntas** adaptativas basadas en tu desempeño
- **Dificultad ajustada**: Más difícil si tuviste buen desempeño, más fácil si necesitas refuerzo
- **Retroalimentación inmediata**: Cada respuesta muestra explicación

**Navegación**:
- Usa los botones **"Anterior"** y **"Siguiente"** para moverte entre preguntas
- Puedes revisar respuestas antes de enviar
- Haz clic en **"Finalizar Evaluación"** cuando termines

### Paso 7: Resultados y Calificación

**Pantalla**: `Result`

Al finalizar, verás un resumen completo:

#### Métricas Mostradas

| Métrica | Descripción |
|---------|-------------|
| **Puntuación** | Porcentaje de respuestas correctas |
| **XP Ganados** | Puntos de experiencia obtenidos |
| **Logros Desbloqueados** | Insignias y reconocimientos |
| **Racha Actual** | Días consecutivos de aprendizaje |
| **Tiempo Total** | Duración de la sesión |

#### Sistema de Calificación

Puedes calificar la lección con **1 a 5 estrellas**:
- ⭐ **1 estrella**: Contenido deficiente
- ⭐⭐ **2 estrellas**: Contenido mejorable
- ⭐⭐⭐ **3 estrellas**: Buen contenido
- ⭐⭐⭐⭐ **4 estrellas**: Muy buen contenido
- ⭐⭐⭐⭐⭐ **5 estrellas**: Contenido excelente

**Propósito**: Tu calificación ayuda a mejorar futuras lecciones.

#### Acciones Disponibles

- **Ver Historial**: Revisar sesiones anteriores
- **Nueva Lección**: Comenzar un nuevo aprendizaje
- **Repetir Lección**: Volver a generar la misma lección

---

## Interfaz de Usuario

### Componentes Principales

#### 1. HUD de Gamificación

Ubicado en la esquina superior derecha durante la lección:

- **❤️ Vidas**: Indicador de oportunidades restantes
- **⭐ XP**: Puntos de experiencia acumulados
- **🔥 Racha**: Días consecutivos aprendiendo
- **🏆 Logros**: Insignias desbloqueadas

#### 2. Panel de Navegación

Barra lateral izquierda (en pantallas grandes):
- **Minimapa**: Vista reducida del grafo completo
- **Progreso**: Barra de nodos completados
- **Nodo actual**: Indicador de posición

#### 3. Panel de Detalle de Nodo

Se abre al hacer clic en un nodo:
- **Pestaña Contenido**: Explicación principal
- **Pestaña Recursos**: Materiales adicionales
- **Pestaña Progreso**: Tu desempeño en este nodo

### Controles del Canvas

| Acción | Mouse | Teclado |
|--------|-------|---------|
| **Zoom in** | Rueda arriba | `+` |
| **Zoom out** | Rueda abajo | `-` |
| **Mover vista** | Arrastrar fondo | Flechas |
| **Seleccionar nodo** | Clic | `Enter` |
| **Cerrar panel** | Botón ✕ | `Escape` |

### Estados de los Nodos

Los nodos cambian de color según su estado:

- **Gris**: Pendiente (no visitado)
- **Azul**: Actualmente seleccionado
- **Verde**: Completado exitosamente
- **Amarillo**: En progreso
- **Rojo**: Requiere atención (micro-quiz fallido)

---

## Sistema de Gamificación

HiveLearn utiliza elementos de juego para motivar el aprendizaje:

### Puntos de Experiencia (XP)

**Cómo ganar XP**:
- ✅ Completar un nodo: **+50 XP**
- ✅ Responder micro-cuestionario correctamente: **+30 XP**
- ✅ Aprobar evaluación final: **+200 XP**
- ✅ Calificar la lección: **+20 XP**

**Bonus multiplicadores**:
- **Primer nodo del día**: x1.5 XP
- **Racha de 3+ días**: x1.3 XP
- **Sin errores en evaluación**: x1.2 XP

### Sistema de Vidas

- **Vidas iniciales**: 5 ❤️
- **Pierdes una vida** por cada micro-quiz fallido
- **Recuperas una vida** al completar 3 nodos seguidos sin errores
- **Game Over**: Si pierdes todas las vidas, debes reiniciar la lección

### Rachas (Streaks)

- **Definición**: Días consecutivos usando HiveLearn
- **Visualización**: 🔥 seguido del número de días
- **Hitos especiales**:
  - 3 días: **"Principiante Constante"**
  - 7 días: **"Semana Perfecta"**
  - 30 días: **"Maestro Dedicado"**
  - 100 días: **"Leyenda del Aprendizaje"**

### Logros (Achievements)

Insignias que reconocen hitos específicos:

| Logro | Requisito | Icono |
|-------|-----------|-------|
| **Primera Lección** | Completar tu primera sesión | 🎓 |
| **Explorador** | Visitar 10 nodos diferentes | 🧭 |
| **Perfeccionista** | 100% en una evaluación | 💎 |
| **Velocista** | Completar lección en menos de 10 min | ⚡ |
| **Sin Errores** | Lección completa sin perder vidas | 🌟 |
| **Curioso** | Intentar 5 temas diferentes | 🔍 |
| **Maestro** | Completar 50 lecciones | 👑 |

---

## Monitor de Atención

### ¿Qué es?

El **Monitor de Atención** utiliza la webcam de tu dispositivo para analizar tu nivel de concentración durante la lección, empleando análisis de IA multimodal.

### Cómo Activarlo

1. Al iniciar una lección, verás un aviso solicitando acceso a la cámara
2. Haz clic en **"Permitir"** cuando el navegador solicite permiso
3. El monitor comenzará a funcionar automáticamente

### Estados de Atención

El sistema clasifica tu atención en tres niveles:

| Estado | Color | Significado | Acción Recomendada |
|--------|-------|-------------|-------------------|
| **Enfocado** | 🟢 Verde | Alta concentración | Continúa así |
| **Distraído** | 🟡 Amarillo | Atención parcial | Intenta concentrarte |
| **Ausente** | 🔴 Rojo | No estás presente | Regresa a tu lugar |

### Funcionamiento Técnico

- **Frecuencia de captura**: Cada 10 segundos
- **Procesamiento**: Envío de imagen a `/api/hivelearn/vision`
- **Análisis**: Gemma 4 multimodal evalúa la escena
- **Privacidad**: Las imágenes **no se almacenan**, solo se analizan en tiempo real

### Alertas Automáticas

El sistema puede:
- **Pausar la lección** si detecta 3 lecturas consecutivas de "ausente"
- **Sugerir un descanso** si tu atención baja consistentemente
- **Adaptar contenido** para hacerlo más interactivo si detecta distracción

### Desactivar el Monitor

- Haz clic en el **icono de cámara** en el HUD superior
- Selecciona **"Desactivar monitor de atención"**
- La lección continuará sin monitoreo

---

## Historial de Sesiones

### Acceso al Historial

1. Desde el menú principal, selecciona **"Mis Sesiones"**
2. O usa el botón **"Ver Historial"** en la pantalla de resultados

### Lista de Sesiones

Cada entrada muestra:

| Campo | Descripción |
|-------|-------------|
| **Fecha** | Cuándo realizaste la sesión |
| **Tema** | Objetivo de aprendizaje |
| **Duración** | Tiempo total invertido |
| **Puntuación** | Porcentaje obtenido |
| **XP Ganados** | Puntos de experiencia |
| **Nodos** | Cantidad de nodos completados |

### Acciones Disponibles

Para cada sesión puedes:

- **🔍 Ver Detalles**: Información completa de la sesión
- **📊 Ver Respuestas**: Tus respuestas a los cuestionarios
- **🔄 Repetir**: Regenerar la misma lección
- **🗑️ Eliminar**: Borrar la sesión del historial

### Métricas Globales

En la parte superior del historial verás:

- **Total de Sesiones**: Lecciones completadas
- **Promedio de Puntuación**: Rendimiento general
- **XP Totales**: Puntos acumulados históricamente
- **Temas Más Estudiados**: Tus 5 temas principales

---

## Configuración

### Página de Configuración

Accede desde: **Menú → HiveLearn → Configuración**

### Opciones Disponibles

#### Proveedor de IA

Selecciona el backend de inteligencia artificial:

- **Ollama Local** (recomendado): Usa tu instalación local de Ollama
- **API Remota**: Configuración de endpoints externos

#### Modelo

Elige el modelo de generación de contenido:

| Modelo | Velocidad | Calidad | Uso Recomendado |
|--------|-----------|---------|-----------------|
| `gemma4:2b` | ⚡ Rápida | Buena | **Recomendado** |
| `gemma4:8b` | 🐢 Lenta | Excelente | Coordinador |

#### Variables de Entorno Avanzadas

Para administradores del sistema:

| Variable | Valor por Defecto | Descripción |
|----------|-------------------|-------------|
| `HIVELEARN_OLLAMA_URL` | `http://localhost:11434` | URL de Ollama |
| `HIVELEARN_MODEL` | `gemma4:2b` | Modelo principal |
| `HIVELEARN_COORDINATOR_MODEL` | `gemma4:2b` | Modelo del coordinador |
| `HIVELEARN_MAX_CONCURRENT_WORKERS` | `2` | Trabajadores paralelos |
| `HIVELEARN_DEBUG_DAG` | `false` | Logs detallados |

### Gestión de Datos

- **Limpiar Cache**: Elimina contenido cacheado para regenerarlo
- **Exportar Historial**: Descarga tus sesiones en formato JSON
- **Eliminar Todas las Sesiones**: Borra completo del historial

---

## Preguntas Frecuentes

### General

**¿HiveLearn requiere conexión a internet?**
Sí, aunque uses Ollama local, el frontend necesita comunicarse con el servidor Hive.

**¿Puedo usar HiveLearn sin webcam?**
Sí, el monitor de atención es opcional. Todas las funciones están disponibles sin él.

**¿Cuánto tarda en generarse una lección?**
Entre 2-5 minutos, dependiendo de la complejidad del tema y la potencia de tu hardware.

### Rendimiento

**¿Por qué la generación es lenta?**
- Verifica que Ollama esté ejecutándose: `ollama list`
- Asegúrate de tener el modelo descargado: `ollama pull gemma4:2b`
- Revisa los recursos del sistema (RAM y CPU)

**¿Puedo acelerar la generación?**
Sí, aumenta `HIVELEARN_MAX_CONCURRENT_WORKERS` a 4 u 8 si tu hardware lo permite.

### Contenido

**¿El contenido generado es preciso?**
El contenido es generado por IA y revisado por el agente Coordinador. Siempre verifica información crítica con fuentes adicionales.

**¿Puedo guardar las lecciones?**
Sí, las lecciones se almacenan en tu historial y puedes accederlas cuando quieras.

**¿Se puede regenerar una lección?**
Absolutamente. Cada generación puede producir variaciones diferentes del contenido.

### Errores Comunes

**"Error de conexión con Ollama"**
- Asegúrate de que Ollama esté ejecutándose: `ollama serve`
- Verifica la URL en configuración
- Comprueba que el firewall no bloquee el puerto 11434

**"Agente fallido"**
- El sistema reintenta automáticamente hasta 3 veces
- Si persiste, revisa los logs del servidor
- Puede deberse a falta de memoria o modelo no disponible

**"No se genera contenido visual"**
- Algunos agentes visuales requieren configuración adicional
- Verifica que todos los agentes estén registrados en `/api/hivelearn/agents`

### Privacidad

**¿Se almacenan mis imágenes de webcam?**
**No**. Las imágenes se analizan en tiempo real y se descartan inmediatamente.

**¿Qué datos se guardan de mis sesiones?**
- Tu perfil de estudiante (edad, nivel, estilo)
- Estructura de la lección generada
- Tus respuestas a cuestionarios
- Puntuaciones y XP

**¿Puedo eliminar mis datos?**
Sí, desde Configuración → Eliminar Todas las Sesiones, o eliminando sesiones individuales del historial.

### Soporte

**¿Dónde reporto un error?**
- En el repositorio oficial de Hive (GitHub Issues)
- Incluyendo logs del navegador (F12 → Console)
- Descripción detallada del problema

**¿Hay documentación técnica?**
Sí, consulta los archivos en `packages/hivelearn/docs/`:
- `README.md`: Vista general
- `api.md`: Referencia de API
- `ui.md`: Arquitectura del frontend
- `database.md`: Esquema de base de datos
- `pipeline.md`: Detalles del pipeline de agentes

---

## Glosario de Términos

| Término | Definición |
|---------|------------|
| **Agente de IA** | Programa especializado que realiza una tarea específica dentro del enjambre |
| **Enjambre (Swarm)** | Conjunto de 16 agentes trabajando coordinadamente |
| **Nodo** | Unidad individual de contenido dentro de una lección |
| **Canvas** | Vista de grafo interactivo donde se muestran los nodos |
| **DAG** | Grafo Acíclico Dirigido, estructura que organiza el flujo de agentes |
| **A2UI** | Protocolo de renderizado multiplataforma usado por HiveLearn |
| **XP** | Puntos de Experiia, sistema de recompensa del aprendizaje |
| **Racha (Streak)** | Días consecutivos usando la plataforma |
| **Micro-cuestionario** | Pregunta rápida dentro de un nodo para verificar comprensión |
| **Evaluación Final** | Examen de 5 preguntas al completar todos los nodos |

---

## Apéndice: Atajos de Teclado

Durante una lección puedes usar:

| Tecla | Acción |
|-------|--------|
| `N` | Siguiente nodo |
| `P` | Nodo anterior |
| `C` | Centrar vista en el nodo actual |
| `+` / `-` | Zoom in/out |
| `Escape` | Cerrar panel lateral |
| `Enter` | Seleccionar nodo enfocado |
| `H` | Mostrar/ocultar HUD |
| `M` | Activar/desactivar monitor de atención |

---

## Contacto y Recursos

- **Repositorio Oficial**: GitHub del proyecto Hive
- **Documentación Técnica**: `packages/hivelearn/docs/`
- **Guía de Configuración Local**: `docs/LOCAL-LLM-SETUP.md`
- **Contribuciones**: Ver `CONTRIBUTING.md`

---

**Última actualización**: Abril 2026  
**Versión del Manual**: 1.0  
**Versión de HiveLearn**: Compatible con Hive v2.x
