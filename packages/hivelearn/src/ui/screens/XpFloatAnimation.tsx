import { useEffect, useState } from 'react'

interface Props {
  xp: number
  animKey: number
  /** Posición en el canvas donde el nodo está (viewport coords) */
  x: number
  y: number
}

/**
 * Animación de XP flotante que sube y desaparece.
 * Se monta en un portal sobre el grafo ReactFlow.
 */
export function XpFloatAnimation({ xp, animKey, x, y }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 1300)
    return () => clearTimeout(t)
  }, [animKey])

  if (!visible) return null

  return (
    <div
      key={animKey}
      className="pointer-events-none fixed z-50 select-none"
      style={{ left: x, top: y }}
    >
      <div className="animate-xp-float text-base font-black text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] whitespace-nowrap">
        +{xp} XP ✨
      </div>
    </div>
  )
}
