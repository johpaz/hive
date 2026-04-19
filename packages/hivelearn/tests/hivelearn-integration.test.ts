/**
 * Test de integración para HiveLearn
 * 
 * Ejecuta el swarm completo con Ollama gemma431b:cloud y verifica:
 * - Número de nodos según tiempo de sesión (15, 30, 45 min)
 * - Generación de contenido visual (SVG, GIF) cuando tipoVisual != text_card
 * - Generación de retos cuando tipoPedagogico == challenge
 * - Tema extraído correctamente
 * - XP total = 100 después de redistribución del coordinador
 * - Validación pedagógica avanzada
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { HiveLearnSwarm } from '../src/swarm/HiveLearnSwarm'
import type { StudentProfile, LessonProgram } from '../src/types'
import { logger } from '../src/utils/logger'

const log = logger.child('integration-test')

// Configuración de Ollama
const OLLAMA_CONFIG = {
  provider: 'ollama',
  model: 'gemma431b:cloud',
  baseUrl: 'http://localhost:11434',
}

// Perfiles de prueba para cada tiempo de sesión
const TEST_PROFILES: Record<number, StudentProfile> = {
  15: {
    alumnoId: 'test-alumno-15min',
    nombre: 'Juan',
    edad: 12,
    rangoEdad: 'nino',
    tiempoSesion: 15,
    nivelPrevio: 'principiante',
    estilo: 'balanceado',
    sesionesTotal: 1,
    xpAcumulado: 0,
    nivelActual: ' principiante',
  },
  30: {
    alumnoId: 'test-alumno-30min',
    nombre: 'María',
    edad: 15,
    rangoEdad: 'adolescente',
    tiempoSesion: 30,
    nivelPrevio: 'intermedio',
    estilo: 'retos',
    sesionesTotal: 5,
    xpAcumulado: 250,
    nivelActual: 'intermedio',
  },
  45: {
    alumnoId: 'test-alumno-45min',
    nombre: 'Carlos',
    edad: 25,
    rangoEdad: 'adulto',
    tiempoSesion: 45,
    nivelPrevio: 'intermedio',
    estilo: 'mis_retos',
    sesionesTotal: 10,
    xpAcumulado: 500,
    nivelActual: 'avanzado',
  },
}

// Metas de prueba
const TEST_METAS = {
  15: 'Aprender los conceptos básicos de JavaScript',
  30: 'Entender cómo funcionan las funciones en Python',
  45: 'Dominar los patrones de diseño en TypeScript',
}

// Número esperado de nodos según tiempo
const EXPECTED_NODES: Record<number, { min: number; max: number }> = {
  15: { min: 3, max: 4 },
  30: { min: 5, max: 7 },
  45: { min: 8, max: 10 },
}

describe('HiveLearn Integration Tests', () => {
  let swarm: HiveLearnSwarm
  
  beforeAll(() => {
    log.info('Initializing HiveLearn swarm for integration tests')
    swarm = new HiveLearnSwarm({
      onProgress: (progress) => {
        log.info(`Progress: ${progress.etapa} - ${progress.agenteActivo} - ${progress.porcentaje}% - ${progress.mensaje}`)
      },
    })
  })
  
  afterAll(() => {
    log.info('Integration tests completed')
  })
  
  test('should generate lesson for 15-minute session', async () => {
    const profile = TEST_PROFILES[15]
    const meta = TEST_METAS[15]
    
    log.info(`Testing 15-minute session for ${profile.nombre}`)
    
    const program = await swarm.run(profile, meta)
    
    // Verificar estructura básica
    expect(program).toBeDefined()
    expect(program.sessionId).toContain('juan')
    expect(program.alumnoId).toBe(profile.alumnoId)
    expect(program.tema).toBe(meta)
    expect(program.rangoEdad).toBe('nino')
    
    // Verificar número de nodos
    const expectedNodes = EXPECTED_NODES[15]
    expect(program.nodos.length).toBeGreaterThanOrEqual(expectedNodes.min)
    expect(program.nodos.length).toBeLessThanOrEqual(expectedNodes.max)
    
    // Verificar XP total
    const totalXP = program.nodos.reduce((sum, nodo) => sum + nodo.xpRecompensa, 0)
    expect(totalXP).toBe(100)
    
    // Verificar que el primer nodo es bienvenida
    expect(program.nodos[0].tipoPedagogico).toBe('concept')
    expect(program.nodos[0].titulo.toLowerCase()).toContain('bienvenida')
    
    // Verificar que el último nodo es evaluación
    expect(program.nodos[program.nodos.length - 1].tipoPedagogico).toBe('evaluation')
    
    // Verificar gamificación
    expect(program.gamificacion.xpRecompensa).toBe(100)
    expect(program.gamificacion.logros.length).toBeGreaterThan(0)
    
    // Verificar evaluación
    expect(program.evaluacion.preguntas.length).toBe(5)
    
    log.info(`15-minute test passed: ${program.nodos.length} nodes, ${totalXP} XP`)
  }, 60000) // Timeout de 60 segundos
  
  test('should generate lesson for 30-minute session with visual content', async () => {
    const profile = TEST_PROFILES[30]
    const meta = TEST_METAS[30]
    
    log.info(`Testing 30-minute session for ${profile.nombre}`)
    
    const program = await swarm.run(profile, meta)
    
    // Verificar estructura básica
    expect(program).toBeDefined()
    expect(program.rangoEdad).toBe('adolescente')
    
    // Verificar número de nodos
    const expectedNodes = EXPECTED_NODES[30]
    expect(program.nodos.length).toBeGreaterThanOrEqual(expectedNodes.min)
    expect(program.nodos.length).toBeLessThanOrEqual(expectedNodes.max)
    
    // Verificar XP total
    const totalXP = program.nodos.reduce((sum, nodo) => sum + nodo.xpRecompensa, 0)
    expect(totalXP).toBe(100)
    
    // Verificar que hay contenido visual
    const visualNodes = program.nodos.filter(nodo => 
      nodo.tipoVisual !== 'text_card' && 
      nodo.contenido && 
      Object.keys(nodo.contenido).length > 0
    )
    expect(visualNodes.length).toBeGreaterThan(0)
    
    // Verificar que hay al menos un reto
    const challengeNodes = program.nodos.filter(nodo => nodo.tipoPedagogico === 'challenge')
    expect(challengeNodes.length).toBeGreaterThan(0)
    
    // Verificar que el reto tiene pasos y criterios
    if (challengeNodes.length > 0) {
      const challenge = challengeNodes[0]
      expect(challenge.contenido?.reto).toBeDefined()
      expect(challenge.contenido?.reto?.pasos?.length).toBeGreaterThan(0)
      expect(challenge.contenido?.reto?.criteriosExito?.length).toBeGreaterThan(0)
    }
    
    log.info(`30-minute test passed: ${program.nodos.length} nodes, ${visualNodes.length} visual nodes`)
  }, 90000) // Timeout de 90 segundos
  
  test('should generate lesson for 45-minute session with all content types', async () => {
    const profile = TEST_PROFILES[45]
    const meta = TEST_METAS[45]
    
    log.info(`Testing 45-minute session for ${profile.nombre}`)
    
    const program = await swarm.run(profile, meta)
    
    // Verificar estructura básica
    expect(program).toBeDefined()
    expect(program.rangoEdad).toBe('adulto')
    
    // Verificar número de nodos
    const expectedNodes = EXPECTED_NODES[45]
    expect(program.nodos.length).toBeGreaterThanOrEqual(expectedNodes.min)
    expect(program.nodos.length).toBeLessThanOrEqual(expectedNodes.max)
    
    // Verificar XP total
    const totalXP = program.nodos.reduce((sum, nodo) => sum + nodo.xpRecompensa, 0)
    expect(totalXP).toBe(100)
    
    // Verificar que hay todos los tipos de contenido
    const contentTypes = {
      concept: program.nodos.filter(n => n.tipoPedagogico === 'concept').length,
      exercise: program.nodos.filter(n => n.tipoPedagogico === 'exercise').length,
      quiz: program.nodos.filter(n => n.tipoPedagogico === 'quiz').length,
      challenge: program.nodos.filter(n => n.tipoPedagogico === 'challenge').length,
      evaluation: program.nodos.filter(n => n.tipoPedagogico === 'evaluation').length,
    }
    
    expect(contentTypes.concept).toBeGreaterThan(0)
    expect(contentTypes.exercise).toBeGreaterThan(0)
    expect(contentTypes.quiz).toBeGreaterThan(0)
    expect(contentTypes.challenge).toBeGreaterThan(0)
    expect(contentTypes.evaluation).toBe(1) // Solo una evaluación final
    
    // Verificar que hay contenido visual diverso
    const visualTypes = {
      code: program.nodos.filter(n => n.tipoVisual === 'code_block').length,
      svg: program.nodos.filter(n => n.tipoVisual === 'svg_diagram').length,
      gif: program.nodos.filter(n => n.tipoVisual === 'gif_guide').length,
      infographic: program.nodos.filter(n => n.tipoVisual === 'infographic').length,
      image: program.nodos.filter(n => n.tipoVisual === 'image_ai').length,
      audio: program.nodos.filter(n => n.tipoVisual === 'audio_ai').length,
    }
    
    // Debería haber al menos algunos tipos visuales
    const totalVisual = Object.values(visualTypes).reduce((sum, count) => sum + count, 0)
    expect(totalVisual).toBeGreaterThan(0)
    
    // Verificar tema extraído
    expect(program.tema).toBe(meta)
    
    // Verificar gamificación adaptada a adultos
    expect(program.gamificacion.logros.length).toBeGreaterThan(0)
    expect(program.gamificacion.mensajeCelebracion).toBeDefined()
    
    log.info(`45-minute test passed: ${program.nodos.length} nodes, ${totalVisual} visual nodes`)
    log.info(`Content types: ${JSON.stringify(contentTypes)}`)
    log.info(`Visual types: ${JSON.stringify(visualTypes)}`)
  }, 120000) // Timeout de 120 segundos
  
  test('should extract topic correctly from meta', async () => {
    const profile = TEST_PROFILES[15]
    const meta = 'Aprender sobre machine learning y redes neuronales'
    
    log.info(`Testing topic extraction for: ${meta}`)
    
    const program = await swarm.run(profile, meta)
    
    // Verificar que el tema se extrajo correctamente
    expect(program.tema).toBe(meta)
    expect(program.topicSlug).toBeDefined()
    expect(program.topicSlug).toContain('machine_learning')
    
    log.info(`Topic extraction test passed: tema="${program.tema}", slug="${program.topicSlug}"`)
  }, 60000)
  
  test('should redistribute XP to total 100 points', async () => {
    const profile = TEST_PROFILES[30]
    const meta = TEST_METAS[30]
    
    log.info(`Testing XP redistribution`)
    
    const program = await swarm.run(profile, meta)
    
    // Verificar que el XP total es exactamente 100
    const totalXP = program.nodos.reduce((sum, nodo) => sum + nodo.xpRecompensa, 0)
    expect(totalXP).toBe(100)
    
    // Verificar que ningún nodo tiene XP negativo o cero
    program.nodos.forEach(nodo => {
      expect(nodo.xpRecompensa).toBeGreaterThan(0)
      expect(nodo.xpRecompensa).toBeLessThanOrEqual(50) // Máximo 50 por nodo
    })
    
    // Verificar que los retos y evaluaciones tienen más XP
    const challengeNodes = program.nodos.filter(n => n.tipoPedagogico === 'challenge')
    const evaluationNodes = program.nodos.filter(n => n.tipoPedagogico === 'evaluation')
    const conceptNodes = program.nodos.filter(n => n.tipoPedagogico === 'concept')
    
    if (challengeNodes.length > 0 && conceptNodes.length > 0) {
      const avgChallengeXP = challengeNodes.reduce((sum, n) => sum + n.xpRecompensa, 0) / challengeNodes.length
      const avgConceptXP = conceptNodes.reduce((sum, n) => sum + n.xpRecompensa, 0) / conceptNodes.length
      
      // Los retos deberían tener más XP que los conceptos
      expect(avgChallengeXP).toBeGreaterThan(avgConceptXP)
    }
    
    log.info(`XP redistribution test passed: total XP = ${totalXP}`)
  }, 90000)
})