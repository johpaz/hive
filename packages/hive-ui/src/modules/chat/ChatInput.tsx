import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Mic, Square } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string, audioBase64?: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

export function ChatInput({ onSendMessage, onStop, disabled = false, isStreaming = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [message]);

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          onSendMessage("[Audio mensaje]", base64);
        };
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="max-w-3xl mx-auto">
        <div
          className={`flex items-end gap-2 rounded-2xl border bg-zinc-900/60 backdrop-blur-sm px-3 py-2 transition-all shadow-lg shadow-black/20 ${
            disabled
              ? "border-white/5 opacity-60"
              : "border-white/10 focus-within:border-blue-500/30 focus-within:shadow-blue-500/5"
          }`}
        >
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled}
            className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mb-0.5 transition-all ${
              isRecording
                ? "bg-red-600 hover:bg-red-500 animate-pulse"
                : "bg-zinc-800 hover:bg-zinc-700 border border-white/5"
            } disabled:opacity-30 disabled:cursor-not-allowed text-white`}
          >
            {isRecording ? <Square className="h-3 w-3" /> : <Mic className="h-3.5 w-3.5" />}
          </button>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Conectando al agente..." : isStreaming ? "Escribe mientras espera..." : "Escribe un mensaje..."}
            disabled={disabled}
            rows={1}
            className="flex-1 min-h-[36px] max-h-[160px] resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none leading-relaxed py-1.5"
            style={{ overflow: "auto" }}
          />
          {isStreaming && onStop ? (
            <button
              onClick={onStop}
              className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mb-0.5 transition-all bg-red-600 hover:bg-red-500 text-white shadow shadow-red-600/20"
              title="Detener generación"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!message.trim() || disabled}
              className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mb-0.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white shadow shadow-blue-600/20"
            >
              <SendHorizontal className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-zinc-700 mt-1.5 text-center">
          {isRecording
            ? "Grabando... haz clic para enviar"
            : "Enter para enviar \u00b7 Shift+Enter nueva linea"}
        </p>
      </div>
    </div>
  );
}