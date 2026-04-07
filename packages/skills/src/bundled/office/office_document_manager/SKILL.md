---
name: office_document_manager
description: "Leer, crear y manipular archivos Office (PDF, Word, Excel, PowerPoint) desde el workspace"
version: 1.0.0
author: Hive Team
icon: "📄"
category: office
permissions:
  - filesystem_read
  - filesystem_write
dependencies: []
tools:
  - office_leer_pdf
  - office_escribir_pdf
  - office_leer_docx
  - office_escribir_docx
  - office_leer_xlsx
  - office_escribir_xlsx
  - office_leer_pptx
  - office_escribir_pptx

triggers:
  - "leer pdf"
  - "abrir pdf"
  - "extraer texto de pdf"
  - "pdf a texto"
  - "crear pdf"
  - "generar pdf"
  - "exportar a pdf"
  - "leer word"
  - "abrir docx"
  - "extraer texto de word"
  - "crear word"
  - "generar docx"
  - "documento word"
  - "leer excel"
  - "abrir xlsx"
  - "datos de excel"
  - "crear excel"
  - "generar xlsx"
  - "exportar a excel"
  - "leer powerpoint"
  - "abrir pptx"
  - "presentacion"
  - "diapositivas"
  - "crear presentacion"
  - "generar pptx"
  - "read pdf"
  - "open pdf"
  - "create pdf"
  - "read excel"
  - "create excel"
  - "read word"
  - "create word"
  - "read powerpoint"
  - "create presentation"

preferred_agents: []

steps:
  - step: 1
    action: office_leer_pdf
    instruction: "Leer un archivo PDF y extraer su texto e información básica"
    params:
      ruta: "path/to/file.pdf"
    output: pdf_content

  - step: 2
    action: office_escribir_pdf
    instruction: "Generar un archivo PDF desde texto o contenido procesado"
    params:
      ruta: "path/to/output.pdf"
      contenido: "texto a escribir"
      titulo: "Título del documento"
      tamaño_pagina: "A4"
    output: pdf_created

  - step: 3
    action: office_leer_docx
    instruction: "Leer un documento Word y extraer párrafos y tablas"
    params:
      ruta: "path/to/file.docx"
      incluir_tablas: true
    output: docx_content

  - step: 4
    action: office_escribir_docx
    instruction: "Generar un documento Word con párrafos, títulos y tablas estructuradas"
    params:
      ruta: "path/to/output.docx"
      titulo: "Título"
      parrafos:
        - texto: "Introducción"
          tipo: "titulo1"
        - texto: "Contenido del documento"
          tipo: "parrafo"
    output: docx_created

  - step: 5
    action: office_leer_xlsx
    instruction: "Leer un archivo Excel y obtener los datos de cada hoja como JSON"
    params:
      ruta: "path/to/file.xlsx"
      incluir_encabezados: true
    output: xlsx_data

  - step: 6
    action: office_escribir_xlsx
    instruction: "Generar un archivo Excel con múltiples hojas desde datos JSON"
    params:
      ruta: "path/to/output.xlsx"
      hojas:
        - nombre: "Hoja1"
          datos:
            - col1: "valor"
              col2: "valor"
    output: xlsx_created

  - step: 7
    action: office_leer_pptx
    instruction: "Leer una presentación PowerPoint y extraer el texto de cada diapositiva"
    params:
      ruta: "path/to/file.pptx"
    output: pptx_content

  - step: 8
    action: office_escribir_pptx
    instruction: "Generar una presentación PowerPoint con título, viñetas y notas por diapositiva"
    params:
      ruta: "path/to/output.pptx"
      titulo_presentacion: "Mi Presentación"
      diapositivas:
        - titulo: "Intro"
          puntos:
            - "Punto 1"
            - "Punto 2"
    output: pptx_created

rules:
  - "Usa office_leer_* para extraer contenido antes de generar una versión nueva"
  - "Siempre confirma la ruta de salida con el usuario antes de sobrescribir un archivo existente"
  - "Para PDFs grandes, usa pagina_inicio/pagina_fin para leer por secciones"
  - "Para Excel, especifica el nombre de hoja con el parámetro 'hoja' si solo necesitas una"
  - "Al escribir DOCX, usa 'tipo: titulo1/titulo2/titulo3' para crear jerarquía de encabezados"
  - "Para presentaciones, usa 'puntos' en lugar de 'contenido' cuando el texto es una lista"
  - "Usa fs_read/fs_exists antes de leer un office file para confirmar que la ruta existe"

output_format:
  structure: markdown
  sections:
    - "archivo"
    - "contenido_extraido"
    - "resultado"
  max_length: "Truncar texto extraído a 2000 caracteres si es muy largo, con indicación de páginas/hojas restantes"

examples:
  - user_input: "lee el PDF en /documentos/informe.pdf y dime de qué trata"
    expected_behavior: "office_leer_pdf({ ruta: '/documentos/informe.pdf' }) → resume el contenido extraído"

  - user_input: "crea un PDF con el resumen de la reunión"
    expected_behavior: "office_escribir_pdf({ ruta: 'resumen_reunion.pdf', contenido: '...', titulo: 'Resumen de Reunión' })"

  - user_input: "pasa los datos del Excel a un formato que pueda entender"
    expected_behavior: "office_leer_xlsx({ ruta: 'datos.xlsx' }) → retorna datos como JSON con estructura de hojas"

  - user_input: "genera una presentación de 5 slides sobre machine learning"
    expected_behavior: "office_escribir_pptx({ ruta: 'ml_intro.pptx', titulo_presentacion: 'Introducción a ML', diapositivas: [...] })"

  - user_input: "extrae el texto del contrato en Word"
    expected_behavior: "office_leer_docx({ ruta: 'contrato.docx', incluir_tablas: true }) → retorna texto plano con tablas"
---

# Office Document Manager Skill

## Cuándo se Activa

Esta skill se activa cuando el usuario necesita:
- **Leer** archivos PDF, Word (.docx), Excel (.xlsx) o PowerPoint (.pptx)
- **Generar** nuevos archivos en cualquiera de esos formatos
- **Convertir** contenido entre formatos (ej: texto → PDF, JSON → Excel)
- **Extraer** datos estructurados de documentos (tablas de Excel, slides de presentación)

## Herramientas Disponibles

| Tool | Qué hace | Cuándo usarla |
|------|----------|---------------|
| `office_leer_pdf` | Extrae texto + metadata de PDF | Leer informes, contratos, libros en PDF |
| `office_escribir_pdf` | Genera PDF desde texto | Crear reportes, resúmenes, documentación |
| `office_leer_docx` | Extrae texto y tablas de Word | Leer documentos, contratos, informes Word |
| `office_escribir_docx` | Genera Word con estructura | Crear documentos formales con títulos/tablas |
| `office_leer_xlsx` | Lee hojas de Excel como JSON | Procesar datos, tablas, inventarios |
| `office_escribir_xlsx` | Genera Excel desde JSON | Exportar datos, crear reportes tabulares |
| `office_leer_pptx` | Extrae texto de cada slide | Resumir presentaciones, extraer contenido |
| `office_escribir_pptx` | Genera presentación PowerPoint | Crear slides desde datos o resúmenes |

## Workflow por Caso de Uso

### Leer y resumir un documento
1. `office_leer_pdf/docx/xlsx/pptx` → extraer contenido
2. Procesar y resumir el texto
3. `notify` → enviar resumen al usuario

### Transformar datos a Excel
1. Obtener datos (de memoria, herramienta o cálculo)
2. Estructurar en `hojas` con `datos` como array de objetos
3. `office_escribir_xlsx` → generar archivo
4. Confirmar ruta al usuario

### Crear un informe PDF
1. Compilar el contenido del informe como texto
2. `office_escribir_pdf` → generar con título y márgenes
3. Confirmar que el archivo quedó en la ruta esperada

### Generar una presentación
1. Definir estructura: título + array de slides (título + puntos)
2. `office_escribir_pptx` → generar .pptx
3. Opcional: incluir notas del presentador en cada slide

## Parámetros Clave

### `parrafos` para DOCX
```json
[
  { "texto": "Capítulo 1", "tipo": "titulo1" },
  { "texto": "Subtítulo", "tipo": "titulo2" },
  { "texto": "Contenido normal", "tipo": "parrafo" },
  { "texto": "Ítem de lista", "tipo": "lista" },
  { "texto": "Texto importante", "tipo": "parrafo", "negrita": true }
]
```

### `hojas` para XLSX
```json
[
  {
    "nombre": "Ventas",
    "datos": [
      { "Mes": "Enero", "Total": 5000 },
      { "Mes": "Febrero", "Total": 6200 }
    ]
  }
]
```

### `diapositivas` para PPTX
```json
[
  {
    "titulo": "¿Qué es Machine Learning?",
    "puntos": ["Subcampo de IA", "Aprende de datos", "Hace predicciones"],
    "notas": "Mencionar el enfoque supervisado y no supervisado"
  }
]
```

## Errores a Evitar

- ❌ Intentar leer un archivo que no existe (verifica con `fs_exists` primero)
- ❌ Sobrescribir sin confirmar cuando el archivo destino ya existe
- ❌ Usar `contenido` y `puntos` a la vez en PPTX — `puntos` tiene prioridad
- ❌ Pasar un array de arrays como `datos` de XLSX cuando se esperan objetos con claves
- ❌ Intentar leer PDF de más de 100 páginas sin especificar rango (usar `pagina_inicio`/`pagina_fin`)
