import { useParams } from "react-router-dom";
import { CanvasContainer } from "@/modules/canvas/CanvasContainer";
import { useUserStore } from "@/stores/userStore";

export function CanvasPage() {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>();
  const { currentUser } = useUserStore();

  // Priorizar el ID del usuario real si el parámetro es "default" o no existe
  const sessionId = (paramSessionId && paramSessionId !== "default") ? paramSessionId : currentUser?.id;

  if (!sessionId) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background/50 backdrop-blur-sm">
      <div className="flex-1 overflow-hidden p-4 lg:p-8">
        <div className="mx-auto h-full max-w-7xl">
          <CanvasContainer sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
