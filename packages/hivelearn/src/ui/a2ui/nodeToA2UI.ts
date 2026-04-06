/**
 * Convierte un NodoLesson con su contenido en mensajes A2UI v0.8.
 * El resultado son 3 mensajes: surfaceUpdate + dataModelUpdate + beginRendering.
 */
import type { NodoLesson } from '../../types'
import type { A2UIMessage } from './A2UIRenderer'

const SURFACE_ID = 'lesson-node'

// ─── Helper para construir components ────────────────────────────────────────

type CompDef = { id: string; weight?: number; component: Record<string, any> }

function text(id: string, value: string, hint = 'body'): CompDef {
  return { id, component: { Text: { text: { literalString: value }, usageHint: hint } } }
}

function textPath(id: string, path: string, hint = 'body'): CompDef {
  return { id, component: { Text: { text: { path } } , usageHint: hint } }
}

function divider(id: string): CompDef {
  return { id, component: { Divider: { axis: 'horizontal' } } }
}

function column(id: string, children: string[], distribution?: string, alignment?: string): CompDef {
  return { id, component: { Column: { children: { explicitList: children }, distribution, alignment } } }
}

function row(id: string, children: string[], distribution?: string, wrap?: boolean): CompDef {
  return { id, component: { Row: { children: { explicitList: children }, distribution, wrap } } }
}

function card(id: string, child: string): CompDef {
  return { id, component: { Card: { child } } }
}

function button(id: string, label: string, actionName: string, context: Array<{ key: string; value: { literalString?: string; path?: string } }> = [], variant = 'primary'): CompDef {
  return {
    id,
    component: {
      Button: {
        label,
        variant,
        action: { name: actionName, context },
      },
    },
  }
}

function multipleChoice(id: string, options: string[], maxSel = 1): CompDef {
  return {
    id,
    component: {
      MultipleChoice: {
        options: options.map(op => ({ label: { literalString: op }, value: { literalString: op } })),
        maxAllowedSelections: maxSel,
      },
    },
  }
}

function textField(id: string, label: string, placeholder: string, isCode = false): CompDef {
  return {
    id,
    component: {
      TextField: {
        label: { literalString: label },
        placeholder,
        textFieldType: isCode ? 'multiline_code' : 'multiline',
      },
    },
  }
}

function listComp(id: string, items: string[], direction = 'vertical'): CompDef {
  return { id, component: { List: { items: { explicitList: items }, direction } } }
}

function image(id: string, url: string, fit = 'contain'): CompDef {
  return { id, component: { Image: { url: { literalString: url }, fit } } }
}

// ─── Sección de micro-evaluación ─────────────────────────────────────────────

function buildMicroEvalComponents(nodo: NodoLesson): { components: CompDef[]; children: string[] } {
  const me = nodo.contenido?.microEval
  if (!me) return { components: [], children: [] }

  const comps: CompDef[] = []
  const children: string[] = []

  comps.push(divider('me-divider'))
  comps.push(text('me-header', 'Verifica tu comprensión', 'label'))
  comps.push(text('me-question', me.pregunta, 'h4'))
  children.push('me-divider', 'me-header', 'me-question')

  if (me.tipo === 'multiple_choice' || me.tipo === 'verdadero_falso') {
    const options = me.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : (me.opciones ?? [])
    comps.push(multipleChoice('me-mc', options))
    children.push('me-mc')
    comps.push(button('me-submit', 'Comprobar respuesta ✓', 'check_answer', [
      { key: 'respuesta', value: { path: '/_selections/me-mc/0' } },
      { key: 'nodoId',    value: { literalString: nodo.id } },
      { key: 'concepto',  value: { literalString: nodo.concepto } },
      { key: 'tipoPedagogico', value: { literalString: nodo.tipoPedagogico } },
      { key: 'rangoEdad', value: { literalString: nodo.rangoEdad } },
    ]))
    children.push('me-submit')
  } else {
    // respuesta_corta / completar_codigo
    const isCode = me.tipo === 'completar_codigo'
    comps.push(textField('me-tf', '', isCode ? 'Escribe el código aquí...' : 'Escribe tu respuesta...', isCode))
    children.push('me-tf')
    comps.push(button('me-submit', isCode ? 'Enviar código ✓' : 'Enviar respuesta ✓', 'check_answer', [
      { key: 'respuesta', value: { path: '/_textValues/me-tf' } },
      { key: 'nodoId',    value: { literalString: nodo.id } },
      { key: 'concepto',  value: { literalString: nodo.concepto } },
      { key: 'tipoPedagogico', value: { literalString: nodo.tipoPedagogico } },
      { key: 'rangoEdad', value: { literalString: nodo.rangoEdad } },
    ]))
    children.push('me-submit')
  }

  if (me.pista) {
    comps.push(text('me-hint', `💡 Pista: ${me.pista}`, 'caption'))
    children.push('me-hint')
  }

  return { components: comps, children }
}

// ─── Builder principal ────────────────────────────────────────────────────────

export function nodeToA2UI(nodo: NodoLesson): A2UIMessage[] {
  const c = nodo.contenido
  const { components: meComps, children: meChildren } = buildMicroEvalComponents(nodo)

  let comps: CompDef[] = []
  let rootChildren: string[] = []
  let dataContents: any[] = []

  // ── Milestone ───────────────────────────────────────────────────────────────
  if (nodo.tipoPedagogico === 'milestone') {
    comps = [
      column('root', ['ms-trophy', 'ms-title', 'ms-concept', 'ms-xp', ...meChildren], 'center', 'center'),
      text('ms-trophy', '🏆', 'h1'),
      text('ms-title', nodo.titulo, 'h2'),
      text('ms-concept', nodo.concepto, 'body'),
      text('ms-xp', `⭐ +${nodo.xpRecompensa} XP al completar`, 'caption'),
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── Quiz ─────────────────────────────────────────────────────────────────────
  if (nodo.tipoPedagogico === 'quiz' && c?.quiz) {
    const q = c.quiz
    const opciones: string[] = Array.isArray(q.opciones) ? q.opciones : []
    comps = [
      column('root', ['q-question', 'q-mc', ...meChildren]),
      text('q-question', q.pregunta ?? nodo.concepto, 'h4'),
      multipleChoice('q-mc', opciones),
      button('q-check', 'Comprobar respuesta ✓', 'check_answer', [
        { key: 'respuesta',      value: { path: '/_selections/q-mc/0' } },
        { key: 'nodoId',         value: { literalString: nodo.id } },
        { key: 'concepto',       value: { literalString: nodo.concepto } },
        { key: 'tipoPedagogico', value: { literalString: nodo.tipoPedagogico } },
        { key: 'rangoEdad',      value: { literalString: nodo.rangoEdad } },
      ]),
      ...meComps,
    ]
    // Remplazar last child con q-check
    const rootKids = ['q-question', 'q-mc', 'q-check', ...(meChildren.length ? ['me-divider', ...meChildren.slice(1)] : [])]
    comps[0] = column('root', rootKids)
    return buildMessages(comps, dataContents)
  }

  // ── Exercise ─────────────────────────────────────────────────────────────────
  if (nodo.tipoPedagogico === 'exercise' && c?.ejercicio) {
    const ej = c.ejercicio
    const tfId = 'ex-answer'
    rootChildren = ['ex-card', tfId, 'ex-submit', ...meChildren]
    comps = [
      column('root', rootChildren),
      card('ex-card', 'ex-card-inner'),
      column('ex-card-inner', ['ex-label', 'ex-enunciado']),
      text('ex-label', '📝 Ejercicio', 'label'),
      text('ex-enunciado', ej.enunciado, 'body'),
      textField(tfId, 'Tu respuesta', 'Escribe aquí...'),
      button('ex-submit', 'Enviar respuesta ✓', 'check_answer', [
        { key: 'respuesta',      value: { path: `/_textValues/${tfId}` } },
        { key: 'nodoId',         value: { literalString: nodo.id } },
        { key: 'concepto',       value: { literalString: nodo.concepto } },
        { key: 'tipoPedagogico', value: { literalString: nodo.tipoPedagogico } },
        { key: 'rangoEdad',      value: { literalString: nodo.rangoEdad } },
      ]),
      ...meComps,
    ]
    if (ej.pistaOpcional) {
      comps.push(text('ex-hint', `💡 ${ej.pistaOpcional}`, 'caption'))
      const r = comps[0].component.Column
      r.children.explicitList.splice(2, 0, 'ex-hint')
    }
    return buildMessages(comps, dataContents)
  }

  // ── Challenge ────────────────────────────────────────────────────────────────
  if (nodo.tipoPedagogico === 'challenge' && c?.reto) {
    const r = c.reto
    const pasos: string[] = Array.isArray(r.pasos) ? r.pasos : []
    const criterios: string[] = Array.isArray(r.criteriosExito) ? r.criteriosExito : []
    const stepIds = pasos.map((_, i) => `reto-step-${i}`)
    const criteriaIds = criterios.map((_, i) => `reto-crit-${i}`)
    const stepComps = pasos.map((paso, i) => row(`reto-step-${i}`, [`reto-step-${i}-num`, `reto-step-${i}-text`], 'start'))
    const stepNumComps = pasos.map((_, i) => text(`reto-step-${i}-num`, `${i + 1}.`, 'h5'))
    const stepTextComps = pasos.map((paso, i) => text(`reto-step-${i}-text`, paso, 'body'))
    const critComps = criterios.map((c, i) => text(`reto-crit-${i}`, `✓ ${c}`, 'caption'))

    comps = [
      column('root', ['reto-card', 'reto-steps-label', 'reto-steps', 'reto-crit-label', 'reto-crits', ...meChildren]),
      card('reto-card', 'reto-card-inner'),
      column('reto-card-inner', ['reto-header', 'reto-titulo', 'reto-contexto']),
      text('reto-header', '⚡ Reto', 'label'),
      text('reto-titulo', r.titulo, 'h3'),
      text('reto-contexto', r.contexto, 'body'),
      text('reto-steps-label', 'Pasos a seguir', 'label'),
      listComp('reto-steps', stepIds),
      ...stepComps, ...stepNumComps, ...stepTextComps,
      text('reto-crit-label', 'Criterios de éxito', 'label'),
      listComp('reto-crits', criteriaIds),
      ...critComps,
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── Code ─────────────────────────────────────────────────────────────────────
  if (nodo.tipoVisual === 'code_block' && c?.codigo) {
    const cod = c.codigo
    comps = [
      column('root', ['code-lang-row', 'code-block', 'code-desc', ...meChildren]),
      row('code-lang-row', ['code-lang-badge']),
      text('code-lang-badge', (cod.lenguaje ?? 'code').toUpperCase(), 'caption'),
      text('code-block', cod.codigo, 'code'),
      ...(cod.descripcionBreve ? [text('code-desc', cod.descripcionBreve, 'caption')] : []),
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── SVG Diagram ───────────────────────────────────────────────────────────────
  if (nodo.tipoVisual === 'svg_diagram' && c?.svg?.svgString) {
    // Encode SVG as data URI for the Image component
    const svgSafe = c.svg.svgString.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+="[^"]*"/gi, '')
    const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgSafe)}`
    comps = [
      column('root', ['svg-img', ...meChildren]),
      image('svg-img', dataUri, 'contain'),
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── Infographic ───────────────────────────────────────────────────────────────
  if (nodo.tipoVisual === 'infographic' && c?.infografia) {
    const secs: any[] = Array.isArray(c.infografia.secciones) ? c.infografia.secciones : []
    const secIds = secs.map((_, i) => `inf-sec-${i}`)
    const secCards = secs.map((s, i) => card(`inf-sec-${i}`, `inf-sec-${i}-inner`))
    const secInners = secs.map((s, i) =>
      row(`inf-sec-${i}-inner`, [`inf-sec-${i}-emoji`, `inf-sec-${i}-content`], 'start')
    )
    const secEmojis = secs.map((s, i) => text(`inf-sec-${i}-emoji`, s.emoji, 'h3'))
    const secContents = secs.flatMap((s, i) => [
      column(`inf-sec-${i}-content`, [`inf-sec-${i}-title`, `inf-sec-${i}-val`]),
      text(`inf-sec-${i}-title`, s.titulo, 'h5'),
      text(`inf-sec-${i}-val`, s.valor, 'body'),
    ])

    comps = [
      column('root', ['inf-list', ...meChildren]),
      listComp('inf-list', secIds),
      ...secCards, ...secInners, ...secEmojis, ...secContents,
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── GIF Guide ─────────────────────────────────────────────────────────────────
  if (nodo.tipoVisual === 'gif_guide' && c?.gifFrames) {
    const frames: any[] = Array.isArray(c.gifFrames.frames) ? c.gifFrames.frames : []
    const frameIds = frames.map((_, i) => `gif-frame-${i}`)
    const frameCards = frames.flatMap((f, i) => [
      card(`gif-frame-${i}`, `gif-frame-${i}-inner`),
      column(`gif-frame-${i}-inner`, [`gif-${i}-emoji`, `gif-${i}-text`], 'center', 'center'),
      text(`gif-${i}-emoji`, f.emoji, 'h2'),
      text(`gif-${i}-text`, f.texto, 'caption'),
    ])

    comps = [
      column('root', ['gif-label', 'gif-list', ...meChildren]),
      text('gif-label', 'Paso a paso', 'label'),
      listComp('gif-list', frameIds, 'horizontal'),
      ...frameCards,
      ...meComps,
    ]
    return buildMessages(comps, dataContents)
  }

  // ── Evaluation ───────────────────────────────────────────────────────────────
  if (nodo.tipoPedagogico === 'evaluation' && c?.evaluacion) {
    const pregs: any[] = Array.isArray(c.evaluacion.preguntas) ? c.evaluacion.preguntas : []
    const qComps: CompDef[] = []
    const qChildIds: string[] = []

    pregs.forEach((p, i) => {
      qChildIds.push(`eval-q-${i}-text`)
      qComps.push(text(`eval-q-${i}-text`, `${i + 1}. ${p.pregunta}`, 'h5'))
      if (p.tipo === 'multiple_choice' && p.opciones) {
        qChildIds.push(`eval-q-${i}-mc`)
        qComps.push(multipleChoice(`eval-q-${i}-mc`, p.opciones))
      } else {
        qChildIds.push(`eval-q-${i}-tf`)
        qComps.push(textField(`eval-q-${i}-tf`, '', 'Escribe tu respuesta...'))
      }
      if (i < pregs.length - 1) {
        qChildIds.push(`eval-div-${i}`)
        qComps.push(divider(`eval-div-${i}`))
      }
    })

    comps = [
      column('root', [...qChildIds, 'eval-submit']),
      ...qComps,
      button('eval-submit', 'Enviar evaluación ✓', 'submit_evaluation', [
        { key: 'nodoId', value: { literalString: nodo.id } },
      ]),
    ]
    return buildMessages(comps, dataContents)
  }

  // ── Concept / animated_card / text_card / default ─────────────────────────
  if (c?.explicacion) {
    const exp = c.explicacion
    rootChildren = ['exp-title', 'exp-body', ...meChildren]
    comps = [
      column('root', rootChildren),
      text('exp-title', exp.titulo ?? nodo.titulo, 'h3'),
      text('exp-body', exp.explicacion ?? exp.descripcion ?? nodo.concepto, 'body'),
      ...meComps,
    ]
    if (exp.ejemploConcreto) {
      comps.push(card('exp-example-card', 'exp-example-inner'))
      comps.push(column('exp-example-inner', ['exp-example-label', 'exp-example-text']))
      comps.push(text('exp-example-label', 'Ejemplo', 'label'))
      comps.push(text('exp-example-text', exp.ejemploConcreto, 'body'))
      const rootComp = comps[0].component.Column
      rootComp.children.explicitList.splice(2, 0, 'exp-example-card')
    }
    return buildMessages(comps, dataContents)
  }

  // ── Fallback vacío ────────────────────────────────────────────────────────────
  comps = [
    column('root', ['fallback-text', ...meChildren]),
    text('fallback-text', nodo.concepto || 'Contenido en preparación...', 'body'),
    ...meComps,
  ]
  return buildMessages(comps, dataContents)
}

// ─── Builder de mensajes finales ──────────────────────────────────────────────

function buildMessages(components: CompDef[], dataContents: any[]): A2UIMessage[] {
  return [
    {
      surfaceUpdate: {
        surfaceId: SURFACE_ID,
        components,
      },
    },
    {
      dataModelUpdate: {
        surfaceId: SURFACE_ID,
        contents: dataContents,
      },
    },
    {
      beginRendering: {
        surfaceId: SURFACE_ID,
        root: 'root',
        styles: {
          primaryColor: '#3b82f6',
        },
      },
    },
  ]
}
