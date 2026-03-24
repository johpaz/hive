/**
 * TOON Format Utility - Direct lib usage with native compression analysis
 *
 * TOON (Token-Oriented Object Notation) provides ~40% token savings vs JSON.
 * Uses toon-format-parser library directly.
 */

import { encode, decode, analyzeCompression } from 'toon-format-parser'
import { logger } from './logger'
import { recordToonSavings } from '../storage/usage'

const log = logger.child('toon')

export interface ToonStringifyResult {
  content: string
  format: 'toon'
  originalSize: number
  toonSize: number
  tokensSaved: number
  savingsPercent: number
  costSaved: number
  // Complete compression metrics
  jsonBytes: number
  toonBytes: number
  savedBytes: number
  savedPercent: number
  jsonTokens: number
  toonTokens: number
  savedTokensPercent: number
}

/**
 * Estimate tokens in text (standard: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Average cost per token for TOON savings calculation
 * Based on Gemini 3 Flash pricing: $0.15/1M input + $0.60/1M output = $0.375/1M average
 * This is used as a baseline for calculating USD savings from token compression
 */
const TOON_AVERAGE_COST_PER_TOKEN = 0.000000375 // $0.375 per million tokens

/**
 * Stringify JavaScript object to TOON format with token savings calculation
 * Uses native analyzeCompression from toon-format-parser
 */
export function stringify(data: any, model?: string): ToonStringifyResult {
  const jsonContent = JSON.stringify(data)
  const originalSize = jsonContent.length

  try {
    const toonContent = encode(data)
    const toonSize = toonContent.length

    // Use native analyzeCompression for accurate metrics
    const analysis = analyzeCompression(data)
    const tokensSaved = Math.max(0, analysis.savedTokens)
    const savingsPercent = Math.max(0, analysis.savedTokensPercent)

    // Calculate cost savings using average cost (Gemini 3 Flash baseline)
    const costSaved = tokensSaved * TOON_AVERAGE_COST_PER_TOKEN

    log.debug(`[TOON] Converted - saved ${tokensSaved} tokens ($${costSaved.toFixed(6)}) (${savingsPercent.toFixed(1)}%)`)

    return {
      content: toonContent,
      format: 'toon',
      originalSize,
      toonSize,
      tokensSaved,
      savingsPercent,
      costSaved,
      // Complete compression metrics from analyzeCompression
      jsonBytes: analysis.jsonBytes,
      toonBytes: analysis.toonBytes,
      savedBytes: analysis.savedBytes,
      savedPercent: analysis.savedPercent,
      jsonTokens: analysis.jsonTokens,
      toonTokens: analysis.toonTokens,
      savedTokensPercent: analysis.savedTokensPercent,
    }
  } catch (error) {
    log.warn(`[TOON] Failed, falling back to JSON:`, error)

    return {
      content: jsonContent,
      format: 'toon',
      originalSize,
      toonSize: originalSize,
      tokensSaved: 0,
      savingsPercent: 0,
      costSaved: 0,
      jsonBytes: originalSize,
      toonBytes: originalSize,
      savedBytes: 0,
      savedPercent: 0,
      jsonTokens: estimateTokens(jsonContent),
      toonTokens: estimateTokens(jsonContent),
      savedTokensPercent: 0,
    }
  }
}

/**
 * Format tool result to TOON (for LLM consumption)
 * Records savings in DB if model is provided
 */
export function formatToolResult(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavings({
      jsonBytes: result.jsonBytes,
      toonBytes: result.toonBytes,
      savedBytes: result.savedBytes,
      savedPercent: result.savedPercent,
      jsonTokens: result.jsonTokens,
      toonTokens: result.toonTokens,
      savedTokens: result.tokensSaved,
      savedTokensPercent: result.savedTokensPercent,
    }, result.costSaved, 'tool_result')
  }

  return result.content
}

/**
 * Format MCP response to TOON
 */
export function formatMCPResponse(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavings({
      jsonBytes: result.jsonBytes,
      toonBytes: result.toonBytes,
      savedBytes: result.savedBytes,
      savedPercent: result.savedPercent,
      jsonTokens: result.jsonTokens,
      toonTokens: result.toonTokens,
      savedTokens: result.tokensSaved,
      savedTokensPercent: result.savedTokensPercent,
    }, result.costSaved, 'mcp_response')
  }

  return result.content
}

/**
 * Format skill output to TOON
 */
export function formatSkillOutput(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavings({
      jsonBytes: result.jsonBytes,
      toonBytes: result.toonBytes,
      savedBytes: result.savedBytes,
      savedPercent: result.savedPercent,
      jsonTokens: result.jsonTokens,
      toonTokens: result.toonTokens,
      savedTokens: result.tokensSaved,
      savedTokensPercent: result.savedTokensPercent,
    }, result.costSaved, 'skill_output')
  }

  return result.content
}

/**
 * Format context data (ethics, notes, projects, user data) to TOON
 */
export function formatContext(data: any, model?: string): string {
  const result = stringify(data, model)

  if (result.tokensSaved > 0 && model) {
    recordToonSavings({
      jsonBytes: result.jsonBytes,
      toonBytes: result.toonBytes,
      savedBytes: result.savedBytes,
      savedPercent: result.savedPercent,
      jsonTokens: result.jsonTokens,
      toonTokens: result.toonTokens,
      savedTokens: result.tokensSaved,
      savedTokensPercent: result.savedTokensPercent,
    }, result.costSaved, 'context')
  }

  return result.content
}

/**
 * Middleware wrapper for tool execution with TOON formatting
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

    const toonResult = formatToolResult(result, model)

    log.debug(`[TOON] Tool ${toolName} executed in ${duration}ms - output converted`)

    return toonResult
  } catch (error) {
    const errorObj = {
      error: true,
      tool: toolName,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }

    return formatToolResult(errorObj, model)
  }
}

/**
 * Print compression report to console for debugging/analysis
 * Note: This prints directly to console, does not return a string
 */
export function reportCompression(data: any): void {
  // Import dynamically to avoid issues if function doesn't exist
  import('toon-format-parser')
    .then(({ printCompressionReport }) => {
      printCompressionReport(data)
    })
    .catch(() => {
      // Fallback: manual report
      const analysis = analyzeCompression(data)
      console.log(`\nTOON Compression Report:`)
      console.log(`  JSON: ${analysis.jsonBytes} bytes, ~${analysis.jsonTokens} tokens`)
      console.log(`  TOON: ${analysis.toonBytes} bytes, ~${analysis.toonTokens} tokens`)
      console.log(`  Saved: ${analysis.savedBytes} bytes, ${analysis.savedTokens} tokens (${analysis.savedPercent.toFixed(1)}%)`)
    })
}

/**
 * Get compression analysis as an object (for programmatic use)
 */
export function getCompressionAnalysis(data: any): ReturnType<typeof analyzeCompression> {
  return analyzeCompression(data)
}
