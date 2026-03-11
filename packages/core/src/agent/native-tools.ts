/**
 * Native Tools Type Definitions
 * 
 * Tool interface for native Hive tools (no LangChain)
 */

export interface Tool {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, ToolParameter>
    required?: string[]
  }
  execute: (params: Record<string, unknown>, config?: any) => Promise<string | object>
}

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolResult {
  success: boolean
  result?: any
  error?: string
}
