import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { Layers } from "lucide-react";

export function A2UINotifier() {
  const unseenA2UICount = useCanvasStore((s) => s.unseenA2UICount);
  const navigate = useNavigate();
  const location = useLocation();
  const prevCount = useRef(0);

  useEffect(() => {
    if (unseenA2UICount > prevCount.current && location.pathname !== "/a2ui") {
      toast("Nueva interfaz A2UI disponible", {
        description: "El agente generó componentes para revisar.",
        icon: <Layers className="h-4 w-4" />,
        action: {
          label: "Ver panel",
          onClick: () => navigate("/a2ui"),
        },
      });
    }
    prevCount.current = unseenA2UICount;
  }, [unseenA2UICount, location.pathname, navigate]);

  return null;
}
