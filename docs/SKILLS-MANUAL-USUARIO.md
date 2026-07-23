# Manual de Usuario: Sistema de Skills en Hive

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [¿Qué son las Skills?](#qué-son-las-skills)
3. [Arquitectura del Sistema de Skills](#arquitectura-del-sistema-de-skills)
4. [Estructura de una Skill](#estructura-de-una-skill)
5. [Tipos de Skills](#tipos-de-skills)
6. [Descubrimiento y Ejecución](#descubrimiento-y-ejecución)
7. [Gestión de Skills](#gestión-de-skills)
8. [Interfaz de Usuario](#interfaz-de-usuario)
9. [Línea de Comandos (CLI)](#línea-de-comandos-cli)
10. [Creación de Skills Personalizadas](#creación-de-skills-personalizadas)
11. [Mejores Prácticas](#mejores-prácticas)
12. [Resolución de Problemas](#resolución-de-problemas)
13. [Preguntas Frecuentes](#preguntas-frecuentes)
14. [Glosario](#glosario)

---

## Introducción

Este manual cubre el sistema de **Skills (Habilidades)** de Hive, que permite guiar al agente de IA en tareas específicas mediante instrucciones estructuradas en formato Markdown. Aprenderás a crear, gestionar y optimizar skills para extender las capacidades del agente.

---

## ¿Qué son las Skills?

Las **Skills (Habilidades)** son **conjuntos de instrucciones en formato Markdown** que se inyectan en el prompt del sistema para guiar al agente de IA en tareas específicas.

A diferencia de las herramientas MCP, las Skills **no son código ejecutable**, sino **guías de comportamiento** que el LLM lee y sigue.

### Características Principales

- **Instrucciones estructuradas**: Formato markdown con YAML frontmatter
- **Activación por triggers**: Patrones de texto que activan la skill automáticamente
- **Búsqueda semántica**: Índice HiveDB (BM25 con español: acentos + stemming) para descubrir skills relevantes
- **Multi-fuente**: Skills empaquetadas, gestionadas por DB, o desde directorios personalizados
- **Workflows definidos**: Pasos secuenciales que el agente debe seguir
- **Asociación con herramientas**: Cada skill puede vincularse a herramientas específicas

### Analogía: Skill vs Herramienta

| Concepto | Skill | Herramienta MCP |
|----------|-------|-----------------|
| **Naturaleza** | Manual de instrucciones | Martillo |
| **Función** | Dice **CÓMO** hacer algo | Permite **HACER** algo |
| **Formato** | Texto (Markdown) | Código ejecutable |
| **Ejecución** | El LLM sigue las instrucciones | Se invoca directamente |

**Ejemplo**:
- **Skill**: "Manual de carpintería" → Le dice al agente cómo construir una mesa
- **Herramienta MCP**: "Martillo" → El agente lo usa directamente para clavar clavos

---

## Arquitectura del Sistema de Skills

### Flujo de Descubrimiento

```
┌─────────────────────────────────────────────────────────┐
│              Mensaje del Usuario                          │
│         "Busca información sobre React 19"               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Skill Selector                               │
│                                                           │
│  Paso 1: ¿Coincide con algún trigger?                    │
│           "Busca" → web-research ✅                       │
│                                                           │
│  Paso 2: Búsqueda HiveDB (si no hay trigger)             │
│           Keywords: ["busca", "información", "React"]    │
│           Score BM25 ponderado                            │
│                                                           │
│  Paso 3: Skills mínimas (siempre activas)                │
│           memory_manager, canvas_report,                  │
│           task_orchestrator                               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│         Inyección en el Prompt del Sistema                │
│                                                           │
│  ## Available Skills                                      │
│  ### web-research                                         │
│  Busca información en la web usando...                   │
│  [primeros 500 caracteres del contenido]                 │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Agente de IA (LLM)                           │
│   Lee instrucciones y decide qué herramientas usar       │
└─────────────────────────────────────────────────────────┘
```

### Componentes del Sistema

| Componente | Ubicación | Función |
|------------|-----------|---------|
| **SkillLoader** | `packages/skills/src/loader.ts` | Carga skills de 4 fuentes con prioridad |
| **Skill Selector** | `packages/core/src/agent/skill-selector.ts` | Descubre skills relevantes por mensaje |
| **Índice HiveDB** | `@johpaz/hive-db` (motor Rust) | Búsqueda semántica con ponderación por campo |
| **Context Compiler** | `packages/core/src/agent/context-compiler.ts` | Inyecta skills en el prompt |

---

## Estructura de una Skill

### Archivo `SKILL.md`

Cada skill se define en un archivo `SKILL.md` con esta estructura:

```markdown
---
name: nombre-de-la-skill
description: Descripción breve de lo que hace esta skill
version: 1.0.0
author: Tu Nombre
icon: 🚀
category: categoría
tools: tool1, tool2, tool3
triggers: trigger1, trigger2, trigger3
permissions: read, write
dependencies: otra-skill
preferred_agents: general-purpose, Explore
---

# Nombre de la Skill

## Descripción
Descripción detallada de la skill...

## Cuándo Usar
- Situación 1
- Situación 2

## Instrucciones

1. **Paso 1**: Descripción del primer paso
2. **Paso 2**: Descripción del segundo paso
3. **Paso 3**: Descripción del tercer paso

## Ejemplos

### Ejemplo 1
**Usuario**: "Texto de ejemplo del usuario"
**Comportamiento esperado**: Lo que debería pasar
```

### Campos del Frontmatter YAML

#### Campos Básicos

| Campo | Tipo | Requerido | Descripción | Ejemplo |
|-------|------|-----------|-------------|---------|
| `name` | string | ✅ | Identificador único (slug) | `web-research` |
| `description` | string | ✅ | Descripción breve | "Busca información en la web" |
| `category` | string | ✅ | Categoría | `web`, `filesystem`, `code` |

#### Campos Opcionales

| Campo | Tipo | Descripción | Ejemplo |
|-------|------|-------------|---------|
| `version` | string | Versión de la skill | `1.0.0` |
| `author` | string | Autor | `@johnpaz` |
| `icon` | string | Emoji/icono | 🌐 |
| `tools` | string | IDs de herramientas (comma-separated) | `search, fetch_url` |
| `triggers` | string | Patrones de activación | `/search, buscar, encontrar` |
| `permissions` | string | Permisos requeridos | `read, write` |
| `dependencies` | string | Skills requeridas | `memory_manager` |
| `preferred_agents` | string | Agentes preferidos | `general-purpose, Explore` |

#### Campos Avanzados

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `steps` | array | Pasos secuenciales del workflow |
| `rules` | array | Reglas de ejecución |
| `output_format` | object | Estructura de salida esperada |
| `examples` | array | Ejemplos de uso |

### Campos Avanzados en Detalle

#### Steps (Pasos Secuenciales)

Define un workflow paso a paso:

```yaml
steps:
  - action: validate
    instruction: "Verifica que el código compila"
    output: build_status
  - action: test
    instruction: "Ejecuta suite de pruebas"
    params:
      test_dir: tests/
    output: test_results
  - action: deploy
    instruction: "Despliega a producción"
    params:
      environment: production
    output: deployment_url
```

#### Rules (Reglas de Ejecución)

Define reglas que el agente debe seguir:

```yaml
rules:
  - "SIEMPRE ejecutar pruebas antes de desplegar"
  - "NUNCA desplegar si hay fallos críticos"
  - "PREGUNTAR al usuario antes de acciones destructivas"
  - "VALIDAR entradas antes de procesar"
```

#### Examples (Ejemplos de Uso)

Proporciona ejemplos para guiar al agente:

```yaml
examples:
  - user_input: "Analiza las ventas del último trimestre"
    expected_behavior: "Carga archivo → Calcula métricas → Genera gráficos → Resume"
  - user_input: "Genera un reporte mensual"
    expected_behavior: "Consulta DB → Genera PDF → Muestra resumen"
```

---

## Tipos de Skills

El sistema carga skills de **4 fuentes** con prioridad ascendente:

### 1. Skills Empaquetadas (Bundled) - Prioridad Más Baja

Skills que vienen con Hive por defecto, ubicadas en `packages/skills/src/bundled/`:

| Categoría | Descripción | Ejemplos de Uso |
|-----------|-------------|-----------------|
| **agents** | Gestión y coordinación de agentes | Task orchest, agent delegation |
| **canvas** | Generación de UI con A2UI | Reportes visuales, dashboards |
| **cli** | Comandos de línea de comandos | Ejecución de scripts |
| **codebridge** | Ejecución de código aislado | Generación y testing de código |
| **cron** | Tareas programadas | Jobs recurrentes, reminders |
| **filesystem** | Operaciones de archivos | Leer, escribir, mover archivos |
| **office** | Documentos de oficina | PDF, Excel, Word |
| **projects** | Gestión de proyectos | Planning, milestones |
| **voice** | Síntesis de voz | Text-to-speech, comandos de voz |
| **web** | Búsqueda y scraping web | Research, web scraping |

> **Nota**: HiveLearn (skills educativas: `gestionar-contenido-educativo`, `busqueda-hivelearn`, `seed-inicial`) se separó a su propio proyecto y ya no forma parte de este repo.

### 2. Skills Gestionadas por Base de Datos - Prioridad Media

Skills creadas por el usuario y almacenadas en la tabla `skills`:

- Se pueden crear/editar desde la UI
- Se buscan mediante HiveDB (BM25) por relevancia
- Se pueden activar/desactivar individualmente

**Tabla `skills`**:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | TEXT | Identificador único (slug) |
| `name` | TEXT | Nombre para mostrar |
| `category` | TEXT | Categoría |
| `tools` | TEXT | IDs de herramientas (comma-separated) |
| `triggers` | TEXT | Patrones de activación |
| `body` | TEXT | Contenido markdown completo |
| `version` | TEXT | Versión |
| `active` | INTEGER | 1=activa, 0=desactivada |

### 3. Skills de Directorio Extra - Prioridad Alta

Skills cargadas desde directorios externos configurables:

- Útiles para desarrollo de nuevas skills
- Se cargan automáticamente al inicio
- Configuradas via variable de entorno `HIVE_SKILLS_EXTRA_DIRS`

**Configuración**:
```bash
export HIVE_SKILLS_EXTRA_DIRS=/home/user/my-skills:/opt/hive-skills
```

### 4. Skills de Workspace - Prioridad Más Alta

Skills en el directorio de trabajo del usuario:

- **Máxima prioridad** en el sistema
- Específicas del proyecto actual
- Sobrescriben skills empaquetadas con mismo nombre

**Uso típico**:
- Skills específicas de un proyecto
- Workflows personalizados
- Integraciones custom

---

## Descubrimiento y Ejecución

El sistema de skills usa un mecanismo de **doble descubrimiento**:

### Paso 1: Coincidencia Explícita por Triggers (Alta Confianza)

Cada skill define `triggers` (patrones de activación). Si el mensaje del usuario contiene un trigger:

```
Mensaje del usuario: "/search cómo funciona React"
                        ↓
Trigger detectado: "/search"
                        ↓
Skill activada: web-research (confianza ALTA)
```

**Ventaja**: Activación inmediata y precisa.

### Paso 2: Búsqueda Semántica HiveDB (Fallback)

Si no hay triggers, se usa el índice HiveDB (`@johpaz/hive-db`):

1. El **mensaje crudo** del usuario va directo al motor — no requiere sanitización
   (comillas, operadores y `¿?` nunca lanzan error)
2. **Análisis en español**: minúsculas, normalización de acentos
   ("transacción" ≈ "transaccion") y stemming ("pagos" ≈ "pago")
3. **Puntuación BM25** ponderada por campo:
   - Nombre: **peso 4.0** (más importante)
   - Tags (triggers + categoría + tools): **peso 3.0**
   - Cuerpo (descripción + contenido): **peso 2.0**
4. **Filtrado relativo**: se conservan las skills con score ≥ 30% del mejor resultado
   (los scores son positivos; mayor = más relevante)
5. **Límite**: Máximo **4 skills** por turno

**Ejemplo**:
```
Mensaje: "necesito crear un PDF con los datos"
                        ↓
Keywords: ["crear", "PDF", "datos"]
                        ↓
Skills encontradas: 
  - office:pdf (score: 12.5)
  - filesystem:export (score: 8.3)
```

### Paso 3: Skills Mínimas (Siempre Cargadas)

Tres skills **nunca se excluyen**, independientemente del mensaje:

| Skill | Herramienta Asociada | Propósito |
|-------|---------------------|-----------|
| `memory_manager` | `save_note` | Gestión de memoria a largo plazo |
| `canvas_report` | `report_progress` | Reportes de progreso en UI |
| `task_orchestrator` | `notify` | Coordinación de agentes |

### Ejemplo de Inyección en el Prompt

Una skill descubierta se inyecta así:

```markdown
## Available Skills

### web-research
Busca información en la web usando herramientas de búsqueda.
Tools: search, fetch_url
Triggers: /search, buscar, encontrar

[Contenido completo de la skill - primeros 500 caracteres...]
```

### Filtrado Conversacional

Los mensajes puramente conversacionales (saludos, agradecimientos) **no activan skills**:

- "Hola", "Buenos días" → Sin skills
- "Gracias", "Perfecto" → Sin skills
- "¿Cómo estás?" → Sin skills

---

## Gestión de Skills

### Activar/Desactivar Skills

**Desde la Interfaz Web**:

1. Localiza la skill en la lista
2. Usa el **toggle** en la esquina de la tarjeta
3. El estado cambia inmediatamente

**Desde la CLI**:

```bash
# Desactivar una skill
hive skills disable web-research

# Activar una skill
hive skills enable code-review
```

⚠️ **Nota**: Las skills del sistema (`memory_manager`, `canvas_report`, `task_orchestrator`) **siempre están activas** y no pueden desactivarse.

### Buscar Skills

#### Búsqueda por Texto

1. Usa la **barra de búsqueda** en el panel
2. Escribe palabras clave
3. Los resultados se ordenan por relevancia (busca en nombre, descripción, triggers y contenido)

**Desde la CLI**:
```bash
# Buscar skills relacionadas con "web"
hive skills search web

# Buscar por categoría
hive skills search --category filesystem
```

### Instalar Skills Adicionales

#### Desde la Interfaz Web

1. Ve a **Skills → Instalar Skill**
2. Elige la fuente:
   - **URL**: Enlace a un archivo SKILL.md remoto
   - **Archivo local**: Drag & drop
   - **Texto pegado**: Copiar y pegar contenido
3. **Validación automática**:
   - Verifica frontmatter YAML
   - Chequea campos requeridos
   - Detecta errores de sintaxis
4. **Vista previa** y edición antes de guardar
5. Haz clic en **Instalar**

#### Desde la CLI

```bash
# Instalar desde archivo
hive skills install ./mi-skill/SKILL.md

# Instalar desde URL
hive skills install https://example.com/skills/mi-skill.md
```

### Actualizar Skills

```bash
# Actualizar skills empaquetadas
hive skills update

# Reconstruir índice FTS5
hive skills rebuild-index
```

---

## Interfaz de Usuario

### Gestor de Skills

**Acceso**: `Menú → Configuración → Skills`

#### Pestañas del Gestor

1. **Lista de Skills**: Todas las skills activas
2. **Crear Skill**: Editor de nueva skill
3. **Instalar Skill**: Importar desde archivo o URL

### Lista de Skills

Cada skill muestra:

| Campo | Visualización |
|-------|---------------|
| **Icono** | Emoji del frontmatter |
| **Nombre** | Nombre de la skill |
| **Categoría** | Badge de color según categoría |
| **Versión** | Número de versión |
| **Herramientas** | Lista de tools asociados |
| **Triggers** | Lista de triggers |
| **Estado** | Activo ✅ / Desactivado ❌ |
| **Acciones** | Editar, Activar/Desactivar, Eliminar |

### Editor de Skills

Formulario completo con:

#### Campos Básicos

- **Nombre** (slug)
- **Descripción**
- **Versión**
- **Categoría** (dropdown)
- **Icono** (emoji picker)

#### Campos Avanzados

- **Tools** (input con autocompletado)
- **Triggers** (input multiple)
- **Preferred agents** (input multiple)

#### Editor de Contenido

- Área de texto grande para el markdown de la skill
- Preview en tiempo real
- Validación de sintaxis

**Botones**:
- **Guardar**: Crea/actualiza skill
- **Vista previa**: Muestra cómo se verá
- **Validar**: Verifica estructura del frontmatter

---

## Línea de Comandos (CLI)

### `hive skills list`

Lista todas las skills:

```
Skills instaladas:

  🌐 web-research            web          v1.0.0   ✅ Activa
  📄 pdf-generator           office       v2.1.0   ✅ Activa
  📁 filesystem              filesystem   v1.5.0   ✅ Activa
  🎨 canvas-ui               canvas       v1.0.0   ❌ Desactivada

Total: 4 skills (3 activas, 1 desactivada)
```

### `hive skills update`

Actualiza las skills empaquetadas en la base de datos:

```
Actualizando skills empaquetadas...

  ✅ Agregada: voice-synthesis
  🔄 Actualizada: web-research (v1.0.0 → v1.1.0)
  ⏭️  Sin cambios: pdf-generator

Skills sincronizadas: 15
```

### `hive skills search <término>`

Busca skills por término (usa FTS5):

```
Búsqueda: "pdf"

  📄 pdf-generator           office
     Genera documentos PDF desde datos
     Triggers: /pdf, generar pdf, crear documento
     Tools: generate_pdf, export_data

  📊 report-builder          office
     Crea reportes con tablas y gráficos
     Triggers: reporte, informe
     Tools: generate_pdf, create_chart
```

### `hive skills show <nombre>`

Muestra detalles de una skill:

```
Skill: web-research

  Nombre:      web-research
  Descripción: Busca información en la web
  Categoría:   web
  Versión:     1.0.0
  Autor:       @johnpaz
  Icono:       🌐
  
  Triggers:    /search, buscar, encontrar
  Tools:       search, fetch_url
  Agents:      general-purpose, Explore
  
  Descripción completa:
  Esta skill permite buscar información en internet...
  [contenido completo]
```

### `hive skills enable/disable <nombre>`

Activa o desactiva una skill:

```bash
hive skills enable mi-skill
✅ Skill 'mi-skill' activada

hive skills disable mi-skill
✅ Skill 'mi-skill' desactivada
```

### `hive skills install <archivo>`

Instala una skill desde un archivo:

```bash
hive skills install ./mi-skill/SKILL.md

✅ Skill 'mi-skill' instalada correctamente
```

---

## Creación de Skills Personalizadas

### Guía Paso a Paso

#### Paso 1: Estructura del Archivo

Crea un directorio para tu skill:

```bash
mkdir mi-skill
cd mi-skill
touch SKILL.md
```

#### Paso 2: Frontmatter

Define los metadatos:

```yaml
---
name: mi-skill-ejemplo
description: Descripción clara de lo que hace esta skill
version: 1.0.0
author: Tu Nombre
icon: 🎯
category: projects
tools: tool1, tool2
triggers: /mi-trigger, palabra clave
preferred_agents: general-purpose
---
```

#### Paso 3: Contenido Markdown

Escribe las instrucciones:

```markdown
# Mi Skill Ejemplo

## Cuándo Usar

Usa esta skill cuando:
- El usuario quiera hacer X
- Se necesite realizar Y

## Instrucciones

1. **Paso 1**: Primero haz esto
   - Sub-paso 1.1
   - Sub-paso 1.2

2. **Paso 2**: Luego haz esto

3. **Paso 3**: Finalmente

## Ejemplos

### Ejemplo 1
**Usuario**: "Quiero hacer algo específico"
**Comportamiento esperado**: Deberías ejecutar el paso 1, 2, 3
```

#### Paso 4: Probar la Skill

**Opción A - Directorio Extra**:
```bash
export HIVE_SKILLS_EXTRA_DIRS=/ruta/a/mi-skill
hive start
```

**Opción B - Interfaz Web**:
1. Ve a Skills → Instalar Skill
2. Arrastra tu archivo `SKILL.md`
3. Revisa la vista previa
4. Haz clic en Instalar

**Opción C - CLI**:
```bash
hive skills install ./mi-skill/SKILL.md
```

### Ejemplo Completo: Skill de Generación de Reportes

```markdown
---
name: reporte-semanal
description: Genera reportes semanales con métricas del proyecto
version: 1.0.0
author: @johnpaz
icon: 📊
category: projects
tools: query_db, generate_pdf, send_email
triggers: /reporte, reporte semanal, generar informe
preferred_agents: general-purpose
---

# Reporte Semanal

## Cuándo Usar

- Usuario solicita explícitamente un "reporte semanal"
- Usuario menciona "resumen de la semana" o "informe semanal"
- Trigger detectado: `/reporte`

## Instrucciones

1. **Recopilar métricas**
   
   Usa `query_db` para obtener:
   ```sql
   SELECT COUNT(*) as total_commits 
   FROM commits 
   WHERE date >= date('now', '-7 days')
   ```

2. **Generar PDF**
   
   Usa `generate_pdf` con la estructura:
   - Título: "Reporte Semanal - [fecha]"
   - Sección 1: Actividad de código (commits, PRs)
   - Sección 2: Issues completados
   - Sección 3: Próximos objetivos

3. **Enviar por email** (opcional)
   
   Si el usuario proporciona email, usa `send_email`:
   - Para: email del usuario
   - Asunto: "Tu reporte semanal"
   - Adjunto: PDF generado

## Formato de Salida

El reporte debe incluir:
- Resumen ejecutivo (2-3 oraciones)
- Métricas cuantitativas (tablas)
- Gráficos de tendencia
- Recomendaciones para la próxima semana

## Ejemplos

### Ejemplo 1: Comando directo
**Usuario**: "/reporte"
**Comportamiento**: Genera reporte y muestra en chat

### Ejemplo 2: Solicitud natural
**Usuario**: "Necesito el reporte de esta semana"
**Comportamiento**: Detecta "reporte" y "semana", ejecuta skill

### Ejemplo 3: Con envío por email
**Usuario**: "Genera el reporte semanal y envíalo a user@example.com"
**Comportamiento**: Genera PDF y envía por email
```

---

## Mejores Prácticas

### ✅ Hacer

- **Sé específico en la descripción**: El LLM usa esto para decidir
- **Define triggers claros**: Patrones únicos que no causen falsos positivos
- **Estructura con pasos numerados**: El LLM sigue instrucciones secuenciales mejor
- **Incluye ejemplos**: 2-3 ejemplos mínimos cubren la mayoría de casos
- **Prueba extensivamente**: Verifica que se activa solo cuando debe
- **Prioriza información crítica**: Los primeros 500 caracteres son los que se inyectan
- **Usa categorías apropiadas**: Facilita la búsqueda y organización

### ❌ No Hacer

- **Triggers demasiado genéricos**: Evita palabras comunes como "el", "hacer"
- **Instrucciones ambiguas**: "Haz algo útil" no es suficiente
- **Demasiados pasos**: Mantén workflows bajo 10 pasos
- **Dependencias circulares**: Skill A depende de B, B depende de A
- **Duplicar skills empaquetadas**: Mejor extiende o modifica con otro nombre
- **Sobrecargar el prompt**: Skills muy largas consumen tokens valiosos

### Optimización de Triggers

**Buenos triggers**:
```yaml
triggers: /reporte, reporte semanal, generar informe semanal
```

**Malos triggers**:
```yaml
triggers: el, hacer, informe, generar  # Demasiado genéricos
```

### Estructura de Instrucciones

**Buena estructura**:
```markdown
## Instrucciones

1. **Recopilar datos**: Consulta la base de datos
2. **Procesar información**: Calcula métricas clave
3. **Generar reporte**: Crea PDF con los resultados
```

**Mala estructura**:
```markdown
## Instrucciones

Haz un reporte con los datos que encuentres y genera algo útil
```

---

## Resolución de Problemas

### La skill no se activa

**Síntomas**: Dices el trigger pero la skill no se carga

**Causas y Soluciones**:

1. **Skill desactivada**:
   ```bash
   # Verificar estado
   hive skills status mi-skill
   
   # Activar si está desactivada
   hive skills enable mi-skill
   ```

2. **Trigger mal escrito**:
   ```bash
   # Ver triggers de una skill
   hive skills show mi-skill
   ```

3. **Conflicto con otra skill**: Si dos skills tienen triggers similares, puede haber ambigüedad
   - **Solución**: Haz triggers más específicos

### Búsqueda no encuentra skill

**Causas**:

1. **Score muy por debajo del mejor resultado**: el corte relativo descarta skills
   con score < 30% del top
   - **Solución**: Mejora nombre, descripción y triggers

2. **Skill fuera de índice**: el índice HiveDB se reconstruye en cada arranque
   del gateway; reinicia el gateway para re-sincronizar

3. **Categoría incorrecta**: Buscar en la categoría equivocada

### Skill no sigue instrucciones

**Causas**:

1. **Instrucciones muy largas**: Solo se inyectan los primeros 500 caracteres
   - **Solución**: Priorizar información crítica al inicio

2. **Formato incorrecto**: El markdown debe estar bien estructurado
   - Usar encabezados claros (`##`, `###`)
   - Listas numeradas para pasos secuenciales

3. **Herramientas no disponibles**: La skill referencia herramientas que no existen
   - Verificar que las herramientas están instaladas y activas

### Logs y Depuración

```bash
# Qué skills se activaron en la última interacción
hive debug last-interaction --skills

# Histórico de activaciones
hive skills usage-log

# Modo debug
export HIVE_DEBUG_SKILLS=true
hive restart
```

---

## Preguntas Frecuentes

### General

**¿Cuál es la diferencia entre MCP y Skills?**

| Aspecto | MCP | Skills |
|---------|-----|--------|
| **Naturaleza** | Código ejecutable | Instrucciones de texto |
| **Ejecución** | Funciones reales | Guías para el LLM |
| **Almacenamiento** | Servidores externos | Base de datos / archivos |
| **Uso** | Acciones concretas | Comportamiento del agente |

**¿Puedo usar Skills sin MCP?**

Sí, las Skills funcionan independientemente. Pueden usar herramientas nativas de Hive.

### Rendimiento

**¿Las skills ralentizan el agente?**

Ligeramente. Cada skill añade ~500 caracteres al prompt. Con 4 skills activas + 3 mínimas = ~3500 tokens extra.

**¿Cuántas skills puedo tener instaladas?**

No hay límite hard, pero se recomienda:
- **Mínimo**: 5-10 skills esenciales
- **Recomendado**: 15-25 skills
- **Máximo práctico**: ~50 skills (depende del contexto disponible)

### Seguridad

**¿Puedo restringir qué skills se activan?**

Sí, desde el panel de configuración puedes desactivar skills individualmente.

### Desarrollo

**¿Cómo creo una skill?**

Crea un archivo `SKILL.md` con frontmatter YAML y contenido markdown, luego instálalo con `hive skills install`.

**¿Puedo compartir mis skills con otros?**

¡Absolutamente! Las skills son archivos Markdown portables:
- Comparte el archivo `SKILL.md`
- Usa GitHub/GitLab para versionado
- Crea un repositorio de skills de la comunidad

**¿Hay plantillas de skills disponibles?**

Sí, revisa las skills bundled en `packages/skills/src/bundled/` como referencia.

### Integración

**¿Puedo usar MCP y Skills juntos?**

¡Sí! De hecho, es la configuración recomendada:
- **Skills** guían al agente en el comportamiento
- **MCP** provee las herramientas ejecutables

**Ejemplo de flujo combinado**:

```
Usuario: "/search cómo conectar a PostgreSQL"
                ↓
Skill activada: web-research (trigger: /search)
                ↓
Skill instruye: "Busca información usando herramientas web"
                ↓
Agente usa: search (MCP tool de web-server)
                ↓
Resultado: Información mostrada al usuario
```

---

## Glosario

| Término | Definición |
|---------|------------|
| **Skill** | Habilidad: instrucciones en markdown para guiar al agente |
| **Trigger** | Patrón de texto que activa una skill explícitamente |
| **BM25** | Algoritmo de ranking del índice de búsqueda de texto completo (tantivy, vía HiveDB) |
| **Frontmatter** | Metadata YAML al inicio de un archivo SKILL.md |
| **Context Compiler** | Componente que construye el prompt del sistema |
| **Agent Loop** | Ciclo de razonamiento del agente de IA |
| **BM25** | Algoritmo de ranking para búsqueda de texto completo |
| **Bundled** | Skills empaquetadas con Hive por defecto |
| **Workspace** | Directorio de trabajo del usuario (máxima prioridad) |
| **Stopwords** | Palabras comunes sin valor semántico (el, la, de, etc.) |

---

## Apéndice: Referencia Rápida

### Comandos Más Usados

```bash
hive skills list                 # Listar skills
hive skills search término       # Buscar skill
hive skills show nombre          # Ver detalles
hive skills enable nombre        # Activar
hive skills disable nombre       # Desactivar
hive skills update               # Actualizar empaquetadas
hive skills install archivo      # Instalar desde archivo
hive skills rebuild-index        # Reconstruir FTS5
```

### Endpoints de API REST

| Método | Ruta | Acción |
|--------|------|--------|
| GET | `/api/skills` | Listar skills |
| POST | `/api/skills` | Crear skill |
| GET | `/api/skills/:id` | Ver detalles |
| PUT | `/api/skills/:id` | Actualizar |
| DELETE | `/api/skills/:id` | Eliminar |
| POST | `/api/skills/:id/toggle` | Activar/desactivar |
| GET | `/api/skills/search?q=` | Buscar por texto |

### Esquema de Base de Datos

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  tools TEXT,
  triggers TEXT,
  body TEXT NOT NULL,
  version TEXT,
  active INTEGER DEFAULT 1
);

CREATE VIRTUAL TABLE skills_fts USING fts5(
  id, name, category, tools, triggers, body,
  tokenize='unicode61'
);
```

### Categorías Disponibles

| Categoría | Descripción |
|-----------|-------------|
| `agents` | Gestión y coordinación de agentes |
| `canvas` | Generación de UI con A2UI |
| `cli` | Comandos de línea de comandos |
| `codebridge` | Ejecución de código aislado |
| `cron` | Tareas programadas |
| `filesystem` | Operaciones de archivos |
| `office` | Documentos de oficina |
| `projects` | Gestión de proyectos |
| `voice` | Síntesis de voz |
| `web` | Búsqueda y scraping web |

---

**Última actualización**: Abril 2026  
**Versión del Manual**: 1.0  
**Versión de Hive**: Compatible con Hive v2.x
