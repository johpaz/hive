import { useEffect, useRef } from "react";
import { Hexagon, Wifi, WifiOff, Gauge, Activity, Volume2, VolumeX } from "lucide-react";
import type { CanvasWorkEvent, GraphNode } from "@/stores/canvasStore";
import type { DeskModel, OfficeInteraction } from "@/modules/office3d/state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";
import { EventTicker } from "./EventTicker";
import { useEventFeed } from "./useEventFeed";
import { AgentInspector, CoordinatorInspector } from "./AgentInspector";
import { OfficeRoster } from "./OfficeRoster";
import { NowHappening } from "./NowHappening";
import { playOfficeEventSound, primeOfficeAudio } from "../state/sound";

interface OfficeHUDProps {
  desks: DeskModel[];
  coordinator: GraphNode | null;
  interactions: OfficeInteraction[];
  workEvents: CanvasWorkEvent[];
  isConnected: boolean;
  selectedDesk: DeskModel | null;
  coordinatorSelected: boolean;
  coordinatorName: string;
}

export function OfficeHUD({
  desks,
  coordinator,
  interactions,
  workEvents,
  isConnected,
  selectedDesk,
  coordinatorSelected,
  coordinatorName,
}: OfficeHUDProps) {
  const quality = useOffice3DStore((s) => s.quality);
  const setQuality = useOffice3DStore((s) => s.setQuality);
  const motion = useOffice3DStore((s) => s.motion);
  const setMotion = useOffice3DStore((s) => s.setMotion);
  const soundEnabled = useOffice3DStore((s) => s.soundEnabled);
  const setSoundEnabled = useOffice3DStore((s) => s.setSoundEnabled);
  const events = useEventFeed(desks, interactions, coordinator, workEvents);
  const heardEvents = useRef(new Set<string>());
  const soundInitialized = useRef(false);

  useEffect(() => {
    if (!soundInitialized.current) {
      workEvents.forEach((event) => heardEvents.current.add(event.eventId));
      soundInitialized.current = true;
      return;
    }
    for (const event of workEvents) {
      if (heardEvents.current.has(event.eventId)) continue;
      heardEvents.current.add(event.eventId);
      if (soundEnabled) playOfficeEventSound(event);
    }
  }, [soundEnabled, workEvents]);

  const working = desks.filter((d) => d.state === "thinking" || d.state === "tool_call").length;
  const delegatorName = selectedDesk?.delegatedBy
    ? (desks.find((d) => d.agent.id === selectedDesk.delegatedBy)?.agent.name ?? coordinatorName)
    : coordinatorName;

  return (
    <div className="office3d-hud">
      {/* Barra superior */}
      <header className="office3d-topbar office3d-glass">
        <div className="office3d-topbar-left">
          <div className="office3d-logo">
            <Hexagon size={18} />
          </div>
          <div>
            <h1 className="office3d-title">HoloHive · Oficina 3D</h1>
            <p className="office3d-subtitle">
              {desks.length} especialistas · {working} trabajando
            </p>
          </div>
        </div>

        <div className="office3d-topbar-right">
          <span className={`office3d-live-badge ${isConnected ? "is-live" : "is-off"}`}>
            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>

          <button
            type="button"
            className="office3d-hud-btn"
            onClick={() => setQuality(quality === "high" ? "low" : "high")}
            title="Alternar calidad gráfica"
          >
            <Gauge size={13} />
            {quality === "high" ? "Alta" : "Eco"}
          </button>
          <button
            type="button"
            className={`office3d-hud-btn ${motion === "calm" ? "is-on" : ""}`}
            onClick={() => setMotion(motion === "calm" ? "off" : "calm")}
            title="Alternar enfoque y movimiento de eventos"
          >
            <Activity size={13} />
            {motion === "calm" ? "Enfoque" : "Fijo"}
          </button>
          <button
            type="button"
            className={`office3d-hud-btn ${soundEnabled ? "is-on" : ""}`}
            onClick={() => {
              if (!soundEnabled) primeOfficeAudio();
              setSoundEnabled(!soundEnabled);
            }}
            title={soundEnabled ? "Desactivar sonido de eventos" : "Activar sonido de eventos"}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {soundEnabled ? "Audio" : "Silencio"}
          </button>
        </div>
      </header>

      <NowHappening coordinator={coordinator} desks={desks} />
      <OfficeRoster
        coordinator={coordinator}
        desks={desks}
        interactions={interactions}
        workEvents={workEvents}
      />

      {/* Cinta de eventos */}
      <div className="office3d-bottom-left">
        <EventTicker events={events} />
      </div>

      {/* Inspector de agente */}
      <AgentInspector desk={selectedDesk} delegatorName={delegatorName} />
      {coordinatorSelected && <CoordinatorInspector coordinator={coordinator} />}
    </div>
  );
}
