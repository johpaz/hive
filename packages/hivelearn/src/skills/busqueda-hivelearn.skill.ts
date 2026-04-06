export const BUSQUEDA_HIVELEARN_SKILL = {
  name: 'busqueda-hivelearn',
  version: '1.0.0',
  description: 'Búsqueda full-text en el contenido educativo de HiveLearn',
  icon: '🔍',
  category: 'education',
  tools: ['buscar_curriculo_existente', 'buscar_en_hivelearn'],
  triggers: ['buscar tema', 'buscar en hivelearn', 'encontrar curso'],
  steps: [
    { name: 'Buscar', description: 'FTS5 sobre hl_search_fts' },
    { name: 'Filtrar', description: 'Filtrar por tipo y nivel' },
    { name: 'Presentar', description: 'Mostrar resultados relevantes' },
  ],
}
