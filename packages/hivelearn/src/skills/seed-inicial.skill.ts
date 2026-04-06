export const SEED_INICIAL_SKILL = {
  name: 'seed-inicial',
  version: '1.0.0',
  description: 'Inicializa HiveLearn con datos de ejemplo para demostración',
  icon: '🌱',
  category: 'education',
  tools: [],
  triggers: ['inicializar hivelearn', 'demo hivelearn', 'seed hivelearn'],
  steps: [
    { name: 'Schema', description: 'Ejecutar migración 001_hivelearn.sql' },
    { name: 'Seed', description: 'Insertar 14 temas iniciales' },
    { name: 'Agentes', description: 'Registrar 14 agentes del enjambre' },
  ],
}
