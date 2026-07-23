// Deterministic torso color + desk position per specialist id. Order mirrors
// SEED_SPECIALISTS in packages/core/src/agent/specialist-catalog.ts so desks
// read left-to-right, front-to-back in a stable, predictable layout.
export const SPECIALIST_COLORS: Record<string, string> = {
  web_researcher: "#3b82f6",
  browser_operator: "#06b6d4",
  workspace_file_operator: "#10b981",
  software_engineer: "#22c55e",
  office_document_specialist: "#f59e0b",
  canvas_presenter: "#ec4899",
  a2ui_builder: "#6366f1",
  schedule_automation_specialist: "#14b8a6",
  meeting_scribe: "#f97316",
  voice_audio_specialist: "#a855f7",
  api_operator: "#ef4444",
  mcp_integration_operator: "#84cc16",
  acceptance_verifier: "#94a3b8",
};

const DESK_ORDER = [
  "web_researcher", "browser_operator", "workspace_file_operator",
  "software_engineer", "office_document_specialist", "canvas_presenter",
  "a2ui_builder", "schedule_automation_specialist", "meeting_scribe",
  "voice_audio_specialist", "api_operator", "mcp_integration_operator",
  "acceptance_verifier",
];

const ROW1 = DESK_ORDER.slice(0, 6);
const ROW2 = DESK_ORDER.slice(6);

function evenSpread(count: number, y: number): Record<string, { x: number; y: number }> {
  const margin = 10;
  const span = 100 - margin * 2;
  const out: Record<string, { x: number; y: number }> = {};
  const ids = count === 6 ? ROW1 : ROW2;
  ids.forEach((id, i) => {
    const x = count === 1 ? 50 : margin + (span * i) / (count - 1);
    out[id] = { x, y };
  });
  return out;
}

export const DESK_POSITIONS: Record<string, { x: number; y: number }> = {
  ...evenSpread(6, 46),
  ...evenSpread(7, 80),
};

function hashHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function specialistColor(id: string): string {
  return SPECIALIST_COLORS[id] ?? `hsl(${hashHue(id)}, 65%, 55%)`;
}

export function deskPosition(id: string, fallbackIndex: number): { x: number; y: number } {
  if (DESK_POSITIONS[id]) return DESK_POSITIONS[id];
  const col = fallbackIndex % 6;
  const row = Math.floor(fallbackIndex / 6);
  return { x: 15 + col * 14, y: 46 + row * 34 };
}
