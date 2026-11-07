/**
 * Escenarios del benchmark de compactación.
 *
 * Una conversación larga y reproducible (misma semilla, mismos mensajes) con
 * datos PLANTADOS en distintos momentos: hechos exactos, una preferencia, una
 * decisión, enfoques que ya fallaron y un paso pendiente. Entre ellos va
 * relleno realista con valores parecidos (señuelos), para que un resumen que
 * confunde un valor con otro se note. Los valores cambian con la semilla, así
 * que un modelo no puede acertar de memoria.
 *
 * Los datos se plantan en los primeros tramos y nunca en el último, para que
 * pasen por varias compactaciones seguidas: lo que la primera retuvo tiene que
 * sobrevivir a las siguientes.
 */

export type ItemKind = "fact" | "preference" | "decision" | "dead_end" | "plan"

export interface BenchMessage {
  /** Número de secuencia, 1 en adelante, como en el almacén real. */
  id: number
  role: "user" | "assistant"
  content: string
}

export interface PlantedItem {
  id: string
  kind: ItemKind
  /** Tramo (0 = el más antiguo) en que se planta. */
  segment: number
  /** Posición en `messages`. */
  messageIndex: number
  /** La frase plantada. */
  text: string
  /**
   * Qué debe aparecer para darlo por retenido: todos los grupos (Y), y en cada
   * grupo basta una alternativa (O). Sin tildes ni mayúsculas.
   */
  expect: string[][]
  /** La pregunta con la que se comprueba que quien lea el resumen lo sabe. */
  question: string
}

export interface Scenario {
  seed: number
  messages: BenchMessage[]
  /** Índice (exclusivo) donde termina cada tramo. */
  segmentEnds: number[]
  items: PlantedItem[]
}

export interface ScenarioOptions {
  /** Cuántos tramos; tras cada uno se compacta. Mínimo 3. */
  segments?: number
  /** Mensajes por tramo. */
  messagesPerSegment?: number
}

/** PRNG pequeño y determinista (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ["ZETA", "OMEGA", "KAPPA", "SIGMA", "DELTA", "TAURO", "NOVA", "LIRA"]
const SLUGS = ["alegra", "factura", "siigo", "contab", "nomina", "tesoro"]
const FILES = ["cola", "cache", "tokens", "webhooks", "ledger", "export"]

export function buildScenario(seed: number, options: ScenarioOptions = {}): Scenario {
  const segments = Math.max(3, options.segments ?? 4)
  const perSegment = Math.max(12, options.messagesPerSegment ?? 30)
  const rand = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const digits = (n: number) => String(int(10 ** (n - 1), 10 ** n - 1))

  // Valores plantados (únicos por semilla).
  const slug = pick(SLUGS)
  const stgUrl = `https://stg.${slug}.example/api/v${int(2, 9)}`
  const stgId = `STG-${digits(4)}-${pick(WORDS)}`
  const limit = int(110, 480)
  const clientFile = `src/billing/${pick(FILES)}_client.ts`
  const sdkName = `${slug}-sdk-${int(2, 9)}`
  const wal = pick(["SQLite en modo WAL", "Postgres con LISTEN/NOTIFY", "Redis Streams"])

  // Qué se planta y dónde (tramo). Nunca en el último.
  const spec: Array<Omit<PlantedItem, "messageIndex">> = [
    {
      id: "url", kind: "fact", segment: 0,
      text: `el endpoint de staging es ${stgUrl}`,
      expect: [[stgUrl]], question: "¿Cuál es el endpoint de staging?",
    },
    {
      id: "token", kind: "fact", segment: 0,
      text: `el token de staging es ${stgId}`,
      expect: [[stgId]], question: "¿Cuál es el token de staging?",
    },
    {
      id: "basic401", kind: "dead_end", segment: 0,
      text: "probamos autenticación Basic y respondió 401; no la repitas, hay que usar el token Bearer",
      expect: [["basic"], ["401"]], question: "¿Qué enfoque de autenticación ya falló y con qué error?",
    },
    {
      id: "formal", kind: "preference", segment: 0,
      text: "responde siempre en tono formal y sin emojis",
      expect: [["formal"], ["emoji", "emoticon"]], question: "¿Qué tono y estilo prefiere el usuario?",
    },
    {
      id: "file", kind: "fact", segment: Math.min(1, segments - 2),
      text: `el cliente HTTP vive en ${clientFile}`,
      expect: [[clientFile]], question: "¿En qué archivo vive el cliente HTTP?",
    },
    {
      id: "queue", kind: "decision", segment: Math.min(1, segments - 2),
      text: `decidimos usar ${wal} para la cola de reintentos`,
      expect: [[wal.split(" ")[0]!.toLowerCase()]], question: "¿Qué tecnología se decidió usar para la cola de reintentos?",
    },
    {
      id: "limit", kind: "fact", segment: Math.min(1, segments - 2),
      text: `el límite de la API es de ${limit} peticiones por minuto`,
      expect: [[String(limit)]], question: "¿Cuál es el límite de peticiones por minuto de la API?",
    },
    {
      id: "sdk", kind: "dead_end", segment: Math.min(2, segments - 2),
      text: `el paquete ${sdkName} está abandonado, no lo uses`,
      expect: [[sdkName]], question: "¿Qué paquete está abandonado y no se debe usar?",
    },
    {
      id: "credit", kind: "plan", segment: Math.min(2, segments - 2),
      text: "falta probar la nota crédito y después desplegar a producción",
      expect: [["nota credito"]], question: "¿Qué falta por probar antes de desplegar a producción?",
    },
  ]

  const total = segments * perSegment
  const messages: BenchMessage[] = []
  for (let i = 0; i < total; i++) {
    messages.push({ id: i + 1, role: i % 2 === 0 ? "user" : "assistant", content: filler(i, rand, int, pick, digits) })
  }

  // Un hueco por dato dentro de su tramo; el rol según el tipo (las preferencias las dice el usuario).
  const used = new Set<number>()
  const items: PlantedItem[] = spec.map((s) => {
    const wantUser = s.kind === "preference" || s.kind === "plan" || s.kind === "decision"
    const base = s.segment * perSegment
    let index: number
    do {
      index = base + int(2, perSegment - 3)
      if ((index % 2 === 0) !== wantUser) index += 1
    } while (used.has(index))
    used.add(index)
    const content = wantUser ? `Ten en cuenta: ${s.text}.` : `Resultado de la revisión: ${s.text}.`
    messages[index] = { ...messages[index]!, content }
    return { ...s, messageIndex: index }
  })

  return {
    seed,
    messages,
    segmentEnds: Array.from({ length: segments }, (_, i) => (i + 1) * perSegment),
    items,
  }
}

/** Relleno de un agente trabajando: salidas de herramientas con valores señuelo. */
function filler(
  i: number,
  rand: () => number,
  int: (lo: number, hi: number) => number,
  pick: <T>(xs: T[]) => T,
  digits: (n: number) => string,
): string {
  if (i % 2 === 0) {
    return pick([
      `¿Puedes revisar el módulo ${pick(FILES)} y decirme qué falla?`,
      `Sigue con la siguiente parte, por favor (${pick(FILES)}).`,
      `¿Cómo vamos con las pruebas de ${pick(FILES)}?`,
      `Ok, y ¿qué pasa con ${pick(SLUGS)}?`,
    ])
  }
  return pick([
    `$ bun test ${pick(FILES)}\n${int(8, 60)} pass, ${int(0, 4)} skip, ${int(0, 2)} fail (${int(80, 900)} ms)`,
    `$ git log -1\ncommit ${digits(7)}\nAuthor: dev\n\n    ajusta ${pick(FILES)}`,
    `Revisé src/${pick(FILES)}/index.ts: ${int(40, 300)} líneas, sin cambios pendientes.`,
    `Respuesta de la API: 200 OK desde https://prd.${pick(SLUGS)}.example/api/v${int(2, 9)} en ${int(40, 400)} ms.`,
    `Variable de entorno PRD-${digits(4)}-${pick(WORDS)} configurada en el contenedor ${int(1, 9)}.`,
    `Paquete ${pick(SLUGS)}-sdk-${int(1, 9)}: última versión ${int(0, 3)}.${int(0, 20)}.${int(0, 9)}.`,
    `El límite del plan gratuito es de ${int(20, 100)} peticiones por minuto, no aplica a este caso.`,
  ])
}
