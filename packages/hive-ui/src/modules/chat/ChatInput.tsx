import { useState, useRef, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Mic, Square } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string, audioBase64?: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSendMessage, disabled = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
        stream.getTracks().forEach(track => track.stop());
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
    <div className="px-4 py-3">
      <div className={`flex items-end gap-2 rounded-2xl border bg-zinc-900/50 backdrop-blur-sm px-3 py-2 transition-all ${
        disabled
          ? "border-white/5 opacity-60"
          : "border-white/10 focus-within:border-blue-500/40 focus-within:shadow-lg focus-within:shadow-blue-500/5"
      }`}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={disabled}
          className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mb-0.5 transition-all ${
            isRecording 
              ? "bg-red-600 hover:bg-red-500 animate-pulse" 
              : "bg-zinc-700 hover:bg-zinc-600"
          } disabled:opacity-30 disabled:cursor-not-allowed text-white`}
        >
          {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
        <Textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Conectando al agente..." : "Escribe un mensaje..."}
          disabled={disabled}
          className="flex-1 min-h-[36px] max-h-[160px] resize-none border-0 bg-transparent p-0 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0 leading-relaxed"
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 mb-0.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white shadow shadow-blue-600/20"
        >
          <SendHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-zinc-700 mt-1.5 text-center">
        {isRecording ? "Grabando... haz clic en ■ para enviar" : "Enter para enviar · Shift+Enter nueva línea · 🎤 para audio"}
      </p>
    </div>
  );
}
