import { useEffect, useRef } from 'react'
import type { NodeProps } from '@xyflow/react'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-bash'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ConceptCodeNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const codeRef = useRef<HTMLElement>(null)
  const codigo = data.contenido?.codigo ?? data.contenido?.explicacion as any

  useEffect(() => {
    if (codeRef.current) Prism.highlightElement(codeRef.current)
  }, [codigo])

  return (
    <BaseNode {...props} data={data}>
      {codigo?.codigo ? (
        <div className="mt-1">
          {codigo.descripcionBreve && (
            <p className="text-xs text-gray-400 mb-1">{codigo.descripcionBreve}</p>
          )}
          <pre className="rounded bg-black/50 p-2 text-xs overflow-x-auto max-h-36">
            <code ref={codeRef} className={`language-${codigo.lenguaje ?? 'javascript'}`}>
              {codigo.codigo}
            </code>
          </pre>
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">Generando código...</p>
      )}
    </BaseNode>
  )
}
