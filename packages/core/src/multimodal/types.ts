export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "image_base64"; base64: string; mimeType: string }
  | { type: "document"; base64: string; mimeType: string; fileName?: string }

export interface ImageInput {
  type: "url" | "base64" | "buffer"
  data: string | Buffer
  mimeType?: string
  caption?: string
}

export interface DocumentInput {
  type: "url" | "base64" | "buffer"
  data: string | Buffer
  mimeType: string
  fileName?: string
}

export interface VisionConfig {
  visionEnabled: boolean
  ocrProvider: string | null
  visionProvider: string | null
  visionModelId: string | null
}

export type MultimodalMessageType = "text" | "image" | "document" | "audio"
