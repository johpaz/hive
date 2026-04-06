import type { NodoLesson } from '../../types'

interface Props {
  nodo: NodoLesson
}

/** Renderiza el contenido rico de un nodo según su tipoPedagogico + tipoVisual */
export function NodeContentRenderer({ nodo }: Props) {
  const c = nodo.contenido

  if (!c || Object.keys(c).length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-white/30 text-sm">
        <span className="animate-pulse">Generando contenido...</span>
      </div>
    )
  }

  // Milestone — siempre celebración
  if (nodo.tipoPedagogico === 'milestone') {
    return <MilestoneCard nodo={nodo} />
  }

  // gif_guide tiene prioridad sobre tipo pedagógico
  if (nodo.tipoVisual === 'gif_guide' && c.gifFrames) {
    return <GifCard frames={c.gifFrames.frames} />
  }

  // image_ai
  if (nodo.tipoVisual === 'image_ai' && c.imagen) {
    return <ImageCard imagen={c.imagen} />
  }

  // audio_ai
  if (nodo.tipoVisual === 'audio_ai' && c.audio) {
    return <AudioCard audio={c.audio} />
  }

  // Por tipoPedagogico
  if (nodo.tipoPedagogico === 'exercise' && c.ejercicio) {
    return <EjercicioCard ejercicio={c.ejercicio} />
  }
  if (nodo.tipoPedagogico === 'quiz' && c.quiz) {
    return <QuizInfoCard quiz={c.quiz} />
  }
  if (nodo.tipoPedagogico === 'challenge' && c.reto) {
    return <RetoCard reto={c.reto} />
  }

  // Por tipoVisual para concept/evaluation
  if (nodo.tipoVisual === 'code_block' && c.codigo) {
    return <CodigoCard codigo={c.codigo} />
  }
  if (nodo.tipoVisual === 'svg_diagram' && c.svg) {
    return <SVGCard svg={c.svg} />
  }
  if (nodo.tipoVisual === 'infographic' && c.infografia) {
    return <InfografiaCard infografia={c.infografia} />
  }
  if (nodo.tipoVisual === 'chart' && c.infografia) {
    return <ChartCard infografia={c.infografia} />
  }
  if (nodo.tipoVisual === 'animated_card' && c.explicacion) {
    return <AnimatedCard explicacion={c.explicacion} />
  }

  // Default: text_card / explicacion
  if (c.explicacion) {
    return <ExplicacionCard explicacion={c.explicacion} />
  }

  // Fallback genérico
  return (
    <div className="rounded-xl bg-gray-800/60 p-4 text-white/60 text-sm font-mono overflow-auto max-h-64">
      <pre>{JSON.stringify(c, null, 2)}</pre>
    </div>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function ExplicacionCard({ explicacion }: { explicacion: NonNullable<NodoLesson['contenido']>['explicacion'] }) {
  if (!explicacion) return null
  return (
    <div className="space-y-3">
      <h3 className="text-white font-bold text-base">{explicacion.titulo}</h3>
      <p className="text-gray-300 text-sm leading-relaxed">{explicacion.explicacion}</p>
      {explicacion.ejemploConcreto && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs text-amber-400 font-semibold mb-1">Ejemplo</p>
          <p className="text-amber-100/80 text-sm">{explicacion.ejemploConcreto}</p>
        </div>
      )}
    </div>
  )
}

function CodigoCard({ codigo }: { codigo: NonNullable<NodoLesson['contenido']>['codigo'] }) {
  if (!codigo) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 font-mono">{codigo.lenguaje}</span>
        <button
          onClick={() => navigator.clipboard.writeText(codigo.codigo)}
          className="text-xs text-gray-500 hover:text-amber-400 transition-colors"
        >
          📋 Copiar
        </button>
      </div>
      <pre className="rounded-lg bg-gray-950 border border-gray-700 p-3 text-xs text-green-300 font-mono overflow-x-auto leading-relaxed">
        {codigo.codigo}
      </pre>
      {codigo.descripcionBreve && (
        <p className="text-gray-400 text-xs">{codigo.descripcionBreve}</p>
      )}
    </div>
  )
}

function SVGCard({ svg }: { svg: NonNullable<NodoLesson['contenido']>['svg'] }) {
  if (!svg) return null
  // Sanitización básica — en producción usar DOMPurify
  const safe = svg.svgString.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '')
  return (
    <div
      className="rounded-lg overflow-hidden border border-gray-700 bg-gray-900 flex items-center justify-center p-2 max-h-72"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

function InfografiaCard({ infografia }: { infografia: NonNullable<NodoLesson['contenido']>['infografia'] }) {
  if (!infografia) return null
  return (
    <div className="grid grid-cols-1 gap-2">
      {infografia.secciones.map((s, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg bg-gray-800/50 border border-gray-700/50 p-3">
          <span className="text-2xl flex-shrink-0">{s.emoji}</span>
          <div>
            <p className="text-white font-semibold text-sm">{s.titulo}</p>
            <p className="text-gray-300 text-xs mt-0.5">{s.valor}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ infografia }: { infografia: NonNullable<NodoLesson['contenido']>['infografia'] }) {
  if (!infografia) return null
  // Barchart simple con CSS — no requiere Recharts
  const max = Math.max(...infografia.secciones.map(s => parseFloat(s.valor) || 1))
  return (
    <div className="space-y-2">
      {infografia.secciones.map((s, i) => {
        const val = parseFloat(s.valor) || 0
        const pct = max > 0 ? (val / max) * 100 : 0
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{s.emoji} {s.titulo}</span>
              <span className="text-amber-300">{s.valor}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-600 to-yellow-400 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AnimatedCard({ explicacion }: { explicacion: NonNullable<NodoLesson['contenido']>['explicacion'] }) {
  if (!explicacion) return null
  return (
    <div className="space-y-3">
      <h3 className="text-white font-bold text-base animate-pulse">{explicacion.titulo}</h3>
      <p className="text-gray-300 text-sm leading-relaxed">{explicacion.explicacion}</p>
      {explicacion.ejemploConcreto && (
        <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3 animate-pulse" style={{ animationDuration: '3s' }}>
          <p className="text-purple-200/80 text-sm">{explicacion.ejemploConcreto}</p>
        </div>
      )}
    </div>
  )
}

function ImageCard({ imagen }: { imagen: NonNullable<NodoLesson['contenido']>['imagen'] }) {
  if (!imagen) return null
  const src = imagen.url ?? (imagen.base64 ? `data:image/png;base64,${imagen.base64}` : null)
  return (
    <div className="space-y-2">
      {src ? (
        <img
          src={src}
          alt={imagen.descripcionAlt}
          className="rounded-lg w-full object-contain max-h-60 border border-gray-700"
        />
      ) : imagen.svgFallback ? (
        <div
          className="rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center"
          dangerouslySetInnerHTML={{ __html: imagen.svgFallback.replace(/<script[\s\S]*?<\/script>/gi, '') }}
        />
      ) : (
        <div className="rounded-lg bg-gray-800 border border-gray-700 h-40 flex items-center justify-center text-gray-500 text-sm">
          {imagen.descripcionAlt}
        </div>
      )}
      {imagen.caption && (
        <p className="text-xs text-gray-400 italic text-center">{imagen.caption}</p>
      )}
    </div>
  )
}

function AudioCard({ audio }: { audio: NonNullable<NodoLesson['contenido']>['audio'] }) {
  if (!audio) return null
  return (
    <div className="space-y-3 rounded-lg bg-blue-500/5 border border-blue-500/20 p-4">
      <div className="flex items-center gap-2 text-blue-300">
        <span className="text-xl">🎵</span>
        <span className="text-sm font-semibold">Contenido auditivo</span>
        <span className="text-xs text-blue-400/60">~{audio.duracionEstimada}s</span>
      </div>
      <p className="text-gray-300 text-sm leading-relaxed">{audio.texto}</p>
    </div>
  )
}

function EjercicioCard({ ejercicio }: { ejercicio: NonNullable<NodoLesson['contenido']>['ejercicio'] }) {
  if (!ejercicio) return null
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
        <p className="text-xs text-blue-400 font-semibold mb-1">📝 Ejercicio</p>
        <p className="text-white text-sm">{ejercicio.enunciado}</p>
      </div>
      {ejercicio.pistaOpcional && (
        <details className="group">
          <summary className="text-xs text-amber-400 cursor-pointer hover:text-amber-300 list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Ver pista
          </summary>
          <p className="mt-1 text-xs text-amber-200/70 pl-4">{ejercicio.pistaOpcional}</p>
        </details>
      )}
    </div>
  )
}

function QuizInfoCard({ quiz }: { quiz: NonNullable<NodoLesson['contenido']>['quiz'] }) {
  if (!quiz) return null
  return (
    <div className="space-y-3">
      <p className="text-white font-medium text-sm">{quiz.pregunta}</p>
      <div className="space-y-1.5">
        {quiz.opciones.map((op, i) => (
          <div key={i} className={`rounded-lg border px-3 py-2 text-sm
            ${i === quiz.indicesCorrecto
              ? 'bg-green-500/10 border-green-500/30 text-green-200'
              : 'bg-gray-800/50 border-gray-700 text-gray-300'}`}>
            <span className="font-bold mr-2 text-xs text-gray-500">{String.fromCharCode(65 + i)}.</span>
            {op}
          </div>
        ))}
      </div>
    </div>
  )
}

function RetoCard({ reto }: { reto: NonNullable<NodoLesson['contenido']>['reto'] }) {
  if (!reto) return null
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3">
        <p className="text-xs text-purple-400 font-semibold mb-1">⚡ Reto</p>
        <p className="text-white text-sm font-medium">{reto.titulo}</p>
        <p className="text-gray-400 text-xs mt-1">{reto.contexto}</p>
      </div>
      <div className="space-y-1.5">
        {reto.pasos.map((paso, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-gray-300">
            <span className="text-amber-400 font-bold text-xs mt-0.5 flex-shrink-0">{i + 1}.</span>
            <span>{paso}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MilestoneCard({ nodo }: { nodo: NodoLesson }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 space-y-3 text-center">
      <div className="text-5xl animate-bounce">🏆</div>
      <h3 className="text-white font-black text-lg">{nodo.titulo}</h3>
      <p className="text-amber-300 text-sm">{nodo.concepto}</p>
      <div className="text-xs text-gray-400 mt-2">
        +{nodo.xpRecompensa} XP al completar
      </div>
    </div>
  )
}

function GifCard({ frames }: { frames: Array<{ emoji: string; texto: string; duracionMs: number }> | undefined }) {
  if (!frames?.length) return null
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 font-semibold">Paso a paso</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {frames.map((f, i) => (
          <div
            key={i}
            className="flex-shrink-0 rounded-lg bg-gray-800 border border-gray-700 p-3 text-center min-w-[80px]"
          >
            <div className="text-2xl">{f.emoji}</div>
            <p className="text-xs text-gray-300 mt-1 leading-tight">{f.texto}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
