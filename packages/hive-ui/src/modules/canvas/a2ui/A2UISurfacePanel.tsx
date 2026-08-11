import { useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, Trash2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { A2UIRenderer } from "./A2UIRenderer";
import type { A2UIActionMessage } from "@/types/a2ui";
import { apiClient } from "@/lib/api";

export function A2UISurfacePanel() {
  const a2uiSurfaces = useCanvasStore((s) => s.a2uiSurfaces);
  const sendA2UIAction = useCanvasStore((s) => s.sendA2UIAction);
  const deleteA2UISurface = useCanvasStore((s) => s.deleteA2UISurface);
  const [deletingSurfaceId, setDeletingSurfaceId] = useState<string | null>(null);

  const handleA2UIAction = useCallback((action: A2UIActionMessage) => {
    sendA2UIAction(action);
  }, [sendA2UIAction]);

  const handleDeleteSurface = async (surfaceId: string) => {
    setDeletingSurfaceId(surfaceId);
    try {
      await apiClient(`/api/a2ui/surfaces/${encodeURIComponent(surfaceId)}`, {
        method: "DELETE",
        showError: true,
      });
      deleteA2UISurface(surfaceId);
    } catch {
      // apiClient already presents the server error to the user.
    } finally {
      setDeletingSurfaceId(null);
    }
  };

  const surfacesList = Array.from(a2uiSurfaces.values());
  const isEmpty = surfacesList.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(59,130,246,0.03) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    >
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-white/20">
          <Layers className="h-10 w-10 opacity-30" />
          <p className="text-sm">Sin paneles interactivos activos</p>
          <p className="text-xs text-white/15">Los resultados y formularios creados por los agentes aparecerán aquí.</p>
        </div>
      ) : (
        <ScrollArea className="flex-1 p-6">
          {surfacesList.length > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {surfacesList.map((surface) => (
                <div
                  key={surface.surfaceId}
                  className="rounded-xl border border-blue-500/20 bg-[rgba(255,255,255,0.02)] backdrop-blur-sm p-4"
                  style={surface.theme?.primaryColor
                    ? { borderColor: `${surface.theme.primaryColor}33` }
                    : undefined}
                >
                  <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-white/5">
                    {surface.theme?.agentDisplayName ? (
                      <div className="flex items-center gap-2">
                      {surface.theme.iconUrl && (
                        <img src={surface.theme.iconUrl} alt="" className="w-5 h-5 rounded-full" />
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: surface.theme.primaryColor ?? "#93c5fd" }}>
                        {surface.theme.agentDisplayName}
                      </span>
                      </div>
                    ) : <span className="font-mono text-[10px] text-white/40">{surface.surfaceId}</span>}
                    <button
                      type="button"
                      title={`Eliminar superficie ${surface.surfaceId}`}
                      aria-label={`Eliminar superficie ${surface.surfaceId}`}
                      disabled={deletingSurfaceId === surface.surfaceId}
                      onClick={() => handleDeleteSurface(surface.surfaceId)}
                      className="rounded-md p-1.5 text-white/25 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <A2UIRenderer surface={surface} onAction={handleA2UIAction} />
                </div>
              ))}
            </div>
          )}

        </ScrollArea>
      )}

      <div className="border-t border-white/5 bg-white/[0.02] px-6 py-2.5">
        <div className="flex items-center gap-2">
          <Layers className="h-3 w-3 text-blue-400/50" />
          <span className="hive-mono">
            {surfacesList.length > 0
              ? `${surfacesList.length} superficie${surfacesList.length > 1 ? "s" : ""} A2UI activa${surfacesList.length > 1 ? "s" : ""}`
              : "Panel interactivo · sin superficies"}
          </span>
        </div>
      </div>
    </div>
  );
}
