export const GESTIONAR_CONTENIDO_SKILL = {
  name: 'gestionar-contenido-educativo',
  version: '1.0.0',
  description: 'Genera y gestiona contenido educativo adaptativo con el enjambre HiveLearn',
  icon: '📚',
  category: 'education',
  tools: [
    'disenar_estructura', 'poblar_nodo', 'crear_nodo_canvas', 'conectar_nodos',
    'marcar_completado', 'avanzar_nodo', 'generar_explicacion', 'generar_ejercicio',
    'generar_quiz', 'generar_reto', 'generar_codigo', 'generar_svg',
    'generar_frames_gif', 'generar_infografia',
  ],
  triggers: ['quiero aprender', 'enséñame', 'aprende', 'tutorial', 'curso'],
  steps: [
    { name: 'Perfil', description: 'Recopilar datos del alumno' },
    { name: 'Meta', description: 'Capturar objetivo de aprendizaje' },
    { name: 'Generar', description: 'Ejecutar enjambre HiveLearn' },
    { name: 'Interactuar', description: 'Sesión interactiva con feedback' },
    { name: 'Evaluar', description: 'Evaluación final y métricas' },
  ],
}
