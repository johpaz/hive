export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-sm text-hive-thinking">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-hive-thinking opacity-50" />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-hive-thinking opacity-50" />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-hive-thinking opacity-50" />
      <span className="ml-1">Agente pensando…</span>
    </div>
  );
}
