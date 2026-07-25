import { useLiveOffice } from "./state/useLiveOffice";
import { useOffice3DStore } from "./state/office3dStore";
import { HoloScene } from "./scene/HoloScene";
import { OfficeHUD } from "./hud/OfficeHUD";
import "./office3d.css";

/**
 * HoloHive · Oficina 3D — centro de mando holográfico de los agentes.
 * Ruta perezosa (/office): three.js viaja en su propio chunk.
 */
export default function Office3DPage() {
  const { coordinator, desks, isConnected } = useLiveOffice();
  const selectedAgentId = useOffice3DStore((s) => s.selectedAgentId);

  const selectedDesk = desks.find((d) => d.agent.id === selectedAgentId) ?? null;
  const coordinatorName = coordinator?.name ?? "Coordinador";

  return (
    <div className="office3d-root">
      <HoloScene desks={desks} coordinatorId={coordinator?.id ?? null} coordinatorStatus={coordinator?.status ?? null} />
      <OfficeHUD
        desks={desks}
        isConnected={isConnected}
        selectedDesk={selectedDesk}
        coordinatorName={coordinatorName}
      />
    </div>
  );
}
