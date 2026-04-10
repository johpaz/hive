/**
 * Registry de los 17 agentes del enjambre HiveLearn:
 *   1 coordinador (hl-coordinator-agent, role='coordinator')
 *  16 workers especializados (role='worker')
 *
 * Se insertan en la tabla `agents` al inicializar con ON CONFLICT DO UPDATE,
 * preservando la selección de provider/modelo que el usuario haya configurado.
 */
import type { Database } from 'bun:sqlite'
const HIVELEARN_PROVIDER_ID = 'ollama'
const HIVELEARN_MODEL_ID = 'gemma4-e4b'
import { COORDINATOR_PROMPT } from './coordinator.prompt'
import { PROFILE_PROMPT } from './prompts/profile.prompt'
import { INTENT_PROMPT } from './prompts/intent.prompt'
import { STRUCTURE_PROMPT } from './prompts/structure.prompt'
import { EXPLANATION_PROMPT } from './prompts/explanation.prompt'
import { EXERCISE_PROMPT } from './prompts/exercise.prompt'
import { QUIZ_PROMPT } from './prompts/quiz.prompt'
import { CHALLENGE_PROMPT } from './prompts/challenge.prompt'
import { CODE_PROMPT } from './prompts/code.prompt'
import { SVG_PROMPT } from './prompts/svg.prompt'
import { GIF_PROMPT } from './prompts/gif.prompt'
import { INFOGRAPHIC_PROMPT } from './prompts/infographic.prompt'
import { GAMIFICATION_PROMPT } from './prompts/gamification.prompt'
import { EVALUATION_PROMPT } from './prompts/evaluation.prompt'
import { FEEDBACK_PROMPT } from './prompts/feedback.prompt'
import { AUDIO_PROMPT } from './prompts/audio.prompt'

export const AGENT_IDS = {
  coordinator: 'hl-coordinator-agent',
  profile: 'hl-profile-agent',
  intent: 'hl-intent-agent',
  structure: 'hl-structure-agent',
  explanation: 'hl-explanation-agent',
  exercise: 'hl-exercise-agent',
  quiz: 'hl-quiz-agent',
  challenge: 'hl-challenge-agent',
  code: 'hl-code-agent',
  svg: 'hl-svg-agent',
  gif: 'hl-gif-agent',
  infographic: 'hl-infographic-agent',
  image: 'hl-image-agent',
  audio: 'hl-audio-agent',
  gamification: 'hl-gamification-agent',
  evaluation: 'hl-evaluation-agent',
  feedback: 'hl-feedback-agent',
} as const

interface AgentDef {
  id: string
  name: string
  description: string
  systemPrompt: string
  maxIterations: number
}

const HIVELEARN_AGENTS: AgentDef[] = [
  { id: AGENT_IDS.coordinator, name: 'HiveLearnCoordinator', description: 'Coordina el enjambre educativo completo', systemPrompt: COORDINATOR_PROMPT, maxIterations: 10 },
  { id: AGENT_IDS.profile, name: 'ProfileAgent', description: 'Construye el perfil de adaptación del alumno', systemPrompt: PROFILE_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.intent, name: 'IntentAgent', description: 'Extrae tema, nivel y tono de la meta del alumno', systemPrompt: INTENT_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.structure, name: 'StructureAgent', description: 'Diseña el esqueleto completo del programa de estudio', systemPrompt: STRUCTURE_PROMPT, maxIterations: 10 },
  { id: AGENT_IDS.explanation, name: 'ExplanationAgent', description: 'Genera explicaciones de conceptos (máx 70 palabras)', systemPrompt: EXPLANATION_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.exercise, name: 'ExerciseAgent', description: 'Crea ejercicios prácticos con pistas', systemPrompt: EXERCISE_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.quiz, name: 'QuizAgent', description: 'Genera preguntas de quiz con 4 opciones', systemPrompt: QUIZ_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.challenge, name: 'ChallengeAgent', description: 'Diseña retos prácticos con pasos y criterios', systemPrompt: CHALLENGE_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.code, name: 'CodeAgent', description: 'Genera bloques de código (máx 15 líneas)', systemPrompt: CODE_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.svg, name: 'SVGAgent', description: 'Genera diagramas SVG educativos (400x300)', systemPrompt: SVG_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.gif, name: 'GifAgent', description: 'Genera frames de animación (5-8 frames)', systemPrompt: GIF_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.infographic, name: 'InfographicAgent', description: 'Crea infografías con 3-5 secciones de datos clave', systemPrompt: INFOGRAPHIC_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.image, name: 'ImageAgent', description: 'Genera imágenes educativas o SVG descriptivo fallback', systemPrompt: `Eres ImageAgent de HiveLearn. Genera una imagen educativa para el concepto indicado usando la tool generar_imagen. Si no puedes generar una imagen real, crea un SVG representativo detallado como fallback. El SVG debe ser educativo y claro (400x300px). Responde SOLO con una tool call.`, maxIterations: 3 },
  { id: AGENT_IDS.gamification, name: 'GamificationAgent', description: 'Asigna XP, logros y gamificación adaptada por edad', systemPrompt: GAMIFICATION_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.evaluation, name: 'EvaluationAgent', description: 'Genera 5 preguntas de evaluación final', systemPrompt: EVALUATION_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.feedback, name: 'FeedbackAgent', description: 'Feedback motivador on-demand por respuesta del alumno', systemPrompt: FEEDBACK_PROMPT, maxIterations: 3 },
  { id: AGENT_IDS.audio, name: 'AudioAgent', description: 'Genera script de narración educativa (Web Speech API)', systemPrompt: AUDIO_PROMPT, maxIterations: 3 },
]

export function registerHiveLearnAgents(db: Database): void {
  const insertWorker = db.prepare(`
    INSERT INTO hl_agents (id, name, description, system_prompt, role, provider_id, model_id, max_iterations, tools_json, enabled)
    VALUES (?, ?, ?, ?, 'worker', ?, ?, ?, '[]', 1)
    ON CONFLICT(id) DO UPDATE SET
      name          = excluded.name,
      description   = excluded.description,
      system_prompt = excluded.system_prompt,
      max_iterations= excluded.max_iterations,
      provider_id   = COALESCE(hl_agents.provider_id, excluded.provider_id),
      model_id      = COALESCE(hl_agents.model_id, excluded.model_id),
      updated_at    = CURRENT_TIMESTAMP
  `)

  const insertCoordinator = db.prepare(`
    INSERT INTO hl_agents (id, name, description, system_prompt, role, provider_id, model_id, max_iterations, tools_json, enabled)
    VALUES (?, ?, ?, ?, 'coordinator', ?, ?, ?, '[]', 1)
    ON CONFLICT(id) DO UPDATE SET
      name          = excluded.name,
      description   = excluded.description,
      system_prompt = excluded.system_prompt,
      max_iterations= excluded.max_iterations,
      provider_id   = COALESCE(hl_agents.provider_id, excluded.provider_id),
      model_id      = COALESCE(hl_agents.model_id, excluded.model_id),
      updated_at    = CURRENT_TIMESTAMP
  `)

  const tx = db.transaction(() => {
    // Insertar coordinador
    insertCoordinator.run(
      AGENT_IDS.coordinator,
      'HiveLearnCoordinator',
      'Coordina el enjambre educativo completo',
      COORDINATOR_PROMPT,
      HIVELEARN_PROVIDER_ID,
      HIVELEARN_MODEL_ID,
      10,
    )

    // Insertar 16 agentes workers
    for (const agent of HIVELEARN_AGENTS) {
      if (agent.id === AGENT_IDS.coordinator) continue
      insertWorker.run(
        agent.id,
        agent.name,
        agent.description,
        agent.systemPrompt,
        HIVELEARN_PROVIDER_ID,
        HIVELEARN_MODEL_ID,
        agent.maxIterations,
      )
    }
  })
  tx()
}

/**
 * Actualiza todos los agentes de HiveLearn con el provider_id y model_id seleccionados.
 * Esto permite que el enjambre use el provider/modelo que el usuario eligió.
 */
export function updateHiveLearnAgentsProviderModel(
  db: Database,
  providerId: string,
  modelId: string
): void {
  // Incluir los 15 agentes (coordinador + 14 workers)
  const allAgentIds = Object.values(AGENT_IDS)
  const stmt = db.prepare(`
    UPDATE hl_agents
    SET provider_id = ?, model_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${allAgentIds.map(() => '?').join(', ')})
  `)

  const tx = db.transaction(() => {
    stmt.run(providerId, modelId, ...allAgentIds)
  })
  tx()
}

export { HIVELEARN_AGENTS }
