import { useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import DOMPurify from 'dompurify'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function QuizDiagramNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const svg = data.contenido?.svg?.svgString
  const quiz = data.contenido?.quiz

  const cleanSvg = useMemo(() => {
    if (!svg) return null
    return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
  }, [svg])

  return (
    <BaseNode {...props} data={data}>
      <div className="mt-1 space-y-2">
        {cleanSvg && (
          <div
            className="w-full overflow-hidden rounded"
            dangerouslySetInnerHTML={{ __html: cleanSvg }}
            style={{ maxHeight: 80 }}
          />
        )}
        {quiz && <p className="text-xs text-gray-200">{quiz.pregunta}</p>}
      </div>
    </BaseNode>
  )
}
