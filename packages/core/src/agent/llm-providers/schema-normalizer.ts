/**
 * Normaliza el esquema de parámetros de una herramienta a un JSON Schema "plano" que aceptan
 * todos los proveedores de LLM.
 *
 * Los servidores MCP publican esquemas con construcciones que muchas APIs rechazan con 400
 * (Gemini: "Unknown name x-google-identifier"; NVIDIA/OpenAI-compat: `$ref` sin resolver):
 *   - `$ref` + `$defs` / `definitions`  → se expanden en línea (con tope para referencias circulares)
 *   - extensiones `x-*` (x-google-identifier, x-google-enum-descriptions…) y `$schema`, `$id`, `$comment` → se quitan
 *
 * No toca los NOMBRES de propiedades (`properties.x-rate` se conserva) ni los valores de
 * `enum`, `default`, `const`, `example(s)`, que son datos y no esquema.
 */

const DATA_KEYS = new Set(["enum", "default", "const", "example", "examples"])
const DROP_KEYS = new Set(["$schema", "$id", "$comment", "$defs", "definitions"])
const MAX_REF_DEPTH = 6

type Json = Record<string, unknown>

function resolvePointer(root: Json, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined // referencias externas: no se resuelven
  let node: unknown = root
  for (const raw of ref.slice(1).split("/").filter(Boolean)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~")
    if (typeof node !== "object" || node === null) return undefined
    node = (node as Json)[key]
  }
  return node
}

function walk(node: unknown, root: Json, refStack: string[]): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(n, root, refStack))
  if (typeof node !== "object" || node === null) return node
  const obj = node as Json

  if (typeof obj.$ref === "string") {
    const ref = obj.$ref
    const depth = refStack.filter((r) => r === ref).length
    const target = resolvePointer(root, ref)
    const { $ref: _omit, ...siblings } = obj
    if (target === undefined || depth >= MAX_REF_DEPTH || typeof target !== "object" || target === null) {
      // Irresoluble o circular: un objeto abierto es más seguro que un 400.
      return walk(siblings, root, refStack)
    }
    const merged = { ...(target as Json), ...siblings }
    return walk(merged, root, [...refStack, ref])
  }

  const out: Json = {}
  for (const [k, v] of Object.entries(obj)) {
    if (DROP_KEYS.has(k) || k.startsWith("x-")) continue
    if (DATA_KEYS.has(k)) { out[k] = v; continue }
    if (k === "properties" && typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, walk(sub, root, refStack)]))
      continue
    }
    out[k] = walk(v, root, refStack)
  }
  return out
}

export function normalizeJsonSchema<T = Json>(schema: T): T {
  if (typeof schema !== "object" || schema === null) return schema
  return walk(schema, schema as Json, []) as T
}
