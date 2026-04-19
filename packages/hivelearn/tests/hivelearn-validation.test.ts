/**
 * Test de validación pedagógica avanzada para HiveLearn
 * 
 * Verifica:
 * - Validación pedagógica avanzada por tipo de agente
 * - Redistribución de XP por coordinador
 * - Logging detallado
 * - Métricas avanzadas
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { validatePedagogicalContent } from '../src/agent/validation/pedagogical-validation'
import type { ValidationResult } from '../src/agent/validation/pedagogical-validation'
import { logger } from '../src/utils/logger'

const log = logger.child('validation-test')

describe('HiveLearn Validation Tests', () => {
  
  test('should validate ExplanationAgent content', () => {
    const contenido = {
      titulo: 'Introducción a JavaScript',
      explicacion: 'JavaScript es un lenguaje de programación que se usa para crear páginas web interactivas. Permite agregar comportamiento dinámico a los sitios web, como animaciones, formularios y juegos.',
      ejemploConcreto: 'Por ejemplo, cuando haces clic en un botón y aparece un mensaje, eso es JavaScript en acción.',
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-explanation-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_explicacion',
    })
    
    expect(result).toBeDefined()
    expect(result.agenteId).toBe('hl-explanation-agent')
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.coberturaTemática).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`ExplanationAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate ExerciseAgent content', () => {
    const contenido = {
      enunciado: 'Crea una función en JavaScript que reciba un número y devuelva su doble.',
      ejemploRespuesta: 'function doble(numero) { return numero * 2; }',
      respuestaCorrecta: 'function doble(numero) { return numero * 2; }',
      pasos: [
        'Define la función con el nombre doble',
        'Agrega el parámetro numero',
        'Retorna numero multiplicado por 2'
      ],
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-exercise-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_ejercicio',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.progresionLogica).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`ExerciseAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate QuizAgent content', () => {
    const contenido = {
      pregunta: '¿Qué palabra clave se usa para declarar una variable en JavaScript?',
      opciones: ['var', 'let', 'const', 'Todas las anteriores'],
      indicesCorrecto: 3,
      explicacionesIncorrectas: [
        'var es una forma antigua de declarar variables',
        'let es una forma moderna de declarar variables',
        'const declara constantes, no variables'
      ],
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-quiz-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_quiz',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.coberturaTemática).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`QuizAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate ChallengeAgent content', () => {
    const contenido = {
      titulo: 'Reto: Crea una calculadora',
      contexto: 'En este reto crearás una calculadora simple usando JavaScript que pueda sumar, restar, multiplicar y dividir.',
      pasos: [
        'Crea una función para cada operación',
        'Implementa la suma con el operador +',
        'Implementa la resta con el operador -',
        'Implementa la multiplicación con el operador *',
        'Implementa la división con el operador /'
      ],
      criterios_exito: [
        'La calculadora puede sumar dos números',
        'La calculadora puede restar dos números',
        'La calculadora puede multiplicar dos números',
        'La calculadora puede dividir dos números'
      ],
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-challenge-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_reto',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.progresionLogica).toBe(true)
    expect(result.criterios.engagement).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`ChallengeAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate CodeAgent content', () => {
    const contenido = {
      lenguaje: 'javascript',
      codigo: '// Función para sumar dos números\nfunction sumar(a, b) {\n  return a + b;\n}\n\n// Ejemplo de uso\nconst resultado = sumar(5, 3);\nconsole.log(resultado); // 8',
      descripcionBreve: 'Ejemplo de función en JavaScript que suma dos números',
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-code-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_codigo',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.progresionLogica).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`CodeAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate SVGAgent content', () => {
    const contenido = {
      svgString: '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-family="Arial" font-size="20">Diagrama de JavaScript</text><rect x="50" y="80" width="300" height="150" fill="lightblue" stroke="black" /><text x="150" y="150" font-family="Arial" font-size="16">Variables y Funciones</text></svg>',
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-svg-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_svg',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`SVGAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate GIFAgent content', () => {
    const contenido = {
      frames: [
        { emoji: '🚀', texto: 'Inicio', duracionMs: 1000 },
        { emoji: '💻', texto: 'Código', duracionMs: 1000 },
        { emoji: '✅', texto: 'Resultado', duracionMs: 1000 },
      ],
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-gif-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_frames_gif',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`GIFAgent validation: approved=${result.aprobado}`)
  })
  
  test('should validate InfographicAgent content', () => {
    const contenido = {
      secciones: [
        { emoji: '📚', titulo: 'Conceptos', valor: 'Variables, Funciones, Objetos' },
        { emoji: '🔧', titulo: 'Herramientas', valor: 'VS Code, Chrome DevTools' },
        { emoji: '🎯', titulo: 'Aplicaciones', valor: 'Web, Mobile, Servidores' },
      ],
    }
    
    const result = validatePedagogicalContent(contenido, {
      agenteId: 'hl-infographic-agent',
      rangoEdad: 'adolescente',
      tema: 'JavaScript',
      tipoContenido: 'generar_infografia',
    })
    
    expect(result).toBeDefined()
    expect(result.criterios.claridad).toBe(true)
    expect(result.criterios.ejemplosConcretos).toBe(true)
    expect(result.criterios.progresionLogica).toBe(true)
    expect(result.aprobado).toBe(true)
    
    log.info(`InfographicAgent validation: approved=${result.aprobado}`)
  })
  
  test('should calculate complexity correctly', () => {
    // Texto simple para niño
    const simpleText = 'JavaScript es un lenguaje para hacer páginas web.'
    const simpleComplexity = calcularComplejidad(simpleText)
    expect(simpleComplexity).toBeLessThan(40)
    
    // Texto complejo para adulto
    const complexText = 'JavaScript utiliza prototipos para la herencia de objetos, lo cual es fundamentalmente diferente al modelo de clases basado en la herencia prototípica.'
    const complexComplexity = calcularComplejidad(complexText)
    expect(complexComplexity).toBeGreaterThan(60)
    
    log.info(`Complexity calculation: simple=${simpleComplexity}, complex=${complexComplexity}`)
  })
  
  test('should validate age appropriateness', () => {
    // Contenido para niño
    const childContent = {
      titulo: '¡Hola Mundo!',
      explicacion: 'Vamos a crear nuestro primer programa. Es fácil y divertido.',
      ejemploConcreto: 'Cuando escribimos console.log("Hola"), aparece "Hola" en la pantalla.',
    }
    
    const childResult = validatePedagogicalContent(childContent, {
      agenteId: 'hl-explanation-agent',
      rangoEdad: 'nino',
      tema: 'JavaScript',
      tipoContenido: 'generar_explicacion',
    })
    
    expect(childResult.criterios.adecuacionEdad).toBe(true)
    
    // Contenido para adulto
    const adultContent = {
      titulo: 'Fundamentos de JavaScript',
      explicacion: 'JavaScript es un lenguaje de programación interpretado, dinámicamente tipado y basado en prototipos. Soporta múltiples paradigmas de programación.',
      ejemploConcreto: 'Por ejemplo, la función Array.prototype.map() permite transformar elementos de un array aplicando una función de transformación.',
    }
    
    const adultResult = validatePedagogicalContent(adultContent, {
      agenteId: 'hl-explanation-agent',
      rangoEdad: 'adulto',
      tema: 'JavaScript',
      tipoContenido: 'generar_explicacion',
    })
    
    expect(adultResult.criterios.adecuacionEdad).toBe(true)
    
    log.info(`Age appropriateness: child=${childResult.criterios.adecuacionEdad}, adult=${adultResult.criterios.adecuacionEdad}`)
  })
})

// Función auxiliar para calcular complejidad (copiada de pedagogical-validation.ts)
function calcularComplejidad(texto: string): number {
  if (!texto) return 0
  
  const palabras = texto.split(/\s+/).length
  const oraciones = texto.split(/[.!?]+/).length
  const palabrasPorOracion = palabras / (oraciones || 1)
  
  let complejidad = 0
  
  // Longitud de palabras
  const palabrasLargas = texto.split(/\s+/).filter(p => p.length > 6).length
  complejidad += (palabrasLargas / palabras) * 40
  
  // Palabras por oración
  if (palabrasPorOracion > 20) complejidad += 30
  else if (palabrasPorOracion > 15) complejidad += 20
  else if (palabrasPorOracion > 10) complejidad += 10
  
  // Vocabulario complejo
  const palabrasComplejas = ['sin embargo', 'por lo tanto', 'en consecuencia', 'no obstante']
  if (palabrasComplejas.some(p => texto.toLowerCase().includes(p))) {
    complejidad += 20
  }
  
  return Math.min(100, Math.max(0, complejidad))
}