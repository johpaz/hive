/**
 * Mapeo agentId → herramientas para cada agente HiveLearn.
 *
 * AGENT_EXECUTABLE_TOOLS: Tool[] con execute() — usado por el agent-loop
 *   para ejecutar tools reales y decidir si el output es structured o feed-back.
 *
 * (AGENT_TOOLS con LLMToolDef[] se mantiene como alias para compatibilidad
 *  en caso de que algún sitio todavía lo importe, pero el runner ya usa
 *  AGENT_EXECUTABLE_TOOLS.)
 */
import type { Tool } from '../types/tool'
import { AGENT_IDS } from '../agents/registry'
import {
  // Coordinator
  revisarProgramaTool,
  // Canvas / structured output
  disenarEstructuraTool,
  poblarNodoTool,
  // Content — structured output
  generarExplicacionTool,
  generarEjercicioTool,
  generarQuizTool,
  generarRetoTool,
  generarCodigoTool,
  generarSvgTool,
  generarFramesGifTool,
  generarInfografiaTool,
  generarImagenTool,
  // Evaluation — structured output
  generarEvaluacionTool,
  calificarEvaluacionTool,
  calificarRespuestaTool,
  // Profile — structured output
  clasificarIntencionTool,
  // Search — real execute()
  buscarCurriculoExistenteTool,
  buscarEnHiveLearnTool,
} from '../tools/index'

export const AGENT_EXECUTABLE_TOOLS: Record<string, Tool[]> = {
  [AGENT_IDS.coordinator]: [revisarProgramaTool],
  [AGENT_IDS.profile]:      [clasificarIntencionTool, buscarCurriculoExistenteTool],
  [AGENT_IDS.intent]:       [clasificarIntencionTool, buscarEnHiveLearnTool],
  [AGENT_IDS.structure]:    [disenarEstructuraTool, buscarCurriculoExistenteTool],
  [AGENT_IDS.explanation]:  [generarExplicacionTool, generarEjercicioTool, generarQuizTool, generarRetoTool, poblarNodoTool],
  [AGENT_IDS.exercise]:     [generarExplicacionTool, generarEjercicioTool, generarQuizTool, generarRetoTool, poblarNodoTool],
  [AGENT_IDS.quiz]:         [generarExplicacionTool, generarEjercicioTool, generarQuizTool, generarRetoTool, poblarNodoTool],
  [AGENT_IDS.challenge]:    [generarExplicacionTool, generarEjercicioTool, generarQuizTool, generarRetoTool, poblarNodoTool],
  [AGENT_IDS.code]:         [generarCodigoTool, generarSvgTool, generarFramesGifTool, generarInfografiaTool],
  [AGENT_IDS.svg]:          [generarCodigoTool, generarSvgTool, generarFramesGifTool, generarInfografiaTool],
  [AGENT_IDS.gif]:          [generarCodigoTool, generarSvgTool, generarFramesGifTool, generarInfografiaTool],
  [AGENT_IDS.infographic]:  [generarCodigoTool, generarSvgTool, generarFramesGifTool, generarInfografiaTool],
  [AGENT_IDS.image]:        [generarImagenTool],
  [AGENT_IDS.evaluation]:   [generarEvaluacionTool, calificarEvaluacionTool],
  [AGENT_IDS.gamification]: [],  // genera JSON libre, sin tool calls
  [AGENT_IDS.feedback]:     [calificarRespuestaTool],
}
