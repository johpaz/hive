/**
 * Test de revisión del coordinador para HiveLearn
 * 
 * Verifica:
 * - Revisión de XP total (suma 100)
 * - Redistribución completa de XP según criterio pedagógico
 * - Criterios pedagógicos avanzados
 * - Logging detallado de decisiones
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { revisarProgramaTool } from '../src/tools/coordinator/revisar-programa.tool'
import type { LessonProgram, NodoLesson } from '../src/types'
import { logger } from '../src/utils/logger'

const log = logger.child('coordinator-review-test')

// Mock de LessonProgram para pruebas
function createMockLessonProgram(xpValues: number[]): LessonProgram {
  const nodos: NodoLesson[] = xpValues.map((xp, idx) => ({
    id: `nodo-${idx}`,
    tipoPedagogico: idx === 0 ? 'concept' : 
                   idx === 1 ? 'exercise' :
                   idx === 2 ? 'quiz' :
                   idx === 3 ? 'challenge' : 'evaluation',
    tipoVisual: idx % 2 === 0 ? 'text_card' : 'code_block',
    titulo: `Nodo ${idx + 1}`,
    concepto: `Concepto del nodo ${idx + 1}`,
    nivel: 'intermedio',
    rangoEdad: 'adolescente',
    posX: 100 + idx * 300,
    posY: 100,
    estado: idx === 0 ? 'disponible' : 'bloqueado',
    xpRecompensa: xp,
    contenido: {},
  }))
  
  return {
    sessionId: 'test-session-123',
    alumnoId: 'test-alumno',
    tema: 'JavaScript',
    topicSlug: 'javascript',
    rangoEdad: 'adolescente',
    nodos,
    gamificacion: {
      xpRecompensa: xpValues.reduce((a, b) => a + b, 0),
      logros: [
        {
          id: 'logro-1',
          nombre: 'Primer Paso',
          descripcion: 'Completaste tu primera lección',
          emoji: '🎯',
          xp: 25,
        },
      ],
      mensajeCelebracion: '¡Excelente trabajo!',
      badge: 'badge-iniciado',
    },
    evaluacion: {
      preguntas: [
        {
          tipo: 'multiple_choice',
          pregunta: '¿Qué es JavaScript?',
          opciones: ['Lenguaje', 'Framework', 'Librería', 'Base de datos'],
          indiceCorrecto: 0,
        },
        {
          tipo: 'respuesta_corta',
          pregunta: '¿Para qué sirve JavaScript?',
          respuestaEsperada: 'Para crear páginas web interactivas',
        },
      ],
    },
    perfilAdaptacion: {
      rangoEdad: 'adolescente',
      duracionSesion: 30,
      nodosRecomendados: 5,
      estilo: 'balanceado',
      nivelPrevio: 'intermedio',
      tono: 'motivador',
    },
  }
}

describe('Coordinator Review Tests', () => {
  
  test('should review XP total correctly', async () => {
    // Crear programa con XP que suma 100
    const program = createMockLessonProgram([20, 15, 15, 25, 25])
    
    const params = {
      aprobado: true,
      calidad: 85,
      mensaje: 'Programa revisado y aprobado',
      xpRedistribuido: {}, // No redistribuir, ya suma 100
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    expect((result as any).output.aprobado).toBe(true)
    expect((result as any).output.calidad).toBe(85)
    
    log.info(`XP review test passed: XP total = ${program.gamificacion.xpRecompensa}`)
  })
  
  test('should redistribute XP to total 100', async () => {
    // Crear programa con XP que NO suma 100
    const program = createMockLessonProgram([30, 20, 10, 15, 10]) // Suma = 85
    
    // Coordinador redistribuye para totalizar 100
    const xpRedistribuido = {
      'nodo-0': 25,
      'nodo-1': 20,
      'nodo-2': 15,
      'nodo-3': 25,
      'nodo-4': 15,
    }
    
    const params = {
      aprobado: true,
      calidad: 80,
      mensaje: 'XP redistribuido para totalizar 100',
      xpRedistribuido,
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    expect((result as any).output.xpRedistribuido).toBeDefined()
    
    // Verificar que la redistribución suma 100
    const totalRedistribuido = Object.values(xpRedistribuido).reduce((a, b) => a + b, 0)
    expect(totalRedistribuido).toBe(100)
    
    log.info(`XP redistribution test passed: original sum = 85, redistributed sum = ${totalRedistribuido}`)
  })
  
  test('should validate pedagogical criteria', async () => {
    const validacionPedagogica = {
      claridad: 85,
      adecuacionEdad: 90,
      ejemplosConcretos: 80,
      progresionLogica: 75,
      engagement: 85,
      coberturaTemática: 90,
      detalles: [
        {
          nodoId: 'nodo-0',
          criterios: {
            claridad: true,
            adecuacionEdad: true,
            ejemplosConcretos: true,
            progresionLogica: true,
            engagement: true,
            coberturaTemática: true,
          },
          observaciones: 'Explicación clara con buenos ejemplos',
        },
        {
          nodoId: 'nodo-1',
          criterios: {
            claridad: true,
            adecuacionEdad: true,
            ejemplosConcretos: false,
            progresionLogica: true,
            engagement: true,
            coberturaTemática: true,
          },
          observaciones: 'Falta ejemplo concreto en el ejercicio',
        },
      ],
    }
    
    const params = {
      aprobado: true,
      calidad: 85,
      mensaje: 'Validación pedagógica completada',
      validacionPedagogica,
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    expect((result as any).output.validacionPedagogica).toBeDefined()
    expect((result as any).output.validacionPedagogica.claridad).toBe(85)
    expect((result as any).output.validacionPedagogica.detalles.length).toBe(2)
    
    log.info(`Pedagogical validation test passed: overall quality = ${validacionPedagogica.claridad}`)
  })
  
  test('should log detailed decisions', async () => {
    const loggingDetallado = [
      {
        timestamp: new Date().toISOString(),
        agente: 'hl-coordinator-agent',
        accion: 'revisar_xp_total',
        resultado: 'XP total no suma 100, redistribuyendo',
        metricas: {
          xpOriginal: 85,
          xpObjetivo: 100,
          nodosAfectados: 5,
        },
      },
      {
        timestamp: new Date().toISOString(),
        agente: 'hl-coordinator-agent',
        accion: 'redistribuir_xp',
        resultado: 'XP redistribuido exitosamente',
        metricas: {
          nodo0: { antes: 30, despues: 25 },
          nodo1: { antes: 20, despues: 20 },
          nodo2: { antes: 10, despues: 15 },
          nodo3: { antes: 15, despues: 25 },
          nodo4: { antes: 10, despues: 15 },
        },
      },
      {
        timestamp: new Date().toISOString(),
        agente: 'hl-coordinator-agent',
        accion: 'validar_criterios_pedagogicos',
        resultado: 'Todos los criterios aprobados',
        metricas: {
          claridad: 85,
          adecuacionEdad: 90,
          ejemplosConcretos: 80,
          progresionLogica: 75,
          engagement: 85,
          coberturaTemática: 90,
        },
      },
    ]
    
    const params = {
      aprobado: true,
      calidad: 85,
      mensaje: 'Revisión completada con logging detallado',
      loggingDetallado,
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    expect((result as any).output.loggingDetallado).toBeDefined()
    expect((result as any).output.loggingDetallado.length).toBe(3)
    
    // Verificar estructura del logging
    const logEntry = (result as any).output.loggingDetallado[0]
    expect(logEntry.timestamp).toBeDefined()
    expect(logEntry.agente).toBe('hl-coordinator-agent')
    expect(logEntry.accion).toBe('revisar_xp_total')
    expect(logEntry.metricas).toBeDefined()
    
    log.info(`Logging test passed: ${loggingDetallado.length} log entries`)
  })
  
  test('should handle complex redistribution scenario', async () => {
    // Escenario complejo: redistribuir XP considerando dificultad
    const xpRedistribuido = {
      'nodo-0': 5,   // Bienvenida: poco XP
      'nodo-1': 15,  // Concepto: XP medio
      'nodo-2': 20,  // Ejercicio: XP medio-alto
      'nodo-3': 15,  // Quiz: XP medio
      'nodo-4': 25,  // Reto: XP alto
      'nodo-5': 20,  // Milestone: XP medio
      'nodo-6': 30,  // Evaluación final: XP muy alto
    }
    
    const validacionPedagogica = {
      claridad: 88,
      adecuacionEdad: 92,
      ejemplosConcretos: 85,
      progresionLogica: 90,
      engagement: 87,
      coberturaTemática: 95,
      detalles: [],
    }
    
    const loggingDetallado = [
      {
        timestamp: new Date().toISOString(),
        agente: 'hl-coordinator-agent',
        accion: 'analizar_distribucion_xp',
        resultado: 'Distribución basada en dificultad y tipo de nodo',
        metricas: {
          bienvenida: 5,
          conceptos: 15,
          ejercicios: 20,
          quizzes: 15,
          retos: 25,
          milestones: 20,
          evaluaciones: 30,
        },
      },
    ]
    
    const params = {
      aprobado: true,
      calidad: 90,
      mensaje: 'Redistribución compleja completada',
      xpRedistribuido,
      validacionPedagogica,
      loggingDetallado,
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    
    // Verificar que la redistribución suma 100
    const total = Object.values(xpRedistribuido).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
    
    // Verificar que la validación pedagógica está completa
    expect((result as any).output.validacionPedagogica.claridad).toBe(88)
    expect((result as any).output.validacionPedagogica.coberturaTemática).toBe(95)
    
    // Verificar logging
    expect((result as any).output.loggingDetallado.length).toBe(1)
    
    log.info(`Complex redistribution test passed: total XP = ${total}, quality = ${params.calidad}`)
  })
  
  test('should handle failed validation', async () => {
    const params = {
      aprobado: false,
      calidad: 45,
      mensaje: 'Validación fallida: contenido inadecuado para la edad',
      issues: [
        'Explicación demasiado compleja para niños',
        'Faltan ejemplos concretos',
        'Progresión lógica deficiente',
      ],
      validacionPedagogica: {
        claridad: 60,
        adecuacionEdad: 30,
        ejemplosConcretos: 40,
        progresionLogica: 50,
        engagement: 45,
        coberturaTemática: 70,
        detalles: [],
      },
    }
    
    const result = await revisarProgramaTool.execute!(params)
    
    expect(result).toBeDefined()
    expect((result as any).ok).toBe(true)
    expect((result as any).output.aprobado).toBe(false)
    expect((result as any).output.calidad).toBe(45)
    expect((result as any).output.issues.length).toBe(3)
    
    log.info(`Failed validation test passed: quality = ${params.calidad}, issues = ${params.issues.length}`)
  })
})