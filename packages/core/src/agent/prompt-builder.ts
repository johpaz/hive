/**
 * Prompt Builder — Construye el system prompt con la jerarquía constitucional.
 *
 * Orden de ensamblaje:
 * 1. ÉTICA (capa constitucional, siempre completa, inmutable)
 * 2. IDENTIDAD DEL AGENTE (de la tabla agents)
 * 3. HIVE ECOSYSTEM (system prompt directo para el coordinador)
 * 4. IDENTIDAD DEL USUARIO (de la tabla users)
 *
 * El Context Compiler agrega después:
 * - Playbook rules (ACE)
 * - Scratchpad notes
 * - Skills activos
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import { formatContext } from "../utils/toon"
import { resolveUserId } from "../storage/onboarding"

const log = logger.child("prompt-builder")

export interface BuildSystemPromptOpts {
  agentId: string
  userId: string
}

/**
 * Construye el system prompt completo para un agente.
 *
 * Jerarquía:
 * 1. Ética (siempre completa, no se filtra, no se comprime)
 * 2. Identidad del agente (role, description, system_prompt)
 * 3. Hive Ecosystem (ya incluido en agents.system_prompt desde onboarding.ts)
 * 4. Identidad del usuario (nombre, preferencias, contexto)
 */
export async function buildSystemPrompt(opts: BuildSystemPromptOpts): Promise<string> {
  const db = getDb()
  const { agentId, userId } = opts

  // ──────────────────────────────────────────────────────────────────────────
  // 1. ÉTICA — Capa constitucional (siempre completa)
  // ──────────────────────────────────────────────────────────────────────────
  const ethicsRules = db.query<any, []>(`
    SELECT name, content, description
    FROM ethics
    WHERE enabled = 1 AND active = 1
    ORDER BY is_default DESC, id ASC
  `).all()

  let ethicsSection = ""
  if (ethicsRules.length > 0) {
    const ethicsContent = ethicsRules.map((rule: any) => {
      return `## ${rule.name}\n${rule.content}`
    }).join("\n\n")

    ethicsSection = `# ÉTICA Y REGLAS CONSTITUCIONALES\n\n${ethicsContent}\n\n`
    log.info(`[prompt-builder] Loaded ${ethicsRules.length} ethics rules`)
  } else {
    // Ética por defecto si no hay reglas configuradas
    ethicsSection = `# ÉTICA Y REGLAS CONSTITUCIONALES\n\n` +
      `- Sé útil, inofensivo y honesto\n` +
      `- No generes contenido dañino, ilegal o peligroso\n` +
      `- Respeta la privacidad y seguridad del usuario\n` +
      `- Si no sabes algo, admítelo\n\n`
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. IDENTIDAD DEL AGENTE
  // ──────────────────────────────────────────────────────────────────────────
  const agent = db.query<any, [string]>(`
    SELECT id, name, role, description, system_prompt, tone, max_iterations, workspace
    FROM agents
    WHERE id = ?
  `).get(agentId)

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  let agentSection = `# IDENTIDAD DEL AGENTE\n\n`
  agentSection += `**Nombre**: ${agent.name}\n`
  agentSection += `**Rol**: ${agent.role}\n`

  if (agent.description) {
    agentSection += `**Descripción**: ${agent.description}\n`
  }

  if (agent.tone) {
    agentSection += `**Tono**: ${agent.tone}\n`
  }

  agentSection += `**Iteraciones máximas**: ${agent.max_iterations}\n\n`

  // Workspace configuration
  const workspacePath = agent.workspace || null
  if (workspacePath) {
    agentSection += `# WORKSPACE — ESPACIO DE TRABAJO EXCLUSIVO\n\n`
    agentSection += `**Tu directorio de trabajo es**: \`${workspacePath}\`\n\n`
    agentSection += `## REGLAS OBLIGATORIAS (no negociables)\n\n`
    agentSection += `1. **TODAS** tus operaciones de archivos y comandos ocurren DENTRO de \`${workspacePath}\`. Sin excepciones.\n`
    agentSection += `2. Cuando el sistema te pida listar archivos, explorar, leer o escribir — hazlo SIEMPRE dentro de \`${workspacePath}\`.\n`
    agentSection += `3. Nunca uses \`ls\`, \`find\`, \`cat\` u otras herramientas apuntando a directorios del sistema (\`/\`, \`~\`, \`/home\`, \`/etc\`, etc.).\n`
    agentSection += `4. Cuando uses \`cli_exec\`, el directorio de trabajo ya es \`${workspacePath}\` por defecto — NO necesitas especificar \`cwd\`.\n`
    agentSection += `5. Para rutas relativas, son relativas a \`${workspacePath}\` — no al directorio del proceso.\n`
    agentSection += `6. Si el usuario pide explorar "el proyecto" o "los archivos", asume que se refiere a \`${workspacePath}\`.\n`
    agentSection += `7. Las tools de filesystem (\`fs_read\`, \`fs_write\`, \`fs_list\`, etc.) ya tienen tu workspace configurado — úsalas directamente con rutas relativas.\n\n`
    agentSection += `> IMPORTANTE: Cualquier intento de acceder fuera de \`${workspacePath}\` será bloqueado automáticamente por el sistema.\n\n`
    agentSection += `## CONSULTAS EN MCP, para llamar datos puedes buscar las tools por get o list recors\n\n`

  }

  // System prompt específico del agente (su "personalidad" especializada)
  if (agent.system_prompt) {
    agentSection += `## System Prompt\n\n${agent.system_prompt}\n\n`
  }


  // ──────────────────────────────────────────────────────────────────────────
  // 3. IDENTIDAD DEL USUARIO
  // ──────────────────────────────────────────────────────────────────────────
  const user = db.query<any, [string]>(`
    SELECT id, name, language,  timezone, occupation, notes
    FROM users
    WHERE id = ?
  `).get(userId)

  let userSection = `# IDENTIDAD DEL USUARIO\n\n`

  if (user) {
    const userData: Record<string, string | null> = {}

    if (user.name) userData.Nombre = user.name
    if (user.language) userData.Idioma = user.language
    if (user.timezone) userData.ZonaHoraria = user.timezone
    if (user.occupation) userData.Ocupación = user.occupation
    if (user.notes) userData.Notes = user.notes

    // Usar TOON para comprimir datos del usuario
    if (Object.keys(userData).length > 0) {
      userSection += formatContext(userData) + "\n\n"
    } else {
      userSection += `Usuario ID: ${userId}\n\n`
    }
  } else {
    userSection += `Usuario ID: ${userId}\n\n`
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Ensamblar secciones en orden
  // ──────────────────────────────────────────────────────────────────────────
  const systemPrompt = `${ethicsSection}${agentSection}${userSection}`.trim()

  log.info(`[prompt-builder] Built system prompt for agent=${agent.name} role=${agent.role}`)

  return systemPrompt
}

/**
 * Versión simplificada para cuando solo se necesita el agentId
 * (usa userId por defecto de env o threadId)
 */
export async function buildSystemPromptWithProjects(opts: {
  agentId: string
  userId?: string
}): Promise<string> {
  const userId = opts.userId || resolveUserId({}) || "default"
  return buildSystemPrompt({ agentId: opts.agentId, userId })
}
