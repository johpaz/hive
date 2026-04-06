import { useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import DOMPurify from 'dompurify'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ConceptDiagramNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const svg = data.contenido?.svg?.svgString

  const cleanSvg = useMemo(() => {
    if (!svg) return null
    return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
  }, [svg])

  return (
    <BaseNode {...props} data={data}>
      {cleanSvg ? (
        <div
          className="mt-1 w-full overflow-hidden rounded"
          dangerouslySetInnerHTML={{ __html: cleanSvg }}
          style={{ maxHeight: 120 }}
        />
      ) : (
        <div className="h-20 rounded bg-gray-800 animate-pulse flex items-center justify-center">
          <span className="text-xs text-gray-500">Generando diagrama...</span>
        </div>
      )}
    </BaseNode>
  )
}
