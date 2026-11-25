import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
export interface ChatAttachment {
  type: "image" | "document";
  base64: string;
  mimeType: string;
  fileName?: string;
}

interface ChatInputProps {
  onSendMessage: (content: string, options?: { audio?: string, audioMimeType?: string, attachments?: ChatAttachment[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

import { SendHorizontal, Mic, Square, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";

/**
 * Formatos que aceptan los proveedores STT (Whisper de Groq/OpenAI), en orden de
 * preferencia. Cada motor soporta un subconjunto distinto: Chromium y WebKitGTK
 * dan webm/opus, Safari sólo mp4. Fijar "audio/webm" a ciegas —como estaba—
 * hacía que `new MediaRecorder` lanzara NotSupportedError en Safari.
 */
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Traduce el fallo de getUserMedia a algo accionable para el usuario. */
function describeMicError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de micrófono denegado. Habilítalo para este sitio y vuelve a intentar.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ningún micrófono conectado.";
    case "NotReadableError":
      return "Otra aplicación está usando el micrófono.";
    default:
      return `No se pudo acceder al micrófono: ${(error as Error)?.message ?? "error desconocido"}`;
  }
}

/** Mismo tope que el gateway (MAX_ATTACHMENT_BYTES). */
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/bmp": "bmp", "image/svg+xml": "svg", "application/pdf": "pdf",
};

/**
 * Una captura pegada llega como "image.png" (o sin nombre): el agente y el usuario
 * ven mejor "captura-2026-11-25-1432.png". Los archivos con nombre propio se respetan.
 */
function nameForPasted(file: File): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const ext = EXTENSION_BY_MIME[file.type] ?? (file.type.split("/")[1] || "bin");
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${file.type.startsWith("image/") ? "captura" : "archivo"}-${stamp}.${ext}`;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer «${file.name}».`));
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/** ¿El arrastre trae archivos del sistema (y no, por ejemplo, texto seleccionado)? */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function ChatInput({ onSendMessage, onStop, disabled = false, isStreaming = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [message]);

  const handleSend = () => {
    if ((message.trim() || attachments.length > 0) && !disabled) {
      onSendMessage(message.trim() || (attachments.length > 0 ? "[Adjunto]" : ""), {
        attachments: attachments.length > 0 ? attachments : undefined
      });
      setMessage("");
      setAttachments([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  /** Punto único de entrada de archivos: el botón, pegar y arrastrar pasan por aquí. */
  const addFiles = async (files: File[]) => {
    if (files.length === 0 || disabled) return;
    setMicError(null);
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setMicError(`«${file.name}» pesa ${(file.size / 1048576).toFixed(1)} MB y el máximo es ${MAX_ATTACHMENT_BYTES / 1048576} MB.`);
        continue;
      }
      try {
        const base64 = await readAsBase64(file);
        setAttachments(prev => [...prev, {
          type: file.type.startsWith("image/") ? "image" : "document",
          base64,
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
        }]);
      } catch (err) {
        setMicError((err as Error).message);
      }
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await addFiles(files);
  };

  /**
   * Pegar: una captura (Ctrl+V tras PrintScreen), una imagen copiada del navegador o un
   * archivo copiado en el explorador. El texto pegado sigue su camino normal: si el
   * portapapeles trae texto Y una imagen (celdas de Excel, párrafos de Word), gana el texto.
   */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = e.clipboardData;
    if (!data || disabled) return;
    const files = Array.from(data.files ?? []);
    if (files.length === 0) {
      // Algunos motores solo exponen el archivo como item, no en `files`.
      for (const item of Array.from(data.items ?? [])) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }
    if (files.length === 0) return;
    if (data.getData("text/plain").trim() && files.every(f => f.type.startsWith("image/"))) return;
    e.preventDefault();
    void addFiles(files.map(f => {
      const name = nameForPasted(f);
      return name === f.name ? f : new File([f], name, { type: f.type });
    }));
  };

  const handleDragEnter = (e: DragEvent) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: DragEvent) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault(); // sin esto el navegador no permite soltar
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: DragEvent) => {
    if (!dragHasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  const startRecording = async () => {
    setMicError(null);

    // `mediaDevices` no existe en contextos inseguros (http:// que no sea
    // localhost) ni cuando el WebView llega con la captura de medios apagada.
    // Antes esto reventaba dentro del try y sólo se veía en la consola: el botón
    // parecía muerto.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError(
        window.isSecureContext === false
          ? "El micrófono solo funciona sobre HTTPS o en localhost. Abre Hive en 127.0.0.1 o pon un proxy TLS delante."
          : "Este navegador no permite grabar audio."
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setMicError(describeMicError(error));
      return;
    }

    const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

    try {
      const mimeType = pickRecordingMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onerror = () => {
        setIsRecording(false);
        setMicError("La grabación falló. Intenta de nuevo.");
        stopTracks();
      };

      mediaRecorder.onstop = async () => {
        // El tipo real lo dicta el motor: pedimos webm pero WebKit puede
        // entregar ogg o mp4, y el backend elige la extensión del archivo que
        // manda a Whisper a partir de este valor.
        const type = mediaRecorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        stopTracks();

        if (blob.size === 0) {
          setMicError("No se capturó audio. Revisa que el micrófono no esté silenciado.");
          return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          onSendMessage("[Audio mensaje]", { audio: base64, audioMimeType: type });
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      stopTracks();
      setMicError(describeMicError(error));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div
      className="px-4 pb-4 pt-2 shrink-0 bg-transparent"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-dragging={isDragging || undefined}
    >
      <div className="max-w-3xl mx-auto">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-2">
            {attachments.map((at, i) => (
              <div key={i} className="group relative flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-lg px-3 py-1.5 border border-white/10">
                {at.type === "image" ? (
                  <img src={`data:${at.mimeType};base64,${at.base64}`} className="h-8 w-8 rounded object-cover border border-white/20" alt="preview" />
                ) : (
                  <FileText className="h-5 w-5 text-blue-400" />
                )}
                <span className="text-xs text-white/70 max-w-[120px] truncate">{at.fileName}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={`flex items-end gap-2 rounded-[2rem] bg-black/40 backdrop-blur-md px-4 py-3 transition-all shadow-sm border ${
            isDragging
              ? "border-blue-400 border-dashed bg-blue-500/10 shadow-blue-glow"
              : "border-white/10"
          } ${
            disabled
              ? "opacity-60 bg-black/20"
              : "hover:border-white/20 focus-within:border-blue-500/50 focus-within:shadow-blue-glow"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
            multiple
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all bg-white/5 text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title="Adjuntar archivo"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled}
            className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all ${
              isRecording
                ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 animate-pulse"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={disabled ? "Conectando al agente..." : isStreaming ? "Escribe mientras espera..." : "Escribe un mensaje..."}
            disabled={disabled}
            rows={1}
            className="flex-1 min-h-[36px] max-h-[160px] resize-none bg-transparent text-[15px] font-manrope text-white placeholder:text-white/30 focus:outline-none leading-relaxed py-1.5 px-2"
            style={{ overflow: "auto" }}
          />
          {isStreaming && onStop ? (
            <button
              onClick={onStop}
              className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all bg-rose-500 hover:bg-rose-600 text-white shadow-sm shadow-rose-500/20"
              title="Detener generación"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!message.trim() && attachments.length === 0) || disabled}
              className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 text-white shadow-sm"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
        {micError ? (
          <p
            role="alert"
            className="mt-2.5 flex items-center justify-center gap-2 text-center text-[11px] font-medium text-rose-300/90 font-manrope"
          >
            {micError}
            <button
              type="button"
              onClick={() => setMicError(null)}
              className="text-rose-300/60 transition-colors hover:text-rose-200"
              aria-label="Descartar aviso"
            >
              <X className="h-3 w-3" />
            </button>
          </p>
        ) : (
          <p className="text-[11px] font-medium text-white/30 mt-2.5 text-center font-manrope tracking-wide">
            {isRecording
              ? "Grabando... haz clic para enviar"
              : isDragging
                ? "Suelta para adjuntar"
                : "Enter para enviar · Shift+Enter nueva línea · Pega o arrastra archivos"}
          </p>
        )}
      </div>
    </div>
  );
}