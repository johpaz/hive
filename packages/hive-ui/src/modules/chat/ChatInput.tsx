import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
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

export function ChatInput({ onSendMessage, onStop, disabled = false, isStreaming = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
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

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const isImage = file.type.startsWith("image/");
        const newAttachment: ChatAttachment = {
          type: isImage ? "image" : "document",
          base64,
          mimeType: file.type,
          fileName: file.name
        };
        setAttachments(prev => [...prev, newAttachment]);
      };
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    <div className="px-4 pb-4 pt-2 shrink-0 bg-transparent">
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
          className={`flex items-end gap-2 rounded-[2rem] bg-black/40 backdrop-blur-md px-4 py-3 transition-all shadow-sm border border-white/10 ${
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
              : "Enter para enviar · Shift+Enter nueva línea"}
          </p>
        )}
      </div>
    </div>
  );
}