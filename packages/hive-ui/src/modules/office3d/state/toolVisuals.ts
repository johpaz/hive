export type ToolVisualCategory = "browser" | "code" | "knowledge" | "communication" | "generic";

export function toolVisualCategory(toolName: string | null): ToolVisualCategory {
  const tool = toolName?.toLowerCase() ?? "";
  if (/knowledge|memory|rag|embed|document|vector/.test(tool)) return "knowledge";
  if (/browser|web|search|fetch|http|url/.test(tool)) return "browser";
  if (/file|code|exec|shell|terminal|git|patch|write|read/.test(tool)) return "code";
  if (/message|mail|slack|discord|telegram|whatsapp|notify/.test(tool)) return "communication";
  return "generic";
}
