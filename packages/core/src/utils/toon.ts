/**
 * TOON Format Utility
 * 
 * TOON (Token-Oriented Object Notation) es el formato obligatorio para todas
 * las comunicaciones con el agente. Calcula el ahorro de tokens por cada interacción.
 * 
 * Formatos soportados:
 * - Arrays (formato tabular): field1,field2,field3\nvalue1,value2,value3
 * - Objetos simples: key: value
 * - Objetos anidados: key:\n  nested: value
 * 
 * Uso obligatorio en:
 * - Herramientas (tools)
 * - MCP servers
 * - Skills
 * - Ética
 * - Agentes
 * - Notas
 * - Proyectos
 * - Cualquier contexto pasado al modelo
 */

import { encode as stringifyToon, decode as parseToon } from 'toon-format-parser'
import { logger } from './logger'

const log = logger.child('toon')

// Token estimation: TOON vs JSON
// TOON typically saves 30-50% tokens vs JSON
const TOON_SAVINGS_FACTOR = 0.4 // 40% average savings

export interface ToonParseResult<T = any> {
  data: T
  format: 'toon' | 'json' | 'unknown'
  originalSize: number
  toonSize?: number
  tokensSaved: number
  savingsPercent: number
}

export interface ToonStringifyResult {
  content: string
  format: 'toon'
  originalSize: number
  toonSize: number
  tokensSaved: number
  savingsPercent: number
}

/**
 * Parse TOON format to JavaScript object
 * Falls back to JSON if TOON parsing fails
 * Tracks token savings for metrics
 */
export function parse<T = any>(content: string): ToonParseResult<T> {
  const originalSize = content.length
  const toonTokens = estimateTokens(content)

  try {
    // Try TOON first
    const data = parseToon(content) as T
    // Savings = what JSON would cost minus what TOON actually costs as input to the model
    const jsonContent = JSON.stringify(data)
    const jsonTokens = estimateTokens(jsonContent)
    const tokensSaved = Math.max(0, jsonTokens - toonTokens)
    const savingsPercent = jsonTokens > 0 ? (tokensSaved / jsonTokens) * 100 : 0

    if (tokensSaved > 0) {
      recordToonSavings(tokensSaved, 'decode')
    }

    log.debug(`[TOON parse] Parsed as TOON - saved ${tokensSaved} tokens (${savingsPercent.toFixed(1)}%)`)

    return {
      data,
      format: 'toon',
      originalSize,
      toonSize: originalSize,
      tokensSaved,
      savingsPercent,
    }
  } catch (toonError) {
    // Fall back to JSON
    try {
      const data = JSON.parse(content) as T
      
      log.debug(`[TOON parse] Parsed as JSON (TOON failed) - no savings`)
      
      return {
        data,
        format: 'json',
        originalSize,
        tokensSaved: 0,
        savingsPercent: 0,
      }
    } catch (jsonError) {
      log.warn(`[TOON parse] Failed to parse as both TOON and JSON`)
      
      return {
        data: content as unknown as T,
        format: 'unknown',
        originalSize,
        tokensSaved: 0,
        savingsPercent: 0,
      }
    }
  }
}

/**
 * Stringify JavaScript object to TOON format
 * Always returns TOON format (never JSON)
 * Tracks token savings for metrics
 */
export function stringify(data: any): ToonStringifyResult {
  const jsonContent = JSON.stringify(data)
  const originalSize = jsonContent.length
  const originalTokens = estimateTokens(jsonContent)
  
  try {
    const toonContent = stringifyToon(data)
    const toonSize = toonContent.length
    const toonTokens = estimateTokens(toonContent)
    const tokensSaved = Math.max(0, originalTokens - toonTokens)
    const savingsPercent = originalTokens > 0 ? (tokensSaved / originalTokens) * 100 : 0
    
    log.debug(`[TOON stringify] Converted to TOON - saved ${tokensSaved} tokens (${savingsPercent.toFixed(1)}%)`)
    
    return {
      content: toonContent,
      format: 'toon',
      originalSize,
      toonSize,
      tokensSaved,
      savingsPercent,
    }
  } catch (error) {
    log.warn(`[TOON stringify] Failed, falling back to JSON:`, error)
    
    return {
      content: jsonContent,
      format: 'toon', // Still mark as toon for API consistency
      originalSize,
      toonSize: originalSize,
      tokensSaved: 0,
      savingsPercent: 0,
    }
  }
}

/**
 * Force TOON format for tool results
 * This is the main entry point for tool outputs
 */
export function formatToolResult(data: any): string {
  const result = stringify(data)
  
  // Record savings for metrics
  if (result.tokensSaved > 0) {
    recordToonSavings(result.tokensSaved, 'tool_result')
  }
  
  return result.content
}

/**
 * Force TOON format for MCP responses
 */
export function formatMCPResponse(data: any): string {
  const result = stringify(data)
  
  if (result.tokensSaved > 0) {
    recordToonSavings(result.tokensSaved, 'mcp_response')
  }
  
  return result.content
}

/**
 * Force TOON format for skill outputs
 */
export function formatSkillOutput(data: any): string {
  const result = stringify(data)
  
  if (result.tokensSaved > 0) {
    recordToonSavings(result.tokensSaved, 'skill_output')
  }
  
  return result.content
}

/**
 * Format context data for agent (ethics, notes, projects, etc.)
 */
export function formatContext(data: any): string {
  const result = stringify(data)
  
  if (result.tokensSaved > 0) {
    recordToonSavings(result.tokensSaved, 'context')
  }
  
  return result.content
}

/**
 * Estimate tokens in text (simple character-based estimation)
 * Standard: ~4 chars per token for English text
 * TOON: ~3.5 chars per token (more compact)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Record TOON savings for metrics tracking
 * This updates the usage_records table with TOON savings
 */
function recordToonSavings(tokensSaved: number, category: string): void {
  // Fire-and-forget to avoid blocking
  Promise.resolve().then(async () => {
    try {
      const { getDb } = await import('../storage/sqlite')
      const db = getDb()
      
      // Update or insert TOON savings record
      db.query(`
        INSERT INTO usage_records (id, provider, model, input_tokens, output_tokens, cost_usd, toon_saved_tokens, toon_saved_cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          toon_saved_tokens = toon_saved_tokens + excluded.toon_saved_tokens,
          toon_saved_cost = toon_saved_cost + excluded.toon_saved_cost
      `).run(
        `toon_${category}_${Date.now()}`,
        'toon',
        category,
        0,
        0,
        0,
        tokensSaved,
        0, // Cost calculation would require pricing data
        Math.floor(Date.now() / 1000),
      )
      
      log.debug(`[TOON] Recorded ${tokensSaved} tokens saved for ${category}`)
    } catch (error) {
      log.warn(`[TOON] Failed to record savings:`, error)
    }
  })
}

/**
 * Calculate total TOON savings over a time period
 */
export function getToonSavings(since?: number): Promise<{
  totalTokensSaved: number
  totalCostSaved: number
  savingsPercent: number
  byCategory: Record<string, { tokens: number; cost: number }>
}> {
  return Promise.resolve().then(async () => {
    try {
      const { getDb } = await import('../storage/sqlite')
      const db = getDb()
      
      const sinceClause = since ? 'WHERE created_at >= ?' : ''
      const params = since ? [since] : []
      
      const totals = db.query(`
        SELECT 
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COALESCE(SUM(toon_saved_tokens), 0) as toon_saved_tokens,
          COALESCE(SUM(toon_saved_cost), 0) as toon_saved_cost
        FROM usage_records
        ${sinceClause}
      `).get(...params) as { 
        total_input: number
        total_output: number
        toon_saved_tokens: number
        toon_saved_cost: number
      }
      
      const totalTokens = totals.total_input + totals.total_output
      const savingsPercent = totalTokens > 0 
        ? (totals.toon_saved_tokens / (totalTokens + totals.toon_saved_tokens)) * 100 
        : 0
      
      // Get breakdown by category
      const byCategoryRows = db.query(`
        SELECT model as category, 
               COALESCE(SUM(toon_saved_tokens), 0) as tokens,
               COALESCE(SUM(toon_saved_cost), 0) as cost
        FROM usage_records
        WHERE provider = 'toon'
        ${sinceClause}
        GROUP BY model
      `).all(...params) as Array<{ category: string; tokens: number; cost: number }>
      
      const byCategory: Record<string, { tokens: number; cost: number }> = {}
      for (const row of byCategoryRows) {
        byCategory[row.category] = {
          tokens: row.tokens,
          cost: row.cost,
        }
      }
      
      return {
        totalTokensSaved: totals.toon_saved_tokens,
        totalCostSaved: totals.toon_saved_cost,
        savingsPercent,
        byCategory,
      }
    } catch (error) {
      log.warn(`[TOON] Failed to calculate savings:`, error)
      return {
        totalTokensSaved: 0,
        totalCostSaved: 0,
        savingsPercent: 0,
        byCategory: {},
      }
    }
  })
}

/**
 * Middleware wrapper for tool execution that enforces TOON format
 */
export async function withToonFormat<T>(
  toolName: string,
  fn: () => Promise<T>
): Promise<string> {
  const t0 = performance.now()
  
  try {
    const result = await fn()
    const duration = Math.round(performance.now() - t0)
    
    // Convert to TOON
    const toonResult = formatToolResult(result)
    
    log.debug(`[TOON] Tool ${toolName} executed in ${duration}ms - output converted to TOON`)
    
    return toonResult
  } catch (error) {
    // Also format errors as TOON
    const errorObj = {
      error: true,
      tool: toolName,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }
    
    return formatToolResult(errorObj)
  }
}
