/**
 * @johpaz/hive-sdk/hivelearn
 *
 * Sub-módulo que expone el enjambre HiveLearn para integraciones enterprise.
 * Permite a agencias desplegar módulos de capacitación IA personalizados.
 *
 * Uso:
 *   import { runHiveLearnSession, LessonPersistence } from '@johpaz/hive-sdk/hivelearn'
 */
export {
  HiveLearnSwarm,
  runHiveLearnSession,
  LessonPersistence,
  evaluarRespuestas,
  calificarEvaluacionTool,
  calificarRespuestaTool,
  AGENT_IDS,
  updateHiveLearnAgentsProviderModel,
  hlSwarmEmitter,
  nodeCache,
  cacheInvalidator,
} from '@johpaz/hivelearn'

export type {
  StudentProfile,
  LessonProgram,
  SwarmProgress,
  NodoLesson,
  NodoContenido,
  MicroEvaluacion,
  FeedbackOutput,
  EvaluacionOutput,
  PreguntaEvaluacion,
  GamificacionOutput,
  Logro,
  RangoEdad,
  TipoPedagogico,
  TipoVisual,
  EstadoNodo,
  CalificacionOutput,
  CalificacionInput,
  SessionData,
} from '@johpaz/hivelearn'
