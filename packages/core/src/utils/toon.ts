/**
 * TOON Format Utility - Encode Only con Costo
 *
 * TOON (Token-Oriented Object Notation) es el formato para enviar datos al LLM.
 * Proporciona una representación más compacta que JSON, ahorrando ~40% de tokens.
 *
 * Formatos soportados:
 * - Arrays (formato tabular): field1,field2,field3\nvalue1,value2,value3
 * - Objetos simples: key: value
 * - Objetos anidados: key:\n  nested: value
 *
 * Uso en:
 * - Tool results (al enviar al LLM)
 * - Contexto del agente (scratchpad, user data)
 * - MCP responses
 * - Skill outputs
 */

import { encode as stringifyToon } from 'toon-format-parser'
import { logger } from './logger'
import { getAverageTokenCost, recordToonSavings as recordToonSavingsDB } from '../storage/usage'

const log = logger.child('toon')

export interface ToonStringifyResult {
  content: string
  format: 'toon'
  originalSize: number
  toonSize: number
  tokensSaved: number
  savingsPercent: number
  costSaved: number
}

/**
 * Stringify JavaScript object to TOON format
 * Always returns TOON format (never JSON)
 * Calcula ahorro en tokens y costo USD
 */
export function stringify(data: any, model?: string): ToonStringifyResult {
  const jsonContent = JSON.stringify(data)
  const originalSize = jsonContent.length
  const originalTokens = estimateTokens(jsonContent)

  try {
    const toonContent = stringifyToon(data)
    const toonSize = toonContent.length
    const toonTokens = estimateTokens(toonContent)
    const tokensSaved = Math.max(0, originalTokens - toonTokens)
    const savingsPercent = originalTokens > 0 ? (tokensSaved / originalTokens) * 100 : 0

    // Calcular costo del ahorro si se proporciona el modelo
    const costPerToken = model ? getAverageTokenCost(model) : 0
    const costSaved = tokensSaved * costPerToken

    log.debug(`[TOON stringify] Converted to TOON - saved ${tokensSaved} tokens ($${costSaved.toFixed(6)}) (${savingsPercent.toFixed(1)}%)`)

    return {
      content: toonContent,
      format: 'toon',
      originalSize,
      toonSize,
      tokensSaved,
      savingsPercent,
      costSaved,
    }
  } catch (error) {
    log.warn(`[TOON stringify] Failed, falling back to JSON:`, error)

    return {
      content: jsonContent,
      format: 'toon',
      originalSize,
      toonSize: originalSize,
      tokensSaved: 0,
      savingsPercent: 0,
      costSaved: 0,
    }
  }
}

/**
 * Force TOON format for tool results
 * Registra ahorro en DB si se proporciona el modelo
 */
export function formatToolResult(data: any, model?: string): string {
  const result = stringify(data, model)

  // Record savings for metrics
  if (result.tokensSaved > 0 && model) {
    recordToonSavingsDB(result.tokensSaved, result.costSaved, 'tool_result')
  }

  return result.content
}

/**
 * Force TOON format for MCP responses
 */
export function formatMCPResponse(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavingsDB(result.tokensSaved, result.costSaved, 'mcp_response')
  }

  return result.content
}

/**
 * Force TOON format for skill outputs
 */
export function formatSkillOutput(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavingsDB(result.tokensSaved, result.costSaved, 'skill_output')
  }

  return result.content
}

/**
 * Format context data for agent (ethics, notes, projects, user data, etc.)
 */
export function formatContext(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavingsDB(result.tokensSaved, result.costSaved, 'context')
  }

  return result.content
}

/**
 * Estimate tokens in text (simple character-based estimation)
 * Standard: ~4 chars per token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Middleware wrapper for tool execution that enforces TOON format
 */
export async function withToonFormat<T>(
  toolName: string,
  fn: () => Promise<T>,
  model?: string
): Promise<string> {
  const t0 = performance.now()

  try {
    const result = await fn()
    const duration = Math.round(performance.now() - t0)

    // Convert to TOON
    const toonResult = formatToolResult(result, model)

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

    return formatToolResult(errorObj, model)
  }
}
