export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-sm text-hive-thinking">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hive-thinking" />
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hive-thinking [animation-delay:0.2s]" />
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hive-thinking [animation-delay:0.4s]" />
      <span className="ml-1">Agente pensando…</span>
    </div>
  );
}
