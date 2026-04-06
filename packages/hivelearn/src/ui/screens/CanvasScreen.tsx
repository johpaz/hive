import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react'
// @ts-ignore — CSS side-effect import for React Flow
import '@xyflow/react/dist/style.css'
import { useLessonStore } from '../store/lessonStore'
import { useGamification } from '../hooks/useGamification'
import { GamificationHUD } from './GamificationHUD'
import { NodeDetailPanel } from './NodeDetailPanel'
import { XpFloatAnimation } from './XpFloatAnimation'
import type { NodoLesson, TipoPedagogico } from '../../types'

// ─── Iconos por tipo pedagógico ───────────────────────────────────────────────
const TIPO_ICON: Record<TipoPedagogico | string, string> = {
  concept:    '📖',
  exercise:   '✏️',
  quiz:       '❓',
  challenge:  '⚡',
  milestone:  '🏆',
  evaluation: '📝',
}

// ─── Nodo simple del grafo ────────────────────────────────────────────────────
interface HLNodeData extends Record<string, unknown> {
  nodo: NodoLesson
  isActive: boolean
  onClick: (nodo: NodoLesson) => void
}

function HiveLearnNode({ data }: NodeProps) {
  const { nodo, isActive, onClick } = data as HLNodeData
  const estado = nodo.estado
  const isLocked = estado === 'bloqueado'
  const isDone   = estado === 'completado'
  const isAvail  = estado === 'disponible'

  return (
    <div className={`
      w-[160px] rounded-2xl border-2 px-3 py-3 flex flex-col items-center gap-2 text-center
      transition-all duration-300
      ${isDone   ? 'bg-green-500/10 border-green-500/50' : ''}
      ${isAvail && isActive  ? 'bg-gray-800 border-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.35)]' : ''}
      ${isAvail && !isActive ? 'bg-gray-800 border-amber-500/40' : ''}
      ${isLocked ? 'bg-gray-900/60 border-gray-700/40 opacity-60' : ''}
    `}>
      <Handle type="target" position={Position.Left} className="!bg-gray-600 !border-gray-500 !w-2 !h-2" />

      {/* Emoji + título */}
      <span className={`text-2xl leading-none ${isLocked ? 'grayscale' : ''}`}>
        {isDone ? '✅' : isLocked ? '🔒' : TIPO_ICON[nodo.tipoPedagogico] ?? '📌'}
      </span>
      <p className={`text-[11px] font-bold leading-tight line-clamp-2
        ${isDone ? 'text-green-300' : isLocked ? 'text-gray-500' : 'text-white'}`}>
        {nodo.titulo}
      </p>

      {/* Botón de acción */}
      {!isLocked && (
        <button
          onClick={() => onClick(nodo)}
          className={`
            w-full rounded-lg py-1 text-[10px] font-bold transition-all
            ${isDone
              ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
              : 'bg-amber-500 text-black hover:bg-amber-400 active:scale-95'}
          `}
        >
          {isDone ? '✓ Revisar' : 'Abrir →'}
        </button>
      )}

      <Handle type="source" position={Position.Right} className="!bg-gray-600 !border-gray-500 !w-2 !h-2" />
    </div>
  )
}

const NODE_TYPES: NodeTypes = {
  hlNode: HiveLearnNode,
}

// ─── CanvasScreen principal ───────────────────────────────────────────────────

export function CanvasScreen() {
  const {
    program, nodoActualId, nodosCompletados, xpFloat,
    selectedNodeId, selectNode, deselectNode,
    completarNodo, incrementarRacha, resetRacha, perderVida, showXpFloat,
    setLastFeedback, setScreen,
  } = useLessonStore()
  const { checkLogros } = useGamification()

  const [xpFloatPos, setXpFloatPos] = useState({ x: 0, y: 0 })
  const reactFlowRef = useRef<HTMLDivElement>(null)

  // Nodo seleccionado completo
  const selectedNodo = useMemo(() =>
    program?.nodos.find(n => n.id === selectedNodeId) ?? null,
    [program, selectedNodeId]
  )

  const handleNodeClick = useCallback((nodo: NodoLesson) => {
    selectNode(nodo.id)
    setLastFeedback(null)
  }, [selectNode, setLastFeedback])

  const handleComplete = useCallback((nodo: NodoLesson, xpGanado: number) => {
    completarNodo(nodo.id, xpGanado)
    checkLogros()

    // Animar XP flotante sobre el nodo
    if (xpGanado > 0) {
      const el = reactFlowRef.current?.querySelector(`[data-id="${nodo.id}"]`)
      if (el) {
        const rect = el.getBoundingClientRect()
        setXpFloatPos({ x: rect.left + rect.width / 2 - 40, y: rect.top - 10 })
      }
      showXpFloat(nodo.id, xpGanado)
      incrementarRacha()
    } else {
      resetRacha()
    }
  }, [completarNodo, checkLogros, showXpFloat, incrementarRacha, resetRacha])

  const rfNodes = useMemo((): Node<Record<string, unknown>>[] => {
    if (!program) return []
    return program.nodos.map(nodo => ({
      id: nodo.id,
      type: 'hlNode',
      position: { x: nodo.posX, y: nodo.posY },
      data: {
        nodo,
        isActive: nodo.id === nodoActualId,
        onClick: handleNodeClick,
      },
    }))
  }, [program, nodoActualId, handleNodeClick])

  const rfEdges = useMemo((): Edge[] => {
    if (!program) return []
    return program.nodos.slice(0, -1).map((nodo, i) => ({
      id: `e-${nodo.id}-${program.nodos[i + 1].id}`,
      source: nodo.id,
      target: program.nodos[i + 1].id,
      style: {
        stroke: nodo.estado === 'completado' ? '#22c55e' : '#374151',
        strokeWidth: 2,
        opacity: 0.6,
      },
      animated: nodo.estado === 'disponible',
    }))
  }, [program])

  if (!program) return null

  const todoCompleto = nodosCompletados.length >= program.nodos.filter(n => n.tipoPedagogico !== 'evaluation').length

  return (
    <div className="absolute inset-0 bg-gray-950 flex flex-col overflow-hidden">
      {/* HUD Superior */}
      <GamificationHUD tema={program.tema} />

      {/* Botón evaluación final */}
      {todoCompleto && (
        <div className="absolute top-14 right-4 z-20">
          <button
            onClick={() => setScreen('evaluation')}
            className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-black hover:bg-amber-400 shadow-lg"
          >
            📝 Evaluación final →
          </button>
        </div>
      )}

      {/* Grafo */}
      <div ref={reactFlowRef} className="flex-1 relative">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          className="bg-gray-950"
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background color="#1f2937" gap={28} size={1} />
          <Controls
            className="[&>button]:bg-gray-800 [&>button]:border-gray-700 [&>button]:text-white"
            showInteractive={false}
          />
        </ReactFlow>

        {/* XP float overlay */}
        {xpFloat && (
          <XpFloatAnimation
            xp={xpFloat.xp}
            animKey={xpFloat.key}
            x={xpFloatPos.x}
            y={xpFloatPos.y}
          />
        )}
      </div>

      {/* Panel lateral de detalle */}
      <NodeDetailPanel
        nodo={selectedNodo}
        onClose={deselectNode}
        onComplete={handleComplete}
      />
    </div>
  )
}
