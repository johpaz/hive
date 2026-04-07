export { disenarEstructuraTool } from './canvas/disenar-estructura.tool'
export { poblarNodoTool } from './canvas/poblar-nodo.tool'
// avanzar-nodo, conectar-nodos, crear-nodo-canvas, marcar-completado — sin uso en tool-map, omitidos

export { generarExplicacionTool } from './content/generar-explicacion.tool'
export { generarEjercicioTool } from './content/generar-ejercicio.tool'
export { generarQuizTool } from './content/generar-quiz.tool'
export { generarRetoTool } from './content/generar-reto.tool'
export { generarCodigoTool } from './content/generar-codigo.tool'
export { generarSvgTool } from './content/generar-svg.tool'
export { generarFramesGifTool } from './content/generar-frames-gif.tool'
export { generarInfografiaTool } from './content/generar-infografia.tool'

export { generarEvaluacionTool } from './evaluation/generar-evaluacion.tool'
export { calificarEvaluacionTool, calificarRespuestaTool } from './evaluation/calificar-evaluacion.tool'
export { generarImagenTool } from './content/generar-imagen.tool'

export { clasificarIntencionTool } from './profile/clasificar-intencion.tool'

export { buscarCurriculoExistenteTool } from './search/buscar-curriculo-existente.tool'
export { buscarEnHiveLearnTool } from './search/buscar-en-hivelearn.tool'

export { revisarProgramaTool } from './coordinator/revisar-programa.tool'
export { delegarEnjambreTool } from './coordinator/delegar-enjambre.tool'

// ─── LLMToolDef groups por rol de agente ─────────────────────────────────────

import type { LLMToolDef, Tool } from '../types/tool'
import { clasificarIntencionTool } from './profile/clasificar-intencion.tool'
import { buscarCurriculoExistenteTool } from './search/buscar-curriculo-existente.tool'
import { buscarEnHiveLearnTool } from './search/buscar-en-hivelearn.tool'
import { disenarEstructuraTool } from './canvas/disenar-estructura.tool'
import { poblarNodoTool } from './canvas/poblar-nodo.tool'
import { generarExplicacionTool } from './content/generar-explicacion.tool'
import { generarEjercicioTool } from './content/generar-ejercicio.tool'
import { generarQuizTool } from './content/generar-quiz.tool'
import { generarRetoTool } from './content/generar-reto.tool'
import { generarCodigoTool } from './content/generar-codigo.tool'
import { generarSvgTool } from './content/generar-svg.tool'
import { generarFramesGifTool } from './content/generar-frames-gif.tool'
import { generarInfografiaTool } from './content/generar-infografia.tool'
import { generarEvaluacionTool } from './evaluation/generar-evaluacion.tool'
import { calificarEvaluacionTool } from './evaluation/calificar-evaluacion.tool'

function toToolDef(t: Tool): LLMToolDef {
  return { type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters as Record<string, unknown> } }
}

export const PROFILE_TOOLS: LLMToolDef[] = [clasificarIntencionTool, buscarCurriculoExistenteTool].map(toToolDef)
export const INTENT_TOOLS: LLMToolDef[] = [clasificarIntencionTool, buscarEnHiveLearnTool].map(toToolDef)
export const STRUCTURE_TOOLS: LLMToolDef[] = [disenarEstructuraTool, buscarCurriculoExistenteTool].map(toToolDef)
export const CONTENT_TOOLS: LLMToolDef[] = [generarExplicacionTool, generarEjercicioTool, generarQuizTool, generarRetoTool, poblarNodoTool].map(toToolDef)
export const VISUAL_TOOLS: LLMToolDef[] = [generarCodigoTool, generarSvgTool, generarFramesGifTool, generarInfografiaTool].map(toToolDef)
export const EVALUATION_TOOLS: LLMToolDef[] = [generarEvaluacionTool, calificarEvaluacionTool].map(toToolDef)
export const GAMIFICATION_TOOLS: LLMToolDef[] = [] // genera JSON libre, sin tool calls
