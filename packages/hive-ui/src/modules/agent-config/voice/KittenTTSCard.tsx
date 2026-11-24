import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import { useLocalTTS, useVoice } from "@/stores/useGlobalConfigStore";

const phaseLabels = {
  stopped: "Detenido",
  installing: "Instalando…",
  starting: "Cargando el modelo…",
  ready: "Listo",
  error: "Requiere atención",
} as const;

const sampleText = "¡Hola! Soy Hive. ¿En qué te puedo ayudar hoy?";
const sampleLimit = 500;

function KittenVoicePreview({ voices }: { voices: Array<{ id: string; name: string }> }) {
  const id = useId();
  const [voiceId, setVoiceId] = useState("lucia");
  const [text, setText] = useState(sampleText);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<{ url: string; voice: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const audioUrl = useRef<string | null>(null);
  const voice = voices.find(option => option.id === voiceId) ?? voices[0];

  useEffect(() => () => {
    request.current?.abort();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
  }, []);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!voice || !text.trim() || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    setGenerating(true);
    setError("");
    try {
      const wav = await apiClient<Blob>("/api/tts-local/speak", {
        method: "POST",
        body: { text: text.trim(), voice: voice.id },
        responseType: "blob",
        signal: controller.signal,
        showError: false,
      });
      if (controller.signal.aborted) return;
      if (!wav.size || !wav.type.startsWith("audio/")) throw new Error("Hive no devolvió una muestra de audio válida.");
      const url = URL.createObjectURL(wav);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = url;
      setSample({ url, voice: voice.name });
    } catch (cause) {
      if (!controller.signal.aborted) {
        const detail = cause instanceof Error ? cause.message : "";
        setError(detail.includes("503") || !detail ? "No se pudo generar la muestra. Revisa el estado de Kitten y reintenta." : detail);
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setGenerating(false);
    }
  }

  return (
    <form onSubmit={generate} className="space-y-4 border-t border-border pt-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-sm font-semibold">Probar voces</h3>
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(9rem,13rem)_1fr]">
        <div className="space-y-2">
          <Label htmlFor={`${id}-voice`}>Voz</Label>
          <Select value={voice?.id ?? ""} onValueChange={setVoiceId} disabled={generating || !voice}>
            <SelectTrigger id={`${id}-voice`}><SelectValue placeholder="Selecciona una voz" /></SelectTrigger>
            <SelectContent>
              {voices.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-text`}>Texto de prueba</Label>
          <Textarea
            id={`${id}-text`}
            value={text}
            onChange={event => setText(event.target.value)}
            maxLength={sampleLimit}
            disabled={generating}
            rows={2}
          />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={generating || !voice || !text.trim()}>
        {generating ? "Generando muestra…" : "Generar muestra"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sample && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Muestra de {sample.voice}</p>
          <audio controls src={sample.url} aria-label={`Muestra de ${sample.voice}`} className="w-full max-w-lg" />
        </div>
      )}
    </form>
  );
}

export function KittenTTSCard() {
  const { localTTS, fetchLocalTTSStatus, startLocalTTS, stopLocalTTS } = useLocalTTS();
  const { fetchConfiguredVoiceProviders } = useVoice();
  const [acting, setActing] = useState(false);
  const phase = localTTS?.phase;
  const busy = phase === "installing" || phase === "starting";

  useEffect(() => {
    void fetchLocalTTSStatus();
    const timer = setInterval(() => void fetchLocalTTSStatus(), 2500);
    return () => clearInterval(timer);
  }, [fetchLocalTTSStatus]);

  useEffect(() => {
    if (phase === "ready" || phase === "stopped" || phase === "error") {
      void fetchConfiguredVoiceProviders();
    }
  }, [phase, fetchConfiguredVoiceProviders]);

  async function changeServer(start: boolean) {
    setActing(true);
    try {
      await (start ? startLocalTTS() : stopLocalTTS());
    } catch {
      // The API client displays action errors.
    } finally {
      setActing(false);
    }
  }

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>Kitten TTS 2 Mini</CardTitle>
        <CardDescription>Síntesis local en español. Hive instala el modelo y arranca el servidor automáticamente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p role="status" className="text-sm">{phase ? phaseLabels[phase] : "Consultando estado…"}</p>
        {localTTS?.error && <p role="alert" className="text-sm text-destructive">{localTTS.error}</p>}
        {phase === "ready" && (
          <p className="text-xs text-muted-foreground">Voz predeterminada: Lucía · {localTTS.voices.length} voces en español</p>
        )}
        {phase && !busy && (
          <Button variant="outline" size="sm" disabled={acting} onClick={() => void changeServer(phase !== "ready")}>
            {phase === "ready" ? "Detener servidor" : phase === "error" ? "Reintentar" : "Iniciar servidor"}
          </Button>
        )}
        {localTTS?.phase === "ready" && <KittenVoicePreview voices={localTTS.voices} />}
      </CardContent>
    </Card>
  );
}
