/**
 * AgentService — Wrapper del nuevo agent-loop nativo.
 * 
 * Reemplaza la clase Agent legacy.
 * Mantiene compatibilidad con server.ts pero usa el agent-loop nativo por debajo.
 * 
 * Responsabilidades:
 * - Cargar agente desde DB
 * - Cargar ética desde DB
 * - Obtener MCP Manager
 * - Hot reload (MCP, skills, ethics)
 * - Eventos (cron, etc.)
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import { buildSystemPromptWithProjects } from "./prompt-builder"
import { getAgentLoop, rebuildAgentLoop } from "./agent-loop"
import type { MCPClientManager } from "@johpaz/hive-agents-mcp"
import { resolveAgentId, resolveUserId } from "../storage/onboarding"
import { getMCPManager as getSingletonMCPManager } from "../mcp/singleton"
import type { ContentPart } from "./llm-client"

const log = logger.child("agent-service")

// Event handler types
type CronHandler = (sessionId: string, task: string, jobId?: string, context?: any) => Promise<void>

export interface AgentServiceConfig {
  agentId?: string
  workspacePath?: string
}

export interface AgentDBRecord {
  id: string
  user_id: string
  name: string
  description: string | null
  system_prompt: string | null
  tone: string | null
  role: string
  status: string
  enabled: number
  provider_id: string
  model_id: string
  tools_json: string | null
  skills_json: string | null
  parent_id: string | null
  max_iterations: number
  headers_encrypted: string | null
  headers_iv: string | null
  created_at: number
  updated_at: number
}

export class AgentService {
  private agentId: string
  private workspacePath: string
  private mcpManager: MCPClientManager | null = null
  private cronHandlers: CronHandler[] = []
  private initialized: boolean = false

  constructor(config?: AgentServiceConfig) {
    // Resolve agentId from database if not provided
    this.agentId = config?.agentId || resolveAgentId(null) || "main"
    this.workspacePath = config?.workspacePath || ""
  }

  /**
   * Inicializa el servicio del agente
   * - Carga el MCP Manager
   * - Configura el supervisor graph
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.debug("AgentService already initialized")
      return
    }

    try {
      // Obtener MCP Manager del agent loop
      const agentLoop = getAgentLoop()
      if (agentLoop) {
        // MCP Manager se inicializa en el agent-loop
        log.info("AgentService: MCP Manager available from agent-loop")
      }

      this.initialized = true
      log.info(`AgentService initialized for agent=${this.agentId}`)
    } catch (error) {
      log.error(`Failed to initialize AgentService: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Obtiene el registro del agente desde la DB
   */
  async getAgent(agentId?: string): Promise<AgentDBRecord | null> {
    const db = getDb()
    const id = agentId || this.agentId
    
    const agent = db.query<any, [string]>(
      "SELECT * FROM agents WHERE id = ? LIMIT 1"
    ).get(id) as AgentDBRecord | undefined

    return agent || null
  }

  /**
   * Obtiene la ética desde la DB
   */
  async getEthics(): Promise<string> {
    const db = getDb()
    const ethics = db.query<any, []>(
      "SELECT content FROM ethics WHERE active = 1 LIMIT 1"
    ).get() as { content: string } | undefined

    return ethics?.content || ""
  }

  /**
   * Obtiene el MCP Manager
   */
  getMCPManager(): MCPClientManager | null {
    const agentLoop = getAgentLoop()
    if (agentLoop && (agentLoop as any).mcpManager) {
      return (agentLoop as any).mcpManager as MCPClientManager
    }
    // Fallback to singleton
    return getSingletonMCPManager()
  }

  /**
   * Recarga la configuración del MCP
   */
  async reloadMCP(): Promise<void> {
    log.info("Reloading MCP configuration...")
    const mcp = this.getMCPManager()
    if (mcp) {
      await mcp.reconnectAll().catch(err => {
        log.warn(`Failed to reconnect MCP: ${(err as Error).message}`)
      })
    }
    log.info("MCP reloaded")
  }

  /**
   * Recarga los skills desde la DB
   */
  async reloadSkills(): Promise<void> {
    log.info("Reloading skills...")
    const { syncSkillsToFTS } = await import("./context-compiler")
    await syncSkillsToFTS()
    log.info("Skills reloaded")
  }

  /**
   * Recarga la ética desde la DB
   */
  async reloadEthics(): Promise<void> {
    log.info("Reloading ethics...")
    // La ética se carga automáticamente en buildSystemPrompt()
    // No hay acción necesaria aquí
    log.info("Ethics reloaded (will be picked up on next agent call)")
  }

  /**
   * Recarga el soul (system prompt del agente)
   */
  async reloadSoul(): Promise<void> {
    log.info("Reloading soul...")
    // El soul se carga automáticamente desde DB en buildSystemPrompt()
    log.info("Soul reloaded (will be picked up on next agent call)")
  }

  /**
   * Recarga la configuración del usuario
   */
  async reloadUser(): Promise<void> {
    log.info("Reloading user configuration...")
    // La configuración del usuario se carga desde DB en buildSystemPrompt()
    log.info("User configuration reloaded (will be picked up on next agent call)")
  }

  /**
   * Actualiza la configuración del agente
   */
  async updateConfig(config: any): Promise<void> {
    log.info("Updating agent configuration...")
    // La configuración ahora se carga desde DB dinámicamente
    // No hay acción necesaria aquí
    log.info("Configuration updated (will be picked up from DB)")
  }

  /**
   * Recarga el agente (hot reload)
   */
  async reload(): Promise<void> {
    log.info("Reloading agent...")
    await this.reloadMCP()
    await this.reloadSkills()
    await this.reloadEthics()
    log.info("Agent reloaded")
  }

  /**
   * Registra un handler para eventos cron
   */
  on(event: 'cron', handler: CronHandler): void {
    if (event === 'cron') {
      this.cronHandlers.push(handler)
      log.debug(`Registered cron handler, total=${this.cronHandlers.length}`)
    }
  }

  /**
   * Emite un evento cron
   */
  emit(event: 'cron', sessionId: string, task: string, jobId?: string, context?: any): void {
    if (event === 'cron') {
      log.debug(`Emitting cron event: task=${task}, sessionId=${sessionId}, jobId=${jobId}`)
      for (const handler of this.cronHandlers) {
        handler(sessionId, task, jobId, context).catch(err => {
          log.error(`Cron handler error: ${(err as Error).message}`)
        })
      }
    }
  }

  /**
   * Obtiene el system prompt para un agente
   */
  async getSystemPrompt(agentId?: string, userId?: string): Promise<string> {
    const id = agentId || this.agentId
    const uid = userId || resolveUserId({}) || "default"
    return buildSystemPromptWithProjects({ agentId: id, userId: uid })
  }

  /**
   * Ejecuta un agente con un mensaje
   */
  async runAgent(message: string | ContentPart[], threadId: string, userId?: string): Promise<string> {
    const { runAgentIsolated } = await import("./agent-loop")
    const result = await runAgentIsolated({
      agentId: this.agentId,
      taskDescription: message,
      threadId,
    })
    return result
  }
}

// Singleton para compatibilidad
let _agentService: AgentService | null = null

export function getAgentService(): AgentService {
  if (!_agentService) {
    _agentService = new AgentService()
  }
  return _agentService
}

export function createAgentService(config?: AgentServiceConfig): AgentService {
  _agentService = new AgentService(config)
  return _agentService
}
