import { useState } from 'react'
import type { NodoLesson, FeedbackOutput, MicroEvaluacion } from '../../types'

interface Props {
  nodo: NodoLesson
  feedback: FeedbackOutput | null
  isSubmitting: boolean
  onSubmit: (respuesta: string) => Promise<void>
}

export function MicroEvalPanel({ nodo, feedback, isSubmitting, onSubmit }: Props) {
  const microEval = nodo.contenido?.microEval
  const [selected, setSelected] = useState<string | null>(null)
  const [input, setInput] = useState('')

  if (!microEval) return null

  const handleSubmit = async (respuesta: string) => {
    if (!respuesta.trim()) return
    await onSubmit(respuesta)
  }

  return (
    <div className="border-t border-gray-700/60 pt-4 space-y-3">
      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
        Verifica tu comprensión
      </p>
      <p className="text-white text-sm font-medium">{microEval.pregunta}</p>

      {microEval.tipo === 'verdadero_falso' && (
        <VerdaderoFalso
          selected={selected}
          onSelect={setSelected}
          feedback={feedback}
          disabled={!!feedback || isSubmitting}
          onSubmit={handleSubmit}
        />
      )}

      {microEval.tipo === 'multiple_choice' && (
        <MultipleChoice
          opciones={microEval.opciones ?? []}
          selected={selected}
          onSelect={setSelected}
          feedback={feedback}
          disabled={!!feedback || isSubmitting}
          onSubmit={handleSubmit}
        />
      )}

      {(microEval.tipo === 'respuesta_corta' || microEval.tipo === 'completar_codigo') && (
        <RespuestaCorta
          tipo={microEval.tipo}
          value={input}
          onChange={setInput}
          feedback={feedback}
          disabled={!!feedback || isSubmitting}
          isSubmitting={isSubmitting}
          onSubmit={() => handleSubmit(input)}
        />
      )}

      {/* Feedback de IA */}
      {feedback && (
        <FeedbackBanner feedback={feedback} />
      )}

      {/* Pista */}
      {!feedback && microEval.pista && (
        <details className="group">
          <summary className="text-xs text-blue-400/70 cursor-pointer hover:text-blue-400 list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block text-xs">▶</span>
            Ver pista
          </summary>
          <p className="mt-1 text-xs text-gray-200/60 pl-4">{microEval.pista}</p>
        </details>
      )}
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function VerdaderoFalso({ selected, onSelect, feedback, disabled, onSubmit }: {
  selected: string | null
  onSelect: (v: string) => void
  feedback: FeedbackOutput | null
  disabled: boolean
  onSubmit: (v: string) => void
}) {
  return (
    <div className="flex gap-3">
      {['Verdadero', 'Falso'].map((op) => {
        const isSelected = selected === op
        const isCorrect = feedback?.correcto && isSelected
        const isWrong = !feedback?.correcto && isSelected && !!feedback
        return (
          <button
            key={op}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              onSelect(op)
              onSubmit(op)
            }}
            className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all
              ${isCorrect ? 'bg-green-500/20 border-green-500 text-green-300' :
                isWrong ? 'bg-red-500/20 border-red-500 text-red-300' :
                isSelected ? 'bg-blue-500/20 border-blue-500 text-blue-200' :
                'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'}
              ${disabled && !isSelected ? 'opacity-40' : ''}
            `}
          >
            {op === 'Verdadero' ? '✅ Verdadero' : '❌ Falso'}
          </button>
        )
      })}
    </div>
  )
}

function MultipleChoice({ opciones, selected, onSelect, feedback, disabled, onSubmit }: {
  opciones: string[]
  selected: string | null
  onSelect: (v: string) => void
  feedback: FeedbackOutput | null
  disabled: boolean
  onSubmit: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {opciones.map((op, i) => {
        const label = String.fromCharCode(65 + i)
        const isSelected = selected === op
        const isCorrect = feedback?.correcto && isSelected
        const isWrong = !feedback?.correcto && isSelected && !!feedback
        return (
          <button
            key={i}
            disabled={disabled}
            onClick={() => {
              if (disabled) return
              onSelect(op)
              onSubmit(op)
            }}
            className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all flex items-center gap-2
              ${isCorrect ? 'bg-green-500/15 border-green-500/60 text-green-200' :
                isWrong ? 'bg-red-500/15 border-red-500/60 text-red-200' :
                isSelected ? 'bg-blue-500/15 border-blue-500/50 text-blue-100' :
                'bg-gray-800/60 border-gray-700 text-gray-300 hover:border-gray-500'}
              ${disabled && !isSelected ? 'opacity-40' : ''}
            `}
          >
            <span className={`text-xs font-bold w-5 h-5 rounded flex items-center justify-center flex-shrink-0
              ${isSelected ? 'bg-blue-500/30 text-blue-300' : 'bg-gray-700 text-gray-400'}`}>
              {label}
            </span>
            {op}
          </button>
        )
      })}
    </div>
  )
}

function RespuestaCorta({ tipo, value, onChange, feedback, disabled, isSubmitting, onSubmit }: {
  tipo: string
  value: string
  onChange: (v: string) => void
  feedback: FeedbackOutput | null
  disabled: boolean
  isSubmitting: boolean
  onSubmit: () => void
}) {
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={tipo === 'completar_codigo' ? 'Escribe el código aquí...' : 'Escribe tu respuesta...'}
        rows={3}
        className={`w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none transition-all
          ${tipo === 'completar_codigo' ? 'font-mono bg-gray-950 text-green-300 border-gray-700' :
            'bg-gray-800/60 text-gray-100 border-gray-700'}
          focus:border-blue-500/60 disabled:opacity-50
        `}
      />
      {!feedback && (
        <button
          onClick={onSubmit}
          disabled={disabled || isSubmitting || !value.trim()}
          className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-black/30 border-t-black animate-spin" />
              Evaluando...
            </span>
          ) : 'Enviar respuesta ✓'}
        </button>
      )}
    </div>
  )
}

function FeedbackBanner({ feedback }: { feedback: FeedbackOutput }) {
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 transition-all
      ${feedback.correcto
        ? 'bg-green-500/10 border-green-500/40'
        : 'bg-blue-500/10 border-blue-500/40'}`}>
      <div className="flex items-center gap-2">
        <span className="text-base">{feedback.correcto ? '✅' : '💡'}</span>
        <span className={`text-sm font-bold ${feedback.correcto ? 'text-green-300' : 'text-blue-300'}`}>
          {feedback.mensajePrincipal ?? (feedback as any).mensaje}
        </span>
        <span className="ml-auto text-xs font-bold text-amber-400">+{feedback.xpGanado} XP</span>
      </div>
      {feedback.razonamiento && (
        <p className="text-xs text-gray-400 pl-6">{feedback.razonamiento}</p>
      )}
      {!feedback.correcto && feedback.pistaSiIncorrecto && (
        <p className="text-xs text-amber-300/70 pl-6">{feedback.pistaSiIncorrecto}</p>
      )}
    </div>
  )
}
