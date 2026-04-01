# 📚 Formato TOON - Documentación Completa

**TOON (Token-Oriented Object Notation)** es el formato para enviar datos al LLM en Hive. Proporciona una representación más compacta que JSON, ahorrando ~40% de tokens **con cálculo de costo USD**.

---

## 🎯 Principio Clave: Encode Only con Costo

**Las herramientas trabajan con JS objects normales.** Solo se hace **encode TOON al enviar al LLM** para ahorrar tokens, **calculando el costo ahorrado en USD**.

```
Tool ejecuta → JS Object → formatToolResult(data, model)
                              ↓
                    Calcula tokensSaved vs JSON
                              ↓
                    getAverageTokenCost(model)
                              ↓
                    costSaved = tokensSaved * costPerToken
                              ↓
                    recordToonSavings() → DB
                              ↓
                    TOON String → LLM
```

---

## 📍 Índice de Archivos

| # | Archivo | Tipo | Función Principal |
|---|---------|------|-------------------|
| 1 | [`packages/core/src/utils/toon.ts`](#1-packagescoresrctoolstoonts-) | **Core** | Implementación encode con costo |
| 2 | [`packages/core/src/storage/usage.ts`](#2-packagescoresrcstorageusagets) | Costo | `getAverageTokenCost()`, `recordToonSavings()` |
| 3 | [`packages/core/src/agent/agent-loop.ts`](#3-packagescoresrcagentagent-loopts) | Uso | Encode de tool results con modelo |
| 4 | [`packages/core/src/agent/context-compiler.ts`](#4-packagescoresrcagentcontext-compilerts) | Uso | Formato de scratchpad |
| 5 | [`packages/core/src/agent/prompt-builder.ts`](#5-packagescoresrcagentprompt-builderts) | Uso | Formato de datos de usuario |
| 6 | [`packages/core/src/gateway/routes/system.ts`](#6-packagescoresrcgatewayroutessystemts) | API | Endpoint de estadísticas TOON |
| 7 | [`packages/hive-ui/src/components/UsageStatsPanel.tsx`](#7-packageshive-uisrccomponentsusagestatspaneltsx) | UI | Dashboard de ahorro TOON |
| 8 | [`packages/core/package.json`](#8-packagejson) | Dep | `toon-format-parser@1.1.3` |

---

## 1. `packages/core/src/utils/toon.ts` ⭐ CORE

**Propósito:** Implementación del encode TOON con cálculo de costo

### Funciones Exportadas

#### `stringify(data: any, model?: string): ToonStringifyResult`

- **Encode:** JS Object → TOON string
- **Librería:** `toon-format-parser.encode()`
- **Parámetro opcional:** `model` - para cálculo de costo
- **Retorna:**
  ```typescript
  {
    content: string,
    format: 'toon',
    originalSize: number,
    toonSize: number,
    tokensSaved: number,
    savingsPercent: number,
    costSaved: number  // ← NUEVO: ahorro en USD
  }
  ```

#### `formatToolResult(data: any, model?: string): string`

- **Uso:** Wrapper para outputs de herramientas
- **Registra:** Ahorro en DB si se proporciona el modelo
- **Categoría:** `'tool_result'`

#### `formatMCPResponse(data: any, model?: string): string`

- **Uso:** Formato para respuestas MCP
- **Registra:** Ahorro en DB (categoría `'mcp_response'`)

#### `formatSkillOutput(data: any, model?: string): string`

- **Uso:** Formato para outputs de skills
- **Registra:** Ahorro en DB (categoría `'skill_output'`)

#### `formatContext(data: any, model?: string): string`

- **Uso:** Formato para contexto (scratchpad, user data)
- **Registra:** Ahorro en DB (categoría `'context'`)

#### `estimateTokens(text: string): number`

- **Fórmula:** `Math.ceil(text.length / 4)`

#### `withToonFormat<T>(toolName: string, fn: () => Promise<T>, model?: string): Promise<string>`

- **Middleware:** Wrapper para ejecución de tools

### Interfaces

```typescript
export interface ToonStringifyResult {
  content: string
  format: 'toon'
  originalSize: number
  toonSize: number
  tokensSaved: number
  savingsPercent: number
  costSaved: number  // ← Ahorro en USD
}
```

---

## 2. `packages/core/src/storage/usage.ts`

**Propósito:** Cálculo de costo y registro de ahorro

### Funciones

#### `getAverageTokenCost(model: string): number`

- **Calcula:** Costo promedio por token (input + output)
- **Fórmula:** `(inputPer1M + outputPer1M) / 2 / 1_000_000`
- **Ejemplo:**
  ```typescript
  getAverageTokenCost('gpt-4o')  // → $0.00000625 por token
  getAverageTokenCost('claude-sonnet-4-6')  // → $0.000009 por token
  ```

#### `recordToonSavings(tokensSaved: number, costSaved: number, category: string): void`

- **Guarda:** En `usage_records` table
- **Fire-and-forget:** No bloquea
- **Categorías:** `'tool_result'`, `'mcp_response'`, `'skill_output'`, `'context'`

### Precios por Modelo (USD por 1M tokens)

| Modelo | Input | Output | Promedio/Token |
|--------|-------|--------|----------------|
| claude-opus-4-6 | $5 | $25 | $0.000015 |
| claude-sonnet-4-6 | $3 | $15 | $0.000009 |
| gpt-4o | $2.5 | $10 | $0.00000625 |
| gpt-4o-mini | $0.15 | $0.6 | $0.000000375 |
| gemini-2.5-pro | $1.25 | $10 | $0.000005625 |

---

## 3. `packages/core/src/agent/agent-loop.ts`

**Propósito:** Loop principal del agente

### Import
```typescript
import { formatToolResult } from "../utils/toon"
import { getAverageTokenCost } from "../storage/usage"
```

### Encode con Costo

```typescript
// Obtener modelo limpio
const cleanModel = providerCfg.model.replace(...)

// Tool ejecuta y devuelve JS object NORMAL
const toolResultJS = await executeTool(...)

// Encode SOLO para enviar al LLM (con cálculo de costo)
const toolResultLLM = formatToolResult(toolResultJS, cleanModel)
// → Registra tokensSaved y costSaved en DB

// Enviar al LLM (TOON encoded)
messages.push({
  role: "tool",
  content: toolResultLLM,  // ← TOON string
  tool_call_id: tc.id,
})

// Agente usa JS object directamente (sin decode)
const foundTools = toolResultJS.tools ?? []
```

---

## 4. `packages/core/src/agent/context-compiler.ts`

**Propósito:** Compilar contexto para el agente

### Uso
```typescript
import { formatContext } from "../utils/toon"

const scratchpadContent = formatContext(scratchpadData, model)
systemPrompt += `\n\n# SCRATCHPAD\n${scratchpadContent}\n`
```

---

## 5. `packages/core/src/agent/prompt-builder.ts`

**Propósito:** Construir system prompts

### Uso
```typescript
import { formatContext } from "../utils/toon"

userSection += formatContext(userData, model) + "\n\n"
```

---

## 6. `packages/core/src/gateway/routes/system.ts`

**Propósito:** Endpoint de estadísticas de uso

### Query de TOON Savings
```typescript
const toonTotals = db.query(`
  SELECT
    COALESCE(SUM(toon_saved_tokens), 0) as toonSavedTokens,
    COALESCE(SUM(toon_saved_cost), 0) as toonSavedCost
  FROM usage_records
  WHERE created_at >= ?
`).get(since)
```

### Response
```typescript
{
  totalTokens: number,
  totalCostUsd: number,
  toonSavedTokens: number,      // ← Tokens ahorrados
  toonSavedCost: number,        // ← USD ahorrados
  toonSavingsPercent: number    // ← % de reducción
}
```

---

## 7. `packages/hive-ui/src/components/UsageStatsPanel.tsx`

**Propósito:** Dashboard de estadísticas

### UI de TOON Savings
```tsx
<div className="TOON Ahorro">
  <Zap className="text-emerald-400" />
  <span>TOON Ahorro de Tokens</span>
  <span>{stats.toonSavingsPercent.toFixed(1)}% reducción</span>
  
  <div>{formatNumber(stats.toonSavedTokens)} tokens ahorrados</div>
  <div>{formatCurrency(stats.toonSavedCost)} USD</div>
</div>
```

---

## 8. `package.json`

### Dependencia
```json
"toon-format-parser": "1.1.3"
```

---

## 🔄 Flujo Completo con Costo

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Tool ejecuta → JS Object                                      │
│    { tools: [...], skills: [...], playbook: [...] }              │
├──────────────────────────────────────────────────────────────────┤
│ 2. formatToolResult(data, 'gpt-4o')                              │
│    ↓ stringify(data, 'gpt-4o')                                   │
│    ↓ Calcula tokensSaved vs JSON                                 │
│    ↓ getAverageTokenCost('gpt-4o') → $0.00000625                 │
│    ↓ costSaved = tokensSaved * $0.00000625                       │
├──────────────────────────────────────────────────────────────────┤
│ 3. recordToonSavings(tokensSaved, costSaved, 'tool_result')      │
│    → INSERT INTO usage_records (toon_saved_tokens, toon_saved_cost) │
├──────────────────────────────────────────────────────────────────┤
│ 4. TOON string → LLM (ahorra tokens y $$$) ✅                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📝 Ejemplos de Formato

### Objeto Simple

**JSON:** `{"nombre": "Juan", "edad": 30}` (32 chars)
**TOON:**
```
nombre: Juan
edad: 30
```
(20 chars → 37.5% ahorro)

**Cálculo de costo (gpt-4o):**
- tokensSaved = (32 - 20) / 4 = 3 tokens
- costSaved = 3 * $0.00000625 = **$0.00001875**

---

## 🧪 Ejemplo de Uso Completo

```typescript
import { formatToolResult, stringify } from './utils/toon'
import { getAverageTokenCost } from './storage/usage'

// === Tool Result ===
const toolData = {
  users: [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" }
  ],
  total: 2
}

// Encode con modelo (registra ahorro en DB)
const toonResult = formatToolResult(toolData, 'gpt-4o')

// === Cálculo Manual ===
const model = 'claude-sonnet-4-6'
const costPerToken = getAverageTokenCost(model)  // → $0.000009

const result = stringify(toolData, model)
console.log(`Tokens ahorrados: ${result.tokensSaved}`)
console.log(`USD ahorrados: $${result.costSaved.toFixed(6)}`)
// Output:
// Tokens ahorrados: 5
// USD ahorrados: $0.000045
```

---

## 📊 Métricas en Dashboard

```
┌─────────────────────────────────────────┐
│ ⚡ TOON Ahorro de Tokens    35% reducción │
├─────────────────────────────────────────┤
│  1,234 tokens ahorrados                 │
│  $0.0045 USD ahorrados                  │
└─────────────────────────────────────────┘
```

---

## 💰 Fórmula de Cálculo

```
costPerToken = (inputPer1M + outputPer1M) / 2 / 1_000_000
costSaved = tokensSaved * costPerToken

tokensSaved = (jsonTokens - toonTokens)
            = (jsonLength / 4) - (toonLength / 4)
```

---

## ✅ Beneficios

| Métrica | Valor |
|---------|-------|
| **Ahorro promedio** | ~40% tokens vs JSON |
| **Estimación tokens** | `chars / 4` |
| **Costo promedio/token** | Variable por modelo |
| **Registro en DB** | Sí (toon_saved_tokens, toon_saved_cost) |
| **Dashboard** | Sí (tiempo real) |

---

*Documentación actualizada: 2026-03-11*
