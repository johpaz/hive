/**
 * TOON Format Utility Tests
 *
 * Tests for TOON (Token-Oriented Object Notation) implementation
 * using toon-format-parser library with native compression analysis
 */

import { describe, test, expect } from 'bun:test'
import {
  stringify,
  formatToolResult,
  formatMCPResponse,
  formatSkillOutput,
  formatContext,
  estimateTokens,
  getCompressionAnalysis,
  withToonFormat,
  type ToonStringifyResult,
} from '../packages/core/src/utils/toon.ts'

describe('TOON Utility', () => {
  describe('stringify()', () => {
    test('convierte objeto simple a TOON', () => {
      const data = { name: 'John', age: 30, city: 'New York' }
      const result = stringify(data)

      expect(result.content).toBeDefined()
      expect(result.format).toBe('toon')
      expect(result.originalSize).toBeGreaterThan(0)
      expect(result.toonSize).toBeGreaterThan(0)
      expect(typeof result.tokensSaved).toBe('number')
      expect(typeof result.savingsPercent).toBe('number')
      expect(typeof result.costSaved).toBe('number')
      // New complete metrics
      expect(typeof result.jsonBytes).toBe('number')
      expect(typeof result.toonBytes).toBe('number')
      expect(typeof result.savedBytes).toBe('number')
      expect(typeof result.savedPercent).toBe('number')
      expect(typeof result.jsonTokens).toBe('number')
      expect(typeof result.toonTokens).toBe('number')
      expect(typeof result.savedTokensPercent).toBe('number')
    })

    test('convierte objeto anidado a TOON', () => {
      const data = {
        user: {
          name: 'Alice',
          email: 'alice@example.com',
          preferences: {
            theme: 'dark',
            notifications: true,
          },
        },
        projects: [
          { id: 1, name: 'Project A', status: 'active' },
          { id: 2, name: 'Project B', status: 'completed' },
        ],
      }
      const result = stringify(data)

      expect(result.content).toBeDefined()
      expect(result.format).toBe('toon')
      expect(result.toonSize).toBeGreaterThan(0)
    })

    test('calcula tokens ahorrados correctamente', () => {
      const data = {
        success: true,
        data: {
          emails: [
            { id: '1', from: 'alice@example.com', subject: 'Hello' },
            { id: '2', from: 'bob@example.com', subject: 'World' },
          ],
        },
      }
      const result = stringify(data)

      // savingsPercent debería ser >= 0 (usamos Math.max)
      expect(result.savingsPercent).toBeGreaterThanOrEqual(0)
      expect(result.tokensSaved).toBeGreaterThanOrEqual(0)
    })

    test('calcula costo USD con modelo', () => {
      const data = { message: 'Hello World', count: 42 }
      const result = stringify(data, 'gemini-2.0-flash-exp')

      expect(result.costSaved).toBeGreaterThanOrEqual(0)

      // Si hay ahorro de tokens, debería haber ahorro de costo
      if (result.tokensSaved > 0) {
        expect(result.costSaved).toBeGreaterThan(0)
      }
    })

    test('maneja arrays grandes', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random(),
      }))
      const result = stringify(data)

      expect(result.content).toBeDefined()
      expect(result.format).toBe('toon')
    })

    test('maneja objetos vacíos', () => {
      const result = stringify({})

      expect(result.content).toBeDefined()
      expect(result.format).toBe('toon')
    })

    test('maneja valores null y undefined', () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        stringValue: 'test',
      }
      const result = stringify(data)

      expect(result.content).toBeDefined()
      expect(result.format).toBe('toon')
    })

    test('maneja primitivos', () => {
      expect(stringify('hello').content).toBeDefined()
      expect(stringify(42).content).toBeDefined()
      expect(stringify(true).content).toBeDefined()
      expect(stringify(null).content).toBeDefined()
    })
  })

  describe('formatToolResult()', () => {
    test('formatea resultado de herramienta', () => {
      const toolResult = {
        success: true,
        data: { items: [1, 2, 3] },
        timestamp: new Date().toISOString(),
      }
      const result = formatToolResult(toolResult, 'gpt-4o-mini')

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    test('formatea error de herramienta', () => {
      const errorResult = {
        error: true,
        tool: 'test_tool',
        message: 'Something went wrong',
        timestamp: new Date().toISOString(),
      }
      const result = formatToolResult(errorResult)

      expect(typeof result).toBe('string')
      expect(result).toContain('error')
    })

    test('maneja resultado sin modelo', () => {
      const result = formatToolResult({ data: 'test' })

      expect(typeof result).toBe('string')
    })
  })

  describe('formatMCPResponse()', () => {
    test('formatea respuesta MCP', () => {
      const mcpResponse = {
        content: [
          { type: 'text', text: 'Hello from MCP' },
        ],
        isError: false,
      }
      const result = formatMCPResponse(mcpResponse, 'gemini-2.0-flash-exp')

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    test('formatea lista de herramientas MCP', () => {
      const toolsResponse = {
        tools: [
          {
            name: 'search_web',
            description: 'Search the web',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          },
          {
            name: 'send_email',
            description: 'Send an email',
            inputSchema: { type: 'object', properties: { to: { type: 'string' } } },
          },
        ],
      }
      const result = formatMCPResponse(toolsResponse)

      expect(typeof result).toBe('string')
    })
  })

  describe('formatSkillOutput()', () => {
    test('formatea output de skill', () => {
      const skillOutput = {
        skill: 'pdf',
        result: { pages: 10, text: 'Extracted text...' },
      }
      const result = formatSkillOutput(skillOutput, 'claude-3-5-sonnet')

      expect(typeof result).toBe('string')
    })
  })

  describe('formatContext()', () => {
    test('formatea contexto del agente', () => {
      const contextData = {
        ethics: ['Be helpful', 'Be honest'],
        notes: { key1: 'value1', key2: 'value2' },
        projects: { active: 3, completed: 10 },
      }
      const result = formatContext(contextData)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    test('formatea scratchpad data', () => {
      const scratchpadData = {
        currentTask: 'Research hotels',
        lastStep: 'Searched Google',
        nextStep: 'Compare prices',
      }
      const result = formatContext(scratchpadData)

      expect(typeof result).toBe('string')
    })
  })

  describe('estimateTokens()', () => {
    test('estima tokens para texto vacío', () => {
      expect(estimateTokens('')).toBe(0)
    })

    test('estima tokens para texto corto', () => {
      expect(estimateTokens('Hello World')).toBe(3) // ceil(11/4) = 3
    })

    test('estima tokens para texto largo', () => {
      const text = 'A'.repeat(1000)
      expect(estimateTokens(text)).toBe(250) // 1000/4 = 250
    })

    test('estima tokens para JSON', () => {
      const json = JSON.stringify({ name: 'test', value: 42 })
      expect(estimateTokens(json)).toBeGreaterThan(0)
    })
  })

  describe('getCompressionAnalysis()', () => {
    test('retorna análisis de compresión completo', () => {
      const data = {
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
        metadata: {
          total: 2,
          page: 1,
        },
      }
      const analysis = getCompressionAnalysis(data)

      expect(analysis).toBeDefined()
      expect(analysis.jsonBytes).toBeGreaterThan(0)
      expect(analysis.toonBytes).toBeGreaterThan(0)
      expect(analysis.jsonTokens).toBeGreaterThan(0)
      expect(analysis.toonTokens).toBeGreaterThan(0)
      expect(typeof analysis.savedTokens).toBe('number')
      expect(typeof analysis.savedPercent).toBe('number')
      expect(typeof analysis.savedTokensPercent).toBe('number')
      expect(typeof analysis.savedBytes).toBe('number')
    })

    test('muestra ahorro significativo en datos estructurados', () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
      }))
      const analysis = getCompressionAnalysis(data)

      // En datos estructurados grandes, TOON debería ahorrar
      expect(analysis.savedTokens).toBeGreaterThan(0)
      expect(analysis.savedPercent).toBeGreaterThan(0)
    })
  })

  describe('withToonFormat()', () => {
    test('formatea resultado de función asíncrona', async () => {
      const mockFn = async () => ({ result: 'success', data: [1, 2, 3] })
      const result = await withToonFormat('test_tool', mockFn, 'gpt-4o')

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    test('maneja error de función asíncrona', async () => {
      const mockFn = async () => {
        throw new Error('Test error')
      }
      const result = await withToonFormat('failing_tool', mockFn)

      expect(typeof result).toBe('string')
      expect(result).toContain('error')
      expect(result).toContain('Test error')
    })

    test('registra duración de ejecución', async () => {
      const mockFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { done: true }
      }
      const result = await withToonFormat('slow_tool', mockFn)

      expect(typeof result).toBe('string')
    })
  })

  describe('Integration: Real-world scenarios', () => {
    test('simula flujo real: tool result → LLM message', () => {
      // 1. Tool ejecuta y retorna dato
      const toolResult = {
        success: true,
        url: 'https://example.com',
        content: 'Page content here',
        statusCode: 200,
      }

      // 2. Formatear para LLM
      const formattedForLLM = formatToolResult(toolResult, 'gpt-4o-mini')

      // 3. Verificar formato
      expect(typeof formattedForLLM).toBe('string')
      expect(formattedForLLM.length).toBeGreaterThan(0)
    })

    test('simula respuesta MCP compleja', () => {
      const mcpResponse = {
        content: [
          {
            type: 'text',
            text: 'Found 5 emails',
          },
          {
            type: 'json',
            data: {
              emails: [
                { id: '1', from: 'a@b.com', subject: 'Test 1' },
                { id: '2', from: 'c@d.com', subject: 'Test 2' },
              ],
            },
          },
        ],
        metadata: {
          server: 'gmail',
          timestamp: new Date().toISOString(),
        },
      }

      const formatted = formatMCPResponse(mcpResponse)

      expect(typeof formatted).toBe('string')
      expect(formatted.length).toBeGreaterThan(0)
    })

    test('comparación JSON vs TOON en datos típicos', () => {
      const typicalData = {
        agent: {
          id: 'coordinator',
          name: 'Main Agent',
          status: 'thinking',
        },
        conversation: {
          threadId: 'thread-123',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
          ],
        },
        tools: [
          { name: 'search', status: 'available' },
          { name: 'browser', status: 'busy' },
        ],
      }

      const jsonSize = JSON.stringify(typicalData).length
      const toonResult = stringify(typicalData)

      expect(toonResult.originalSize).toBe(jsonSize)
      expect(toonResult.toonSize).toBeGreaterThan(0)
      expect(toonResult.savingsPercent).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Performance', () => {
    test('stringify es rápido para objetos pequeños', () => {
      const data = { key: 'value', num: 42 }
      const start = performance.now()
      stringify(data)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(10) // < 10ms
    })

    test('stringify es razonable para objetos grandes', () => {
      const data = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
      }))

      const start = performance.now()
      stringify(data)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(100) // < 100ms
    })
  })
})
