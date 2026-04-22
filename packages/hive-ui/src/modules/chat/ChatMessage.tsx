import { useState } from "react";
import type { Message } from "@/types";
import { Bot, AlertTriangle, Play, Pause, Volume2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  message: Message;
  userName?: string;
  agentName?: string;
  isStreaming?: boolean;
  onNarrate?: (text: string) => void;
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AudioPlayer({ audio, mimeType = "audio/webm" }: { audio: string; mimeType?: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const playAudio = () => {
    if (!audioUrl) {
      const url = `data:${mimeType};base64,${audio}`;
      setAudioUrl(url);
    }
    setIsPlaying(true);
  };

  const pauseAudio = () => {
    setIsPlaying(false);
  };

  if (!audio) return null;

  return (
    <div className="flex items-center gap-2 mt-2">
      <button
        onClick={isPlaying ? pauseAudio : playAudio}
        className="h-7 w-7 rounded-full bg-cyan-600/80 hover:bg-cyan-500 flex items-center justify-center transition-colors"
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5 text-white" /> : <Play className="h-3.5 w-3.5 text-white ml-0.5" />}
      </button>
      {audioUrl && (
        <audio
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
          autoPlay={isPlaying}
          className="hidden"
        />
      )}
      <div className="flex-1 h-7 bg-zinc-800/80 rounded-lg overflow-hidden">
        <div className="h-full w-full flex items-center px-2">
          <Volume2 className="h-3.5 w-3.5 text-zinc-400 mr-2" />
          <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-cyan-500 rounded-full animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatMessage({ message, userName = "Tu", agentName = "Agente", isStreaming, onNarrate }: ChatMessageProps) {
  const isUser = message.type === "user";
  const isError = message.type === "error";
  const isSystem = message.type === "system";
  const hasAudio = !!message.audio?.base64 || !!message.audio?.url;

  if (isSystem) {
    return (
      <div className="flex justify-center my-1">
        <span className="text-[10px] text-zinc-600 bg-zinc-900/50 border border-white/5 px-3 py-1 rounded-full font-mono">
          {message.content}
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 justify-center my-1">
        <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1.5 rounded-xl">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2 group">
        <div className="flex flex-col items-end gap-0.5 max-w-[72%]">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm shadow-lg shadow-blue-600/10 text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </div>
          {hasAudio && message.audio?.base64 && (
            <AudioPlayer audio={message.audio.base64} mimeType={message.audio.mimeType} />
          )}
          <span className="text-[10px] text-zinc-700 pr-1">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  // Agent message
  return (
    <div className="flex items-start gap-2 group">
      <div className="h-8 w-8 rounded-full bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5 ring-2 ring-zinc-950">
        <Bot className="h-4 w-4 text-cyan-400" />
      </div>
      <div className="flex flex-col gap-0.5 max-w-[80%] min-w-0">
        <span className="text-[10px] font-semibold text-cyan-500/70 uppercase tracking-wider">{agentName}</span>
        <div className={`bg-zinc-900 border text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tl-sm text-sm leading-relaxed shadow prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 max-w-none prose-sm ${
          isStreaming ? "border-cyan-500/30 animate-pulse" : "border-white/5"
        }`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-cyan-400 ml-0.5 animate-pulse align-text-bottom rounded-sm" />
          )}
        </div>
        {hasAudio && message.audio?.base64 && (
          <AudioPlayer audio={message.audio.base64} mimeType={message.audio.mimeType} />
        )}
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-zinc-700">{formatTime(message.timestamp)}</span>
          {onNarrate && (
            <button
              onClick={() => onNarrate(message.content)}
              className="opacity-0 group-hover:opacity-100 transition-opacity h-5 w-5 rounded flex items-center justify-center text-zinc-600 hover:text-cyan-400 hover:bg-zinc-800"
              title="Narrar mensaje"
            >
              <Volume2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}