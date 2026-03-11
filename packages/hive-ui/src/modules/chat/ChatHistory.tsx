import type { Message } from "@/types";
import { ChatMessage } from "./ChatMessage";
import { useEffect, useRef } from "react";
import { Bot, Zap } from "lucide-react";

interface ChatHistoryProps {
  messages: Message[];
  isLoading?: boolean;
  currentSteps?: string[];
  userName?: string;
  agentName?: string;
}

export function ChatHistory({ messages, isLoading = false, currentSteps = [], userName, agentName }: ChatHistoryProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, currentSteps]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shadow-xl">
            <Bot className="h-8 w-8 text-cyan-400" />
          </div>
          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-zinc-950 shadow" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-zinc-300">
            {agentName ? `${agentName} está listo` : "Agente listo"}
          </p>
          <p className="text-xs text-zinc-600">Inicia la conversación escribiendo un mensaje</p>
        </div>
        <div className="flex items-center gap-2 mt-2">
          {["¿Qué puedes hacer?", "Dame un resumen", "Ayúdame con una tarea"].map(hint => (
            <span
              key={hint}
              className="text-[11px] text-zinc-600 border border-white/5 bg-zinc-900/50 px-3 py-1 rounded-full"
            >
              {hint}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 min-h-0">
      {messages.map(message => (
        <ChatMessage
          key={message.id}
          message={message}
          userName={userName}
          agentName={agentName}
        />
      ))}

      {isLoading && (
        <div className="flex items-end gap-2">
          <div className="h-8 w-8 rounded-full bg-zinc-900 border border-cyan-500/20 flex items-center justify-center shrink-0 ring-2 ring-zinc-950">
            <Bot className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="flex flex-col gap-1.5 max-w-[72%]">
            {/* Step narrations */}
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
            {/* Typing dots */}
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
  );
}
