import { useState, useRef, useEffect } from "react";
import type { Message } from "@/types";
import { 
  Bot, AlertTriangle, Play, Pause, Volume2, Volume1, VolumeX, 
  FileText, Image as ImageIcon, RotateCcw, Gauge 
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
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
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audio && !audioUrl) {
      const url = `data:${mimeType};base64,${audio}`;
      setAudioUrl(url);
    }
  }, [audio, audioUrl, mimeType]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
      setDuration(audioRef.current.duration);
    }
  };

  const onSeek = (val: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val[0];
      setProgress(val[0]);
    }
  };

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIndex = (speeds.indexOf(speed) + 1) % speeds.length;
    setSpeed(speeds[nextIndex]);
  };

  const formatAudioTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!audio) return null;

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex flex-col gap-2 mt-3 p-3 bg-zinc-900/50 border border-white/5 rounded-2xl w-full max-w-sm shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-all active:scale-95 shadow-lg shadow-blue-600/20"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5 text-white fill-white" />
          ) : (
            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
          )}
        </button>

        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="flex justify-between items-end mb-0.5">
            <span className="text-[10px] font-bold text-blue-400/80 uppercase tracking-widest flex items-center gap-1.5">
              {isPlaying ? (
                <>
                  <span className="flex gap-0.5 items-end h-3">
                    <span className="w-0.5 bg-blue-400/60 animate-[bounce_0.8s_infinite_0ms]" style={{ height: '40%' }} />
                    <span className="w-0.5 bg-blue-400/60 animate-[bounce_0.8s_infinite_200ms]" style={{ height: '80%' }} />
                    <span className="w-0.5 bg-blue-400/60 animate-[bounce_0.8s_infinite_400ms]" style={{ height: '60%' }} />
                  </span>
                  Reproduciendo
                </>
              ) : (
                "Audio del Agente"
              )}
            </span>
            <span className="text-[10px] font-mono text-white/40 tabular-nums">
              {formatAudioTime(progress)} / {formatAudioTime(duration)}
            </span>
          </div>
          
          <Slider
            value={[progress]}
            max={duration || 100}
            step={0.1}
            onValueChange={onSeek}
            className="w-full"
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 mt-1 border-t border-white/5">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 group/vol">
            <button 
              onClick={() => setVolume(volume === 0 ? 1 : 0)}
              className="text-white/40 hover:text-white transition-colors"
            >
              <VolumeIcon className="h-4 w-4" />
            </button>
            <div className="w-16">
              <Slider
                value={[volume * 100]}
                max={100}
                onValueChange={(v) => setVolume(v[0] / 100)}
                className="h-4"
              />
            </div>
          </div>

          <button
            onClick={cycleSpeed}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 text-white/40 hover:text-blue-400 transition-all"
          >
            <Gauge className="h-3.5 w-3.5" />
            <span className="text-[10px] font-bold min-w-[2.5ch]">{speed}x</span>
          </button>
        </div>

        <button 
          onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; }}
          className="text-white/20 hover:text-white/60 transition-colors p-1"
          title="Reiniciar"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onTimeUpdate}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  );
}

export function ChatMessage({ message, userName = "Tú", agentName = "Agente", isStreaming, onNarrate }: ChatMessageProps) {
  const isUser = message.type === "user";
  const isError = message.type === "error";
  const isSystem = message.type === "system";
  const hasAudio = !!message.audio?.base64 || !!message.audio?.url;

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-[11px] text-white/50 bg-white/5 border border-white/10 px-3 py-1 rounded-full font-mono">
          {message.content}
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 justify-center my-2">
        <div className="flex items-center gap-2 text-[12px] font-medium text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-2 rounded-xl">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {message.content}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2 group mb-2">
        <div className="flex flex-col items-end gap-1 max-w-[75%] md:max-w-[65%]">
          {message.image && (
            <div className="mb-2 rounded-2xl overflow-hidden border border-white/10 shadow-lg bg-black/20">
              <img
                src={message.image.url || `data:${message.image.mimeType || "image/jpeg"};base64,${message.image.base64}`}
                alt="adjunto"
                className="max-w-full h-auto max-h-[300px] object-contain"
              />
            </div>
          )}
          {message.document && (
            <div className="mb-2 flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-3 rounded-2xl w-full">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                <FileText className="h-6 w-6 text-blue-400" />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-medium text-white truncate">{message.document.fileName || "Documento"}</span>
                <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">{message.document.mimeType?.split('/')[1] || "DOC"}</span>
              </div>
            </div>
          )}
          <div className="bg-blue-600/20 text-white px-5 py-3 rounded-3xl rounded-br-sm shadow-sm ring-1 ring-blue-500/30 text-[15px] leading-relaxed whitespace-pre-wrap font-manrope">
            {message.content}
          </div>
          {hasAudio && message.audio?.base64 && (
            <AudioPlayer audio={message.audio.base64} mimeType={message.audio.mimeType} />
          )}
          <span className="text-[10px] text-white/40 font-medium pr-2 opacity-0 group-hover:opacity-100 transition-opacity">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  // Agent message
  return (
    <div className="flex items-start gap-4 group mb-4">
      <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
        <Bot className="h-5 w-5 text-blue-400" />
      </div>
      <div className="flex flex-col gap-1 max-w-[85%] min-w-0 flex-1">
        <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider ml-1">{agentName}</span>

        {message.image && (
          <div className="mb-2 rounded-2xl overflow-hidden border border-white/10 shadow-lg bg-black/20 w-fit">
            <img
              src={message.image.url || `data:${message.image.mimeType || "image/jpeg"};base64,${message.image.base64}`}
              alt="adjunto"
              className="max-w-full h-auto max-h-[300px] object-contain"
            />
          </div>
        )}

        {message.document && (
          <div className="mb-2 flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-3 rounded-2xl w-fit max-w-full">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
              <FileText className="h-6 w-6 text-blue-400" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium text-white truncate">{message.document.fileName || "Documento"}</span>
              <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider">{message.document.mimeType?.split('/')[1] || "DOC"}</span>
            </div>
          </div>
        )}

        <div className="text-white/80 text-[15px] leading-relaxed prose prose-invert max-w-none font-newsreader">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-blue-400 ml-1 align-text-bottom rounded-sm opacity-70" />
          )}
        </div>
        {hasAudio && message.audio?.base64 && (
          <AudioPlayer audio={message.audio.base64} mimeType={message.audio.mimeType} />
        )}
        <div className="flex items-center gap-2 pl-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] font-medium text-white/40">{formatTime(message.timestamp)}</span>
          {onNarrate && (
            <button
              onClick={() => onNarrate(message.content)}
              className="h-6 w-6 rounded flex items-center justify-center text-white/40 hover:text-blue-400 hover:bg-white/5 transition-colors"
              title="Narrar mensaje"
            >
              <Volume2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}