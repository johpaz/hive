import type { CanvasWorkEvent, CanvasWorkPhase } from "@/stores/canvasStore";

let audioContext: AudioContext | null = null;

export function primeOfficeAudio(): void {
  if (typeof window === "undefined") return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

const TONES: Record<CanvasWorkPhase, [number, number]> = {
  delegated: [520, 680],
  review_passed: [720, 960],
  review_failed: [260, 190],
  completed: [660, 880],
  failed: [220, 150],
  aborted: [280, 210],
  blocked: [240, 180],
};

export function playOfficeEventSound(event: CanvasWorkEvent): void {
  primeOfficeAudio();
  if (!audioContext || audioContext.state !== "running") return;

  const [first, second] = TONES[event.phase];
  const start = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.045, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
  gain.connect(audioContext.destination);

  for (const [frequency, offset] of [[first, 0], [second, 0.12]] as const) {
    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + offset);
    oscillator.connect(gain);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.2);
  }
}
