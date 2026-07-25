import { Hexagon, Wifi, WifiOff, Gauge } from "lucide-react";
import type { DeskModel } from "@/modules/office3d/state/useOfficeModel";
import { useOffice3DStore } from "../state/office3dStore";
import { EventTicker } from "./EventTicker";
import { useEventFeed } from "./useEventFeed";
import { AgentInspector } from "./AgentInspector";

interface OfficeHUDProps {
  desks: DeskModel[];
  isConnected: boolean;
  selectedDesk: DeskModel | null;
  coordinatorName: string;
}

export function OfficeHUD({ desks, isConnected, selectedDesk, coordinatorName }: OfficeHUDProps) {
  const quality = useOffice3DStore((s) => s.quality);
  const setQuality = useOffice3DStore((s) => s.setQuality);
  const events = useEventFeed(desks, coordinatorName);

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
            className="office3d-hud-btn"
            onClick={() => setQuality(quality === "high" ? "low" : "high")}
            title="Alternar calidad gráfica"
          >
            <Gauge size={13} />
            {quality === "high" ? "Alta" : "Eco"}
          </button>
        </div>
      </header>

      {/* Cinta de eventos */}
      <div className="office3d-bottom-left">
        <EventTicker events={events} />
      </div>

      {/* Inspector de agente */}
      <AgentInspector desk={selectedDesk} delegatorName={delegatorName} />
    </div>
  );
}
