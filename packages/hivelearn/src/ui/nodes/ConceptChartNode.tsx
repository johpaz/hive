import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'
import { ConceptInfographicNode } from './ConceptInfographicNode'

// Chart usa el mismo render que Infographic por ahora
export { ConceptInfographicNode as ConceptChartNode }
