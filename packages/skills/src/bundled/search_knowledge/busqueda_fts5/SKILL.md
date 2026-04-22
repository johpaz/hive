---
name: busqueda_fts5
description: "Core discovery skill - learn how to find any capability using search_knowledge"
version: 1.0.0
author: Hive Team
icon: "🔍"
category: core
permissions: []
dependencies: []
tools: [search_knowledge]

# Triggers - how to activate this skill
triggers:
  - cómo busco herramientas
  - cómo encuentro skills
  - how to find tools
  - search knowledge
  - discovery
  - buscar en la base
  - encontrar herramientas

---

# busqueda_fts5 — Discovery System

This skill teaches you how to find any capability in Hive using **search_knowledge**.

## Por qué Discovery?

You start with only 4 basic tools. All other capabilities (tools, skills, MCP tools, playbook rules) must be discovered dynamically.

## Cómo Buscar

`search_knowledge(type, query)`

### Type Options:

| type | What it finds | Example |
|------|---------------|---------|
| **tools** | Native Hive tools | `search_knowledge(type="tools", query="leer archivo")` |
| **skills** | Task instructions | `search_knowledge(type="skills", query="generar código")` |
| **mcp** | External MCP tools (Airtable, GitHub) | `search_knowledge(type="mcp", query="crear registro")` |
| **playbook** | Best practices rules | `search_knowledge(type="playbook", query="seguridad")` |
| **all** | Everything | `search_knowledge(type="all", query="buscar web")` |

## Query Tips

- **Be specific**: `search_knowledge(type="tools", query="leer archivo markdown")` not just "file"
- **Bilingual**: Search in Spanish, the system retries in English if few results
- **Use task context**: "debuggear código" finds code_debug skill
- **Tool format**: MCP tools are `{serverName}__{toolName}` (e.g., `airtable_crm_datos___AIRTABLE_LIST_BASES`)

## Discovery Flow

1. User asks for something you don't have → `search_knowledge(query, type)`
2. Results come back with tool names and descriptions
3. Tools are automatically injected into your context
4. Use the injected tools immediately

## Examples

**Find a tool to read files:**
```
search_knowledge({type: "tools", query: "leer archivo", limit: 5})
→ Returns fs_read, fs_list, etc.
```

**Find Airtable tools:**
```
search_knowledge({type: "mcp", query: "crear registro airtable", limit: 5})
→ Returns AIRTABLE_CREATE_RECORD, etc.
```

**Find skill to generate code:**
```
search_knowledge({type: "skills", query: "generar código", limit: 3})
→ Returns code_generate, code_delegator, etc.
```

## Priority Rule

**ALWAYS prefer native tools over MCP tools** when both do the task.
- Native tools: faster, no network, always available
- MCP tools: fallback when no native tool exists

## Remember

- No tool in your startup context? → **search_knowledge**
- Don't know how to do something? → **search_knowledge**
- Need external capabilities (Airtable, GitHub)? → **search_knowledge(type="mcp")**