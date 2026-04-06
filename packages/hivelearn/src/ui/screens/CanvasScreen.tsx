import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react'
// @ts-ignore — CSS side-effect import for React Flow
import '@xyflow/react/dist/style.css'
import { useLessonStore } from '../store/lessonStore'
import { useGamification } from '../hooks/useGamification'
import { GamificationHUD } from './GamificationHUD'
import { NodeContentPopover } from './NodeContentPopover'
import { XpFloatAnimation } from './XpFloatAnimation'
import { LessonNode, type HLNodeData } from '../nodes/LessonNode'
import type { NodoLesson } from '../../types'

const NODE_TYPES: NodeTypes = {
  hlNode: LessonNode,
}

// ─── Wrapper público (provee el contexto de ReactFlow) ────────────────────────
export function CanvasScreen() {
  return (
    <ReactFlowProvider>
      <CanvasContent />
    </ReactFlowProvider>
  )
}

// ─── Contenido interno (accede a useReactFlow) ────────────────────────────────
function CanvasContent() {
  const { flowToScreenPosition, getViewport } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement>(null)
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null)

  const {
    program, nodoActualId, nodosCompletados, xpFloat,
    selectedNodeId, selectNode, deselectNode,
    completarNodo, incrementarRacha, resetRacha, showXpFloat,
    setLastFeedback, setScreen,
  } = useLessonStore()
  const { checkLogros } = useGamification()
  const [xpFloatPos, setXpFloatPos] = useState({ x: 0, y: 0 })

  const selectedNodo = useMemo(() =>
    program?.nodos.find(n => n.id === selectedNodeId) ?? null,
    [program, selectedNodeId]
  )

  // ─── Calcular posición del popover anclado al nodo ──────────────────────────
  const updatePopoverPosition = useCallback(() => {
    if (!selectedNodeId || !canvasRef.current) {
      setPopoverPos(null)
      return
    }
    const node = program?.nodos.find(n => n.id === selectedNodeId)
    if (!node) return

    const { zoom } = getViewport()
    const screenPos = flowToScreenPosition({ x: node.posX, y: node.posY })
    const rect = canvasRef.current.getBoundingClientRect()

    const nodeX = screenPos.x - rect.left
    const nodeY = screenPos.y - rect.top
    const nodeW = 200 * zoom
    const nodeH = 130 * zoom
    const popW = 460
    const canvasW = rect.width
    const canvasH = rect.height

    // Zoom muy lejano → centrar en canvas
    if (zoom < 0.65) {
      setPopoverPos({
        left: Math.max(16, (canvasW - popW) / 2),
        top: Math.max(16, (canvasH - 480) / 2),
      })
      return
    }

    // Horizontal: derecha del nodo → izquierda → centro
    let left = nodeX + nodeW + 24
    if (left + popW > canvasW - 16) {
      left = nodeX - popW - 24
      if (left < 16) left = (canvasW - popW) / 2
    }

    // Vertical: centrado respecto al nodo, clampeado
    let top = nodeY + nodeH / 2 - 80
    top = Math.max(16, Math.min(top, canvasH - 480))

    setPopoverPos({ left, top })
  }, [selectedNodeId, program, flowToScreenPosition, getViewport])

  // Recalcular cuando cambia el nodo seleccionado
  useEffect(() => {
    updatePopoverPosition()
  }, [selectedNodeId, updatePopoverPosition])

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleNodeClick = useCallback((nodo: NodoLesson) => {
    selectNode(nodo.id)
    setLastFeedback(null)
  }, [selectNode, setLastFeedback])

  const handleComplete = useCallback((nodo: NodoLesson, xpGanado: number) => {
    completarNodo(nodo.id, xpGanado)
    checkLogros()

    if (xpGanado > 0) {
      const el = canvasRef.current?.querySelector(`[data-id="${nodo.id}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        const canvasR = canvasRef.current!.getBoundingClientRect()
        setXpFloatPos({ x: r.left - canvasR.left + r.width / 2 - 40, y: r.top - canvasR.top - 10 })
      }
      showXpFloat(nodo.id, xpGanado)
      incrementarRacha()
    } else {
      resetRacha()
    }
  }, [completarNodo, checkLogros, showXpFloat, incrementarRacha, resetRacha])

  // ─── Nodos y edges ───────────────────────────────────────────────────────────
  const rfNodes = useMemo((): Node<Record<string, unknown>>[] => {
    if (!program) return []
    return program.nodos.map(nodo => ({
      id: nodo.id,
      type: 'hlNode',
      position: { x: nodo.posX, y: nodo.posY },
      data: {
        nodo,
        isActive: nodo.id === nodoActualId,
        isSelected: nodo.id === selectedNodeId,
        onClick: handleNodeClick,
      } satisfies HLNodeData,
    }))
  }, [program, nodoActualId, selectedNodeId, handleNodeClick])

  const rfEdges = useMemo((): Edge[] => {
    if (!program) return []
    return program.nodos.slice(0, -1).map((nodo, i) => {
      const next = program.nodos[i + 1]
      const isDone   = nodo.estado === 'completado'
      const isActive = nodo.estado === 'disponible'
      const isLocked = next.estado === 'bloqueado'
      return {
        id: `e-${nodo.id}-${next.id}`,
        source: nodo.id,
        target: next.id,
        animated: isDone || isActive,
        style: {
          stroke: isDone ? '#22c55e' : isActive ? '#3b82f6' : '#1e2a3e',
          strokeWidth: isDone ? 2 : isActive ? 1.5 : 1,
          opacity: isLocked ? 0.25 : isDone ? 0.7 : 0.5,
          strokeDasharray: isLocked ? '5 5' : undefined,
        },
      }
    })
  }, [program])

  if (!program) return null

  const todoCompleto = nodosCompletados.length >= program.nodos.filter(n => n.tipoPedagogico !== 'evaluation').length

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden" style={{ background: '#080d1a' }}>
      <GamificationHUD tema={program.tema} />

      {todoCompleto && (
        <div className="absolute top-14 right-4 z-20">
          <button
            onClick={() => setScreen('evaluation')}
            className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500 shadow-lg shadow-blue-900/50 transition-all"
          >
            📝 Evaluación final →
          </button>
        </div>
      )}

      {/* Canvas con popover anclado */}
      <div ref={canvasRef} className="flex-1 relative">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          selectNodesOnDrag={false}
          onNodeClick={(_event, rfNode) => {
            const nodo = program.nodos.find(n => n.id === rfNode.id)
            if (nodo && nodo.estado !== 'bloqueado') handleNodeClick(nodo)
          }}
          onMove={updatePopoverPosition}
          style={{ background: '#080d1a' }}
        >
          <Background color="#1a2035" gap={24} size={1.5} style={{ opacity: 0.7 }} />
          <Controls
            className="[&>button]:bg-[#111827] [&>button]:border-white/10 [&>button]:text-white/50 [&>button]:hover:bg-[#1f2937] [&>button]:hover:text-white/80"
            showInteractive={false}
          />
        </ReactFlow>

        {xpFloat && (
          <XpFloatAnimation
            xp={xpFloat.xp}
            animKey={xpFloat.key}
            x={xpFloatPos.x}
            y={xpFloatPos.y}
          />
        )}

        {/* Popover anclado al nodo seleccionado */}
        <NodeContentPopover
          nodo={selectedNodo}
          position={popoverPos}
          onClose={deselectNode}
          onComplete={handleComplete}
        />
      </div>
    </div>
  )
}
