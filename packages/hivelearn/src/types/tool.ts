/**
 * HiveLearn — Tool types (local copy, no core dependency)
 */

export interface Tool {
  name: string
  description: string
  parameters: Record<string, any>
  execute?: (params: Record<string, unknown>, config?: any) => Promise<string | object>
}

export interface LLMToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}
