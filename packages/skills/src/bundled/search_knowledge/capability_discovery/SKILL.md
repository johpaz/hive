---
name: capability_discovery
description: "Core discovery skill - find any capability with a single keyword"
version: 1.2.0
author: Hive Team
icon: "🔍"
category: core
permissions: []
dependencies: []
tools: [search_knowledge]

triggers:
  - cómo busco herramientas
  - cómo encuentro skills
  - how to find tools
  - search knowledge
  - discovery
  - buscar en la base
  - encontrar herramientas

---

# capability_discovery — Sistema de Discovery

Arrancás con solo 4 herramientas. Todo lo demás se descubre con **search_knowledge**.

## Regla de oro: UNA PALABRA, busca TODO

```
search_knowledge(query="email")
```

Eso solo — sin type, sin frases largas — devuelve tools, skills, MCP y playbook relacionados con "email".

**Evitá esto:** `search_knowledge(type="tools", query="enviar correo electrónico")` — el motor rankea por relevancia (BM25), así que una frase larga no falla, pero diluye el resultado: cada palabra de más sesga el ranking hacia coincidencias parciales y mezcla resultados menos relevantes.

**Preferí esto:** `search_knowledge(query="email")` — una palabra precisa da el resultado más ajustado y encuentra todo lo relacionado.

## Cuándo especificar type

Solo si querés filtrar resultados que ya son muchos:

```
search_knowledge(query="email", type="mcp")   → solo herramientas externas de email
search_knowledge(query="email", type="tools") → solo herramientas nativas de email
```

Por defecto type="all" — no hace falta especificarlo.

## Regla de prioridad

**Preferí herramientas nativas sobre MCP** cuando ambas sirven.
- Nativas: más rápidas, sin red, siempre disponibles
- MCP: cuando no hay equivalente nativo

## Flujo de uso

1. Identificá la palabra clave de lo que necesitás
2. `search_knowledge(query="<palabra>")` → resultados de todos los tipos
3. Las tools encontradas se inyectan automáticamente en tu contexto
4. Usás las tools en el siguiente paso

---

## Ejemplos

```
search_knowledge(query="pdf")       → tools para leer/escribir PDFs
search_knowledge(query="browser")   → tools de navegación web
search_knowledge(query="github")    → tools MCP de GitHub si están configuradas
search_knowledge(query="calendar")  → tools de Google Calendar
search_knowledge(query="canvas")    → skills de visualización
search_knowledge(query="slack")     → tools de Slack si están configuradas
```
