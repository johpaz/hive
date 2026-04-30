import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
export interface ChatAttachment {
  type: "image" | "document";
  base64: string;
  mimeType: string;
  fileName?: string;
}

interface ChatInputProps {
  onSendMessage: (content: string, options?: { audio?: string, attachments?: ChatAttachment[] }) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}

import { SendHorizontal, Mic, Square, Paperclip, X, FileText, Image as ImageIcon } from "lucide-react";

export function ChatInput({ onSendMessage, onStop, disabled = false, isStreaming = false }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
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
          onSendMessage("[Audio mensaje]", { audio: base64 });
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
        <p className="text-[11px] font-medium text-white/30 mt-2.5 text-center font-manrope tracking-wide">
          {isRecording
            ? "Grabando... haz clic para enviar"
            : "Enter para enviar · Shift+Enter nueva línea"}
        </p>
      </div>
    </div>
  );
}