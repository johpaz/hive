/** Tipos compartidos entre backend y UI de HiveLearn */

export type RangoEdad = 'nino' | 'adolescente' | 'adulto'
export type TipoPedagogico = 'concept' | 'exercise' | 'quiz' | 'challenge' | 'milestone' | 'evaluation'
export type TipoVisual = 'text_card' | 'code_block' | 'svg_diagram' | 'gif_guide' | 'infographic' | 'chart' | 'animated_card' | 'image_ai' | 'audio_ai'
export type TipoPregunta = 'verdadero_falso' | 'multiple_choice' | 'respuesta_corta' | 'completar_codigo'
export type NivelPrevio = 'principiante' | 'principiante_base' | 'intermedio'
export type EstiloAprendizaje = 'visual' | 'lectura' | 'retos' | 'balanceado' | 'mis_retos'
export type EstadoNodo = 'bloqueado' | 'disponible' | 'completado'

// ─── Coordinator & Agent Status ──────────────────────────────────────────────
export type AgentStatus = 'idle' | 'pending' | 'running' | 'thinking' | 'tool_call' | 'completed' | 'failed'
export type CoordinatorStatus = 'idle' | 'analyzing' | 'delegating' | 'assembling' | 'rendering' | 'completed' | 'error'

export interface CoordinatorState {
  status: CoordinatorStatus
  currentWorker: string | null
  activeWorkers: string[]
  totalWorkers: number
}

export interface StudentProfile {
  alumnoId: string
  nombre: string
  edad: number
  rangoEdad: RangoEdad
  tiempoSesion: 15 | 30 | 45
  nivelPrevio: NivelPrevio
  estilo: EstiloAprendizaje
  sesionesTotal: number
  xpAcumulado: number
  nivelActual: string
}

export interface PerfilAdaptacion {
  rangoEdad: RangoEdad
  duracionSesion: number
  nodosRecomendados: number
  estilo: EstiloAprendizaje
  nivelPrevio: NivelPrevio
  tono: string
}

export interface IntentResult {
  tema: string
  nivelDetectado: NivelPrevio
  topicSlug: string | null
  tono: string
  confianza: number
}

export interface NodoLesson {
  id: string
  tipoPedagogico: TipoPedagogico
  tipoVisual: TipoVisual
  titulo: string
  concepto: string
  nivel: NivelPrevio
  rangoEdad: RangoEdad
  posX: number
  posY: number
  estado: EstadoNodo
  xpRecompensa: number
  contenido?: NodoContenido
}

export interface MicroEvaluacion {
  tipo: TipoPregunta
  pregunta: string
  opciones?: string[]
  respuestaCorrecta: string
  pista?: string
}

export interface NodoContenido {
  explicacion?: ExplicacionOutput
  ejercicio?: EjercicioOutput
  quiz?: QuizOutput
  reto?: RetoOutput
  codigo?: CodigoOutput
  svg?: SvgOutput
  gifFrames?: GifOutput
  infografia?: InfografiaOutput
  evaluacion?: EvaluacionOutput
  microEval?: MicroEvaluacion
  imagen?: ImagenOutput
  audio?: AudioOutput
}

export interface ImagenOutput {
  prompt: string
  estilo: 'diagram' | 'illustration' | 'chart'
  alt_text: string
  caption: string
  svg_fallback: string
  url?: string
}

export interface AudioOutput {
  narration_text: string
  voice_tone: 'friendly' | 'professional' | 'motivating'
  key_pauses: string[]
  speed: 'slow' | 'normal' | 'fast'
  title: string
}

export interface ExplicacionOutput {
  titulo: string
  explicacion: string
  ejemploConcreto: string
}

export interface EjercicioOutput {
  enunciado: string
  ejemploRespuesta: string
  respuestaCorrecta: string
  pistaOpcional?: string
}

export interface QuizOutput {
  pregunta: string
  opciones: string[]
  indicesCorrecto: number
  explicacionesIncorrectas: string[]
}

export interface RetoOutput {
  titulo: string
  contexto: string
  pasos: string[]
  criteriosExito: string[]
}

export interface CodigoOutput {
  lenguaje: string
  codigo: string
  descripcionBreve: string
}

export interface SvgOutput {
  svgString: string
}

export interface GifFrame {
  emoji: string
  texto: string
  duracionMs: number
}

export interface GifOutput {
  frames: GifFrame[]
}

export interface InfografiaSeccion {
  emoji: string
  titulo: string
  valor: string
}

export interface InfografiaOutput {
  secciones: InfografiaSeccion[]
}

export interface GamificacionOutput {
  xpRecompensa: number
  logros: Logro[]
  mensajeCelebracion: string
  badge?: string
}

export interface Logro {
  id: string
  nombre: string
  descripcion: string
  emoji: string
  xp: number
}

export interface EvaluacionOutput {
  preguntas: PreguntaEvaluacion[]
}

export interface PreguntaEvaluacion {
  tipo: 'multiple_choice' | 'respuesta_corta'
  pregunta: string
  opciones?: string[]
  indiceCorrecto?: number
  respuestaEsperada?: string
}

export interface FeedbackOutput {
  correcto: boolean
  mensajePrincipal: string
  pistaSiIncorrecto?: string
  xpGanado: number
  razonamiento?: string
}

export interface LessonProgram {
  sessionId: string
  alumnoId: string
  tema: string
  topicSlug: string | null
  rangoEdad: RangoEdad
  nodos: NodoLesson[]
  gamificacion: GamificacionOutput
  evaluacion: EvaluacionOutput
  perfilAdaptacion: PerfilAdaptacion
}

export interface SwarmProgress {
  etapa: string
  agenteActivo: string
  porcentaje: number
  mensaje: string
}
