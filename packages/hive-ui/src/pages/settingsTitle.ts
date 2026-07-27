export function splitPanelTitle(title: string): { lead: string; accent: string } {
  if (title.includes(" & ")) {
    const [lead, accent] = title.split(" & ", 2);
    return { lead, accent: `& ${accent}` };
  }
  const [lead, ...rest] = title.split(" ");
  return { lead, accent: rest.join(" ") };
}
