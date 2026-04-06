import { useState, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { BaseNode, type LessonNodeData } from './base/BaseNode'

export function ExerciseGifGuideNode(props: NodeProps) {
  const data = props.data as unknown as LessonNodeData
  const gif = data.contenido?.gifFrames
  const [frameIdx, setFrameIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!gif?.frames || paused) return
    const frame = gif.frames[frameIdx]
    const timer = setTimeout(() => {
      setFrameIdx(prev => (prev + 1) % gif.frames.length)
    }, frame?.duracionMs ?? 1500)
    return () => clearTimeout(timer)
  }, [frameIdx, gif, paused])

  if (!gif?.frames) return (
    <BaseNode {...props} data={data}>
      <div className="h-20 rounded bg-gray-800 animate-pulse" />
    </BaseNode>
  )

  const frame = gif.frames[frameIdx]

  return (
    <BaseNode {...props} data={data}>
      <div
        className="mt-1 text-center cursor-pointer select-none"
        onClick={() => setPaused(!paused)}
      >
        <div className="text-4xl my-1">{frame.emoji}</div>
        <p className="text-xs text-gray-200">{frame.texto}</p>
        <div className="mt-2 flex gap-0.5 justify-center">
          {gif.frames.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${i === frameIdx ? 'w-4 bg-blue-500' : 'w-1 bg-gray-600'}`}
            />
          ))}
        </div>
        {paused && <p className="text-[10px] text-gray-500 mt-1">▶ Tap para continuar</p>}
      </div>
    </BaseNode>
  )
}
