import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { useUserStore } from "@/stores/userStore";
import { useNotesAndCronsStore } from "@/stores/useNotesAndCronsStore";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";

/**
 * Parses simple key: value pairs from a markdown string.
 * Looks for patterns like "Verbosity: normal" or "Primary: English"
 */
function parseMarkdownFields(md: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = md.split("\n");
  for (const line of lines) {
    const match = line.match(/^(?:#{1,4}\s+)?(.+?):\s*(.+)$/);
    if (match && !match[1].startsWith("<!--") && !match[1].startsWith("*")) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      fields[key] = match[2].trim();
    }
  }
  return fields;
}

export function UserPreferencesForm() {
  const { fetchUser, saveUser, isLoading } = useUserStore();
  const { cronChannels, cronUserPreference, fetchCronChannels, saveCronChannelPreference } =
    useNotesAndCronsStore();
  const [state, setState] = useState({ rawContent: "", language: "", verbosity: "", codeStyle: "", loaded: false });

  useEffect(() => {
    fetchUser()
      .then((content) => {
        const fields = parseMarkdownFields(content as any);
        setState({
          rawContent: content as any,
          language: fields["primary"] || fields["language"] || "",
          verbosity: fields["verbosity"] || "",
          codeStyle: fields["language"] || "",
          loaded: true,
        });
      })
      .catch(console.error);
    fetchCronChannels();
  }, [fetchUser, fetchCronChannels]);

  const handleSave = async () => {
    let updatedContent = state.rawContent;

    if (state.language) {
      updatedContent = updatedContent.replace(
        /^(Primary:\s*).+$/m,
        `$1${state.language}`
      );
    }
    if (state.verbosity) {
      updatedContent = updatedContent.replace(
        /^(Verbosity:\s*).+$/m,
        `$1${state.verbosity}`
      );
    }

    loader.show("Guardando preferencias...");
    try {
      await saveUser(updatedContent as any);
      setState(prev => ({ ...prev, rawContent: updatedContent }));
      Toast.fire({ icon: "success", title: "Preferencias guardadas" });
    } catch {
      Toast.fire({ icon: "error", title: "Error al guardar preferencias" });
    } finally {
      loader.hide();
    }
  };

  const handleCronChannelChange = async (value: string) => {
    loader.show("Guardando canal...");
    try {
      await saveCronChannelPreference(value);
      Toast.fire({ icon: "success", title: "Canal de notificaciones guardado" });
    } catch {
      Toast.fire({ icon: "error", title: "Error al guardar el canal" });
    } finally {
      loader.hide();
    }
  };

  const activeChannels = cronChannels.filter(c => c.active);

  if (!state.loaded) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">Cargando preferencias...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          Preferencias del usuario
          <Button size="sm" variant="outline" onClick={handleSave} disabled={isLoading} className="gap-2 h-7">
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Guardar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Idioma preferido</Label>
          <Input value={state.language} onChange={(e) => setState(prev => ({ ...prev, language: e.target.value }))} placeholder="es" className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Verbosidad</Label>
          <Input value={state.verbosity} onChange={(e) => setState(prev => ({ ...prev, verbosity: e.target.value }))} placeholder="normal" className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Lenguaje principal</Label>
          <Input value={state.codeStyle} onChange={(e) => setState(prev => ({ ...prev, codeStyle: e.target.value }))} placeholder="TypeScript" className="h-8 text-sm" />
        </div>
        {/* Cron channel preference — only shown when multiple channels exist */}
        {activeChannels.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-white/5">
            <Label className="text-xs">Canal de notificaciones (Cron Jobs)</Label>
            <Select value={cronUserPreference} onValueChange={handleCronChannelChange}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Seleccionar canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-sm">
                  Auto — detectar mejor canal
                </SelectItem>
                {activeChannels.map(ch => (
                  <SelectItem key={ch.id} value={ch.id} className="text-sm">
                    {ch.id === 'telegram'
                      ? 'Telegram'
                      : ch.id === 'webchat'
                      ? 'Web Chat'
                      : ch.id}
                    {ch.recommended ? ' (recomendado)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Canal donde el agente envía las notificaciones de tareas programadas.
              En modo Auto se prefiere Telegram si está activo.
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Estos valores se leen de USER.md del workspace.</p>
      </CardContent>
    </Card>
  );
}
