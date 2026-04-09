import type { Tool } from '../../types/tool'
import type { FeedbackOutput, PreguntaEvaluacion } from '../../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Similitud por palabras clave: ratio de tokens de respuestaEsperada presentes en respuestaAlumno */
function similaridadTexto(esperada: string, alumno: string): number {
  if (!esperada || !alumno) return 0
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-záéíóúñü0-9\s]/g, '').trim()
  const tokensEsperados = normalize(esperada).split(/\s+/).filter(t => t.length > 3)
  const textoAlumno = normalize(alumno)
  if (tokensEsperados.length === 0) return textoAlumno.length > 5 ? 0.6 : 0
  const coincidencias = tokensEsperados.filter(t => textoAlumno.includes(t)).length
  return coincidencias / tokensEsperados.length
}

export interface CalificacionInput {
  preguntas: PreguntaEvaluacion[]
  respuestasAlumno: Array<string | number>
}

export interface CalificacionOutput {
  puntaje: number
  correctas: number
  total: number
  feedback: FeedbackOutput[]
}

/**
 * Evalúa directamente las respuestas del alumno sin necesitar un agente LLM.
 * - multiple_choice: compara índice seleccionado con indiceCorrecto
 * - respuesta_corta: similitud de palabras clave (umbral 0.5)
 */
export function evaluarRespuestas(input: CalificacionInput): CalificacionOutput {
  const { preguntas, respuestasAlumno } = input
  const feedback: FeedbackOutput[] = []
  let correctas = 0

  for (let i = 0; i < preguntas.length; i++) {
    const pregunta = preguntas[i]
    const respuesta = respuestasAlumno[i]

    if (pregunta.tipo === 'multiple_choice') {
      const selectedIdx = typeof respuesta === 'number' ? respuesta : parseInt(String(respuesta), 10)
      const esCorrecta = selectedIdx === pregunta.indiceCorrecto
      if (esCorrecta) correctas++
      feedback.push({
        correcto: esCorrecta,
        mensajePrincipal: esCorrecta
          ? '¡Correcto! Bien hecho.'
          : `Incorrecto. La respuesta correcta era: "${pregunta.opciones?.[pregunta.indiceCorrecto ?? 0] ?? ''}"`,
        xpGanado: esCorrecta ? 20 : 0,
        razonamiento: esCorrecta ? 'Seleccionaste la opción correcta.' : 'La opción seleccionada no era la correcta.',
      })
    } else {
      // respuesta_corta
      const respuestaTexto = String(respuesta ?? '')
      const esperada = pregunta.respuestaEsperada ?? ''
      const sim = similaridadTexto(esperada, respuestaTexto)
      const esCorrecta = sim >= 0.5
      if (esCorrecta) correctas++
      feedback.push({
        correcto: esCorrecta,
        mensajePrincipal: esCorrecta
          ? '¡Muy bien! Captaste la idea principal.'
          : 'Tu respuesta no captura los conceptos clave.',
        pistaSiIncorrecto: esCorrecta ? undefined : `Piensa en: "${esperada.slice(0, 80)}..."`,
        xpGanado: esCorrecta ? 20 : sim >= 0.3 ? 10 : 0,
        razonamiento: `Similitud semántica: ${Math.round(sim * 100)}%`,
      })
    }
  }

  const puntaje = preguntas.length > 0 ? Math.round((correctas / preguntas.length) * 100) : 0

  return { puntaje, correctas, total: preguntas.length, feedback }
}

// ─── Tools para agentes ──────────────────────────────────────────────────────

export const calificarEvaluacionTool: Tool = {
  name: 'calificar_evaluacion',
  description: 'Califica las respuestas del alumno y genera feedback de cierre',
  parameters: {
    type: 'object',
    properties: {
      puntaje: { type: 'number', description: 'Puntaje 0-100' },
      preguntas_correctas: { type: 'number' },
      total_preguntas: { type: 'number' },
      mensaje_cierre: { type: 'string', description: 'Mensaje motivacional de cierre en español' },
      logros_desbloqueados: { type: 'array', items: { type: 'string' }, description: 'IDs de logros desbloqueados' },
      xp_ganado: { type: 'number' },
      razonamiento: { type: 'string', description: 'Resumen de puntos fuertes y débiles detectados' },
    },
    required: ['puntaje', 'preguntas_correctas', 'total_preguntas', 'mensaje_cierre', 'xp_ganado'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}

export const calificarRespuestaTool: Tool = {
  name: 'calificar_respuesta',
  description: 'Evalúa si el alumno comprende el concepto. Juzga comprensión semántica, no exactitud literal.',
  parameters: {
    type: 'object',
    properties: {
      correcto: { type: 'boolean', description: '¿El alumno captó la idea principal?' },
      xp_ganado: { type: 'number', description: 'XP ganado: 20 si correcto, 5 si parcial, 0 si incorrecto' },
      mensaje: { type: 'string', description: 'Feedback motivador en español (1-2 frases)' },
      razonamiento: { type: 'string', description: 'Por qué se considera correcto o incorrecto' },
      pista_si_incorrecto: { type: 'string', description: 'Pista para guiar al alumno si falló' },
    },
    required: ['correcto', 'xp_ganado', 'mensaje', 'razonamiento'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
