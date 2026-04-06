/**
 * A2UI Protocol v0.8 Renderer
 * Interpreta mensajes A2UI (surfaceUpdate / dataModelUpdate / beginRendering)
 * y los convierte en componentes React interactivos.
 */
import { useState, useMemo, useCallback } from 'react'

// ─── Tipos del protocolo A2UI ─────────────────────────────────────────────────

export interface BoundValue {
  literalString?: string
  path?: string
}

interface A2UIAction {
  name: string
  context?: Array<{ key: string; value: BoundValue }>
}

interface ComponentDef {
  id: string
  weight?: number
  component: Record<string, any>
}

interface SurfaceUpdate {
  surfaceId: string
  components: ComponentDef[]
}

interface DataEntry {
  key: string
  valueString?: string
  valueMap?: DataEntry[]
}

interface DataModelUpdate {
  surfaceId: string
  contents: DataEntry[]
}

interface BeginRendering {
  surfaceId: string
  root: string
  styles?: { font?: string; primaryColor?: string }
}

export interface A2UIMessage {
  surfaceUpdate?: SurfaceUpdate
  dataModelUpdate?: DataModelUpdate
  beginRendering?: BeginRendering
}

export interface A2UIRendererProps {
  messages: A2UIMessage[]
  onAction?: (action: { name: string; context: Record<string, any> }) => Promise<void>
  isLoading?: boolean
  feedback?: { correcto: boolean; mensajePrincipal: string; xpGanado: number; razonamiento?: string; pistaSiIncorrecto?: string } | null
}

// ─── Utilidades de data model ─────────────────────────────────────────────────

function parseDataEntries(entries: DataEntry[], base: Record<string, any> = {}): Record<string, any> {
  for (const entry of entries) {
    if (entry.valueString !== undefined) {
      base[entry.key] = entry.valueString
    } else if (entry.valueMap) {
      base[entry.key] = parseDataEntries(entry.valueMap, {})
    }
  }
  return base
}

function getAtPath(obj: Record<string, any>, path: string): string | undefined {
  // JSON Pointer style: /key/subkey
  const parts = path.replace(/^\//, '').split('/')
  let cur: any = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur != null ? String(cur) : undefined
}

function setAtPath(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const parts = path.replace(/^\//, '').split('/')
  const result = { ...obj }
  let cur: any = result
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { ...(cur[parts[i]] ?? {}) }
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
  return result
}

// ─── Renderer principal ───────────────────────────────────────────────────────

export function A2UIRenderer({ messages, onAction, isLoading, feedback }: A2UIRendererProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [textValues, setTextValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Construir component map, data model y root desde los mensajes
  const { compMap, dataModel, rootId } = useMemo(() => {
    const compMap: Record<string, ComponentDef> = {}
    let dm: Record<string, any> = {}
    let rootId = ''

    for (const msg of messages) {
      if (msg.surfaceUpdate) {
        for (const comp of msg.surfaceUpdate.components) {
          compMap[comp.id] = comp
        }
      }
      if (msg.dataModelUpdate) {
        dm = { ...dm, ...parseDataEntries(msg.dataModelUpdate.contents) }
      }
      if (msg.beginRendering) {
        rootId = msg.beginRendering.root
      }
    }
    return { compMap, dataModel: dm, rootId }
  }, [messages])

  const resolveValue = useCallback((bound: BoundValue): string => {
    if (bound.path) return getAtPath(dataModel, bound.path) ?? bound.literalString ?? ''
    return bound.literalString ?? ''
  }, [dataModel])

  const handleAction = useCallback(async (action: A2UIAction) => {
    const ctx: Record<string, any> = {}
    for (const entry of action.context ?? []) {
      ctx[entry.key] = resolveValue(entry.value)
    }
    // Merge selections and text values into context
    Object.assign(ctx, { _selections: selections, _textValues: textValues })
    setIsSubmitting(true)
    try {
      await onAction?.({ name: action.name, context: ctx })
    } finally {
      setIsSubmitting(false)
    }
  }, [onAction, resolveValue, selections, textValues])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-white/30 text-sm animate-pulse">Cargando contenido...</span>
      </div>
    )
  }

  if (!rootId || !compMap[rootId]) {
    return (
      <div className="flex items-center justify-center py-8 text-white/20 text-sm">
        Sin contenido disponible
      </div>
    )
  }

  return (
    <div className="a2ui-surface space-y-0">
      <RenderComponent
        id={rootId}
        compMap={compMap}
        resolveValue={resolveValue}
        selections={selections}
        setSelections={setSelections}
        textValues={textValues}
        setTextValues={setTextValues}
        onAction={handleAction}
        isSubmitting={isSubmitting}
        feedback={feedback}
      />
    </div>
  )
}

// ─── Render de componente individual ─────────────────────────────────────────

interface RenderCtx {
  id: string
  compMap: Record<string, ComponentDef>
  resolveValue: (b: BoundValue) => string
  selections: Record<string, string[]>
  setSelections: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  textValues: Record<string, string>
  setTextValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onAction: (a: A2UIAction) => Promise<void>
  isSubmitting: boolean
  feedback?: A2UIRendererProps['feedback']
  weight?: number
}

function RenderComponent(ctx: RenderCtx) {
  const def = ctx.compMap[ctx.id]
  if (!def) return null

  const type = Object.keys(def.component)[0]
  const props = def.component[type]
  const style: React.CSSProperties = {}
  if (ctx.weight) style.flex = ctx.weight

  switch (type) {
    case 'Column': return <ColumnComp {...ctx} props={props} style={style} />
    case 'Row':    return <RowComp {...ctx} props={props} style={style} />
    case 'Card':   return <CardComp {...ctx} props={props} style={style} />
    case 'Text':   return <TextComp {...ctx} props={props} style={style} />
    case 'Button': return <ButtonComp {...ctx} props={props} style={style} />
    case 'MultipleChoice': return <MultipleChoiceComp {...ctx} props={props} style={style} />
    case 'TextField':      return <TextFieldComp {...ctx} props={props} style={style} />
    case 'List':    return <ListComp {...ctx} props={props} style={style} />
    case 'Divider': return <DividerComp props={props} style={style} />
    case 'Image':   return <ImageComp {...ctx} props={props} style={style} />
    default: return null
  }
}

type WithProps = RenderCtx & { props: any; style?: React.CSSProperties }

function getChildren(props: any, compMap: Record<string, ComponentDef>, ctx: RenderCtx): React.ReactNode {
  const list: string[] = props.children?.explicitList ?? []
  return list.map((childId: string) => (
    <RenderComponent key={childId} {...ctx} id={childId} weight={compMap[childId]?.weight} />
  ))
}

function ColumnComp({ props, compMap, style, ...ctx }: WithProps) {
  const justifyMap: Record<string, string> = {
    start: 'flex-start', end: 'flex-end', center: 'center', spaceBetween: 'space-between',
  }
  return (
    <div
      className="flex flex-col"
      style={{
        gap: '12px',
        justifyContent: justifyMap[props.distribution] ?? 'flex-start',
        alignItems: props.alignment === 'center' ? 'center' : undefined,
        ...style,
      }}
    >
      {getChildren(props, compMap, { ...ctx, compMap })}
    </div>
  )
}

function RowComp({ props, compMap, style, ...ctx }: WithProps) {
  const justifyMap: Record<string, string> = {
    start: 'flex-start', end: 'flex-end', center: 'center', spaceBetween: 'space-between',
  }
  return (
    <div
      className="flex flex-row"
      style={{
        gap: '8px',
        justifyContent: justifyMap[props.distribution] ?? 'flex-start',
        alignItems: props.alignment === 'center' ? 'center' : 'flex-start',
        flexWrap: props.wrap ? 'wrap' : undefined,
        ...style,
      }}
    >
      {getChildren(props, compMap, { ...ctx, compMap })}
    </div>
  )
}

function CardComp({ props, compMap, style, ...ctx }: WithProps) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(255,255,255,0.08)',
        ...style,
      }}
    >
      {props.child && <RenderComponent {...ctx} compMap={compMap} id={props.child} />}
    </div>
  )
}

function TextComp({ props, resolveValue, style }: WithProps) {
  const text = typeof props.text === 'string' ? props.text : resolveValue(props.text ?? { literalString: '' })
  const hint: string = props.usageHint ?? 'body'

  // Simple markdown: **bold**, *italic*, `code`, \n → <br>
  function parseMarkdown(t: string): React.ReactNode {
    const parts = t.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\n)/g)
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} className="font-bold">{p.slice(2, -2)}</strong>
      if (p.startsWith('*') && p.endsWith('*'))   return <em key={i} className="italic">{p.slice(1, -1)}</em>
      if (p.startsWith('`') && p.endsWith('`'))   return <code key={i} className="font-mono text-green-300 bg-black/30 px-1 rounded text-[0.9em]">{p.slice(1, -1)}</code>
      if (p === '\n') return <br key={i} />
      return p
    })
  }

  const styleMap: Record<string, string> = {
    h1: 'text-2xl font-black text-white',
    h2: 'text-xl font-bold text-white',
    h3: 'text-base font-bold text-white',
    h4: 'text-sm font-semibold text-white/90',
    h5: 'text-xs font-semibold text-white/80',
    body: 'text-sm text-white/70 leading-relaxed',
    caption: 'text-xs text-white/40',
    label: 'text-xs font-semibold text-white/50 uppercase tracking-wider',
    code: 'font-mono text-xs text-green-300 bg-black/40 rounded-lg p-3 leading-relaxed whitespace-pre-wrap break-all',
  }

  const className = styleMap[hint] ?? styleMap.body

  if (hint === 'code') {
    return <pre className={className} style={style}>{text}</pre>
  }

  return (
    <p className={className} style={style}>
      {parseMarkdown(text)}
    </p>
  )
}

function ButtonComp({ props, compMap, resolveValue, onAction, isSubmitting, style, ...ctx }: WithProps) {
  const action: A2UIAction | undefined = props.action
  const variant: string = props.variant ?? 'primary'

  const variantClass = variant === 'primary'
    ? 'bg-blue-600 hover:bg-blue-500 text-white font-bold'
    : variant === 'secondary'
    ? 'bg-white/5 hover:bg-white/10 text-white/70 border border-white/10'
    : variant === 'success'
    ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-bold'
    : variant === 'danger'
    ? 'bg-red-600 hover:bg-red-500 text-white font-bold'
    : 'bg-blue-600 hover:bg-blue-500 text-white font-bold'

  return (
    <button
      onClick={() => action && onAction(action)}
      disabled={isSubmitting || props.disabled}
      className={`w-full py-2.5 rounded-xl text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${variantClass}`}
      style={style}
    >
      {isSubmitting && action?.name !== 'complete_node' ? (
        <>
          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          Evaluando...
        </>
      ) : (
        props.child
          ? <RenderComponent {...ctx} compMap={compMap} resolveValue={resolveValue} onAction={onAction} isSubmitting={isSubmitting} id={props.child} />
          : (props.label ?? 'Enviar')
      )}
    </button>
  )
}

function MultipleChoiceComp({ id, props, resolveValue, selections, setSelections, onAction, isSubmitting, feedback, style }: WithProps) {
  const maxSel = props.maxAllowedSelections ?? 1
  const current = selections[id] ?? []
  const hasFeedback = !!feedback

  const options: Array<{ label: BoundValue; value?: BoundValue }> = props.options ?? []

  const toggle = (val: string) => {
    if (hasFeedback || isSubmitting) return
    setSelections(prev => {
      const cur = prev[id] ?? []
      if (maxSel === 1) {
        return { ...prev, [id]: [val] }
      }
      if (cur.includes(val)) {
        return { ...prev, [id]: cur.filter(v => v !== val) }
      }
      if (cur.length >= maxSel) return prev
      return { ...prev, [id]: [...cur, val] }
    })
  }

  return (
    <div className="space-y-2" style={style}>
      {options.map((opt, i) => {
        const label = resolveValue(opt.label)
        const val = opt.value ? resolveValue(opt.value) : label
        const isSelected = current.includes(val)
        const letterLabel = String.fromCharCode(65 + i)

        const isCorrect = hasFeedback && feedback!.correcto && isSelected
        const isWrong   = hasFeedback && !feedback!.correcto && isSelected

        return (
          <button
            key={i}
            onClick={() => toggle(val)}
            disabled={hasFeedback || isSubmitting}
            className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all flex items-center gap-2.5
              ${isCorrect ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200' :
                isWrong   ? 'bg-red-500/15 border-red-500/60 text-red-200' :
                isSelected ? 'bg-blue-500/15 border-blue-500/50 text-blue-100' :
                'bg-white/[0.03] border-white/[0.08] text-white/65 hover:border-white/20 hover:bg-white/[0.06]'}
              ${hasFeedback && !isSelected ? 'opacity-40' : ''}
            `}
          >
            <span className={`text-xs font-bold w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors
              ${isSelected ? 'bg-blue-500/40 text-blue-200' : 'bg-white/5 text-white/40'}`}>
              {isCorrect ? '✓' : isWrong ? '✗' : letterLabel}
            </span>
            <span className="leading-snug">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TextFieldComp({ id, props, textValues, setTextValues, feedback, style }: WithProps) {
  const value = textValues[id] ?? ''
  const hasFeedback = !!feedback
  const isCode = props.textFieldType === 'code' || props.textFieldType === 'multiline_code'

  return (
    <div className="space-y-2" style={style}>
      {props.label && (
        <label className="text-xs font-semibold text-white/45 uppercase tracking-wider">
          {typeof props.label === 'string' ? props.label : props.label?.literalString ?? ''}
        </label>
      )}
      <textarea
        value={value}
        onChange={e => setTextValues(prev => ({ ...prev, [id]: e.target.value }))}
        disabled={hasFeedback}
        placeholder={props.placeholder ?? (isCode ? 'Escribe el código aquí...' : 'Escribe tu respuesta...')}
        rows={isCode ? 5 : 3}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm resize-none outline-none transition-all
          bg-white/[0.04] border-white/[0.08] focus:border-blue-500/50 focus:bg-white/[0.06]
          disabled:opacity-50 placeholder:text-white/20
          ${isCode ? 'font-mono text-green-300 leading-relaxed' : 'text-white/80 leading-relaxed'}`}
      />
    </div>
  )
}

function ListComp({ props, compMap, style, ...ctx }: WithProps) {
  const direction: string = props.direction ?? 'vertical'
  const items: string[] = props.items?.explicitList ?? []

  return (
    <div
      className={direction === 'horizontal' ? 'flex flex-row gap-2 overflow-x-auto pb-1' : 'flex flex-col gap-2'}
      style={style}
    >
      {items.map(itemId => (
        <RenderComponent key={itemId} {...ctx} compMap={compMap} id={itemId} />
      ))}
    </div>
  )
}

function DividerComp({ props, style }: { props: any; style?: React.CSSProperties }) {
  const isVertical = props.axis === 'vertical'
  return (
    <div
      className={isVertical ? 'w-px bg-white/[0.06] self-stretch' : 'h-px bg-white/[0.06] w-full'}
      style={style}
    />
  )
}

function ImageComp({ props, resolveValue, style }: WithProps) {
  const url = typeof props.url === 'string' ? props.url : resolveValue(props.url ?? { literalString: '' })
  if (!url) return null
  const fitMap: Record<string, string> = { contain: 'contain', cover: 'cover', fill: 'fill' }
  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.08]" style={style}>
      <img
        src={url}
        alt={props.alt ?? ''}
        className="w-full max-h-64 block"
        style={{ objectFit: (fitMap[props.fit] ?? 'contain') as any }}
      />
    </div>
  )
}

// ─── Feedback banner (usado externamente por NodeDetailPanel) ─────────────────
export function A2UIFeedbackBanner({ feedback }: {
  feedback: NonNullable<A2UIRendererProps['feedback']>
}) {
  return (
    <div className={`rounded-2xl border p-4 space-y-2 transition-all ${
      feedback.correcto
        ? 'bg-emerald-500/10 border-emerald-500/30'
        : 'bg-blue-500/10 border-blue-500/30'
    }`}>
      <div className="flex items-center gap-2.5">
        <span className="text-xl">{feedback.correcto ? '✅' : '💡'}</span>
        <span className={`text-sm font-bold flex-1 ${feedback.correcto ? 'text-emerald-300' : 'text-blue-300'}`}>
          {feedback.mensajePrincipal}
        </span>
        {feedback.xpGanado > 0 && (
          <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
            +{feedback.xpGanado} XP
          </span>
        )}
      </div>
      {feedback.razonamiento && (
        <p className="text-xs text-white/40 pl-9 leading-relaxed">{feedback.razonamiento}</p>
      )}
      {!feedback.correcto && feedback.pistaSiIncorrecto && (
        <p className="text-xs text-amber-300/60 pl-9 leading-relaxed">💡 {feedback.pistaSiIncorrecto}</p>
      )}
    </div>
  )
}
