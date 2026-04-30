import type { Message } from "@/types";
import { ChatMessage } from "./ChatMessage";
import { useEffect, useLayoutEffect, useRef } from "react";
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

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  // Auto-scroll logic
  useLayoutEffect(() => {
    if (containerRef.current) {
      const scrollElement = containerRef.current.querySelector('.overflow-y-auto');
      if (scrollElement) {
        // If we are streaming or just received a new message, and we are already near the bottom, scroll down
        const isNearBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 200;
        
        // If it's a new message (streaming or finished) and we are near the bottom, or if it's the very first message
        if (isNearBottom || messages.length <= 1) {
          // Use setTimeout to ensure the DOM has finished updating
          const timeoutId = setTimeout(() => {
            scrollElement.scrollTop = scrollElement.scrollHeight;
          }, 0);
          return () => clearTimeout(timeoutId);
        }
      }
    }
  }, [messages, isLoading, currentSteps]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 w-full">
        <div className="relative mb-6">
          <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-sm">
            <Bot className="h-8 w-8 text-blue-400" />
          </div>
          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
        </div>
        <div className="text-center space-y-2 mb-8">
          <p className="text-lg font-semibold text-white font-manrope">
            {agentName ? `${agentName} está listo` : "Agente listo"}
          </p>
          <p className="text-sm text-white/50 font-manrope">Inicia la conversación escribiendo un mensaje abajo</p>
        </div>
        {onSuggestionClick && (
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {SUGGESTIONS.map((suggestion) => {
              const Icon = suggestion.icon;
              return (
                <button
                  key={suggestion.text}
                  onClick={() => onSuggestionClick(suggestion.text)}
                  className="flex items-center gap-2 text-sm text-white/70 hover:text-white bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/10 px-4 py-2.5 rounded-full transition-all cursor-pointer font-medium"
                >
                  <Icon className="h-4 w-4 text-blue-400" />
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
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0 w-full">
      <div className="flex-1 overflow-y-auto w-full">
        <div className="max-w-3xl mx-auto flex flex-col gap-6 p-4 md:p-8 pb-2">
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
            <div className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 shadow-sm mt-1">
                <Bot className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex flex-col gap-2 max-w-[80%] min-w-0">
                <span className="text-[11px] font-bold text-white/40 uppercase tracking-wider ml-1">{agentName}</span>
                <div className="flex flex-col gap-2">
                  {currentSteps.length > 0 && (
                    <div className="flex flex-col gap-1.5 ml-1">
                      {currentSteps.map((step, i) => {
                        const isLatest = i === currentSteps.length - 1;
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all w-fit ${
                              isLatest
                                ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                                : "bg-white/5 border-white/10 text-white/50"
                            }`}
                          >
                            <Zap className={`h-3 w-3 shrink-0 ${isLatest ? "text-blue-400" : "text-white/30"}`} />
                            <span className="leading-tight">{step}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="bg-white/5 border border-white/10 px-4 py-3.5 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1.5 w-fit">
                    <span className="h-2 w-2 rounded-full bg-white/30 animate-bounce [animation-delay:0ms]" />
                    <span className="h-2 w-2 rounded-full bg-white/30 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-white/30 animate-bounce [animation-delay:300ms]" />
                  </div>
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