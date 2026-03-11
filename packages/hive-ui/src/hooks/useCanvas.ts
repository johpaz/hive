import { useCanvasStore } from "@/stores/canvasStore";
import type { CanvasComponent } from "@/types";

export function useCanvas() {
  const components = useCanvasStore((s) => s.components);
  const selectedComponentId = useCanvasStore((s) => s.selectedComponentId);
  const sessionId = useCanvasStore((s) => s.sessionId);
  const addComponent = useCanvasStore((s) => s.addComponent);
  const removeComponent = useCanvasStore((s) => s.removeComponent);
  const selectComponent = useCanvasStore((s) => s.selectComponent);
  const setSessionId = useCanvasStore((s) => s.setSessionId);

  const selectedComponent = components.find((c) => c.id === selectedComponentId) || null;

  return {
    components,
    selectedComponent,
    sessionId,
    addComponent: (component: CanvasComponent) => addComponent(component),
    removeComponent,
    selectComponent,
    setSessionId,
  };
}
