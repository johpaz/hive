import type { Message } from "@/types";
import { ChatMessage } from "./ChatMessage";
import { useEffect, useRef } from "react";
import { Bot, Zap, Sparkles } from "lucide-react";

interface ChatHistoryProps {
  messages: Message[];
  isLoading?: boolean;
  currentSteps?: string[];
  streamingMessageId?: string | null;
  userName?: string;
  agentName?: string;
  onSuggestionClick?: (text: string) => void;
  onNarrateMessage?: (text: string) => void;
}

const SUGGESTIONS = [
  { icon: Sparkles, text: "Que puedes hacer?" },
  { icon: Zap, text: "Dame un resumen" },
  { icon: Bot, text: "Ayudame con una tarea" },
];

export function ChatHistory({
  messages,
  isLoading = false,
  currentSteps = [],
  streamingMessageId,
  userName,
  agentName,
  onSuggestionClick,
  onNarrateMessage,
}: ChatHistoryProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, currentSteps]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 h-full">
        <div className="relative mb-4">
          <div className="h-16 w-16 rounded-2xl bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shadow-xl">
            <Bot className="h-8 w-8 text-cyan-400" />
          </div>
          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-zinc-950 shadow" />
        </div>
        <div className="text-center space-y-1 mb-6">
          <p className="text-sm font-semibold text-zinc-300">
            {agentName ? `${agentName} esta listo` : "Agente listo"}
          </p>
          <p className="text-xs text-zinc-600">Inicia la conversacion escribiendo un mensaje</p>
        </div>
        {onSuggestionClick && (
          <div className="flex flex-col sm:flex-row items-center gap-2">
            {SUGGESTIONS.map((suggestion) => {
              const Icon = suggestion.icon;
              return (
                <button
                  key={suggestion.text}
                  onClick={() => onSuggestionClick(suggestion.text)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-white/10 hover:border-white/20 bg-zinc-900/80 hover:bg-zinc-800/80 px-3 py-2 rounded-xl transition-all cursor-pointer"
                >
                  <Icon className="h-3 w-3" />
                  {suggestion.text}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto flex flex-col gap-4 p-4 pb-2">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              userName={userName}
              agentName={agentName}
              isStreaming={message.id === streamingMessageId}
              onNarrate={onNarrateMessage}
            />
          ))}

          {isLoading && !streamingMessageId && (
            <div className="flex items-end gap-2">
              <div className="h-8 w-8 rounded-full bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shrink-0 ring-2 ring-zinc-950">
                <Bot className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="flex flex-col gap-1.5 max-w-[80%]">
                {currentSteps.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {currentSteps.map((step, i) => {
                      const isLatest = i === currentSteps.length - 1;
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all ${
                            isLatest
                              ? "bg-zinc-900 border-cyan-500/20 text-cyan-300"
                              : "bg-zinc-950/50 border-white/5 text-zinc-600"
                          }`}
                        >
                          <Zap className={`h-3 w-3 shrink-0 ${isLatest ? "text-cyan-500 animate-pulse" : "text-zinc-700"}`} />
                          <span className="leading-tight">{step}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="bg-zinc-900 border border-white/5 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5 w-fit">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} className="h-0" />
        </div>
      </div>
    </div>
  );
}