import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useState } from "react";

interface ChannelTestConnectionProps {
  onTest?: () => Promise<boolean>;
}

export function ChannelTestConnection({ onTest }: ChannelTestConnectionProps) {
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");

  const handleTest = async () => {
    setStatus("testing");
    try {
      const result = await onTest?.();
      setStatus(result ? "success" : "error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Test de Conexión</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {status === "idle" && <p className="text-sm text-muted-foreground">Prueba la conexión antes de guardar</p>}
        {status === "testing" && <Loader2 className="h-8 w-8 animate-spin text-primary" />}
        {status === "success" && <CheckCircle className="h-8 w-8 text-hive-connected" />}
        {status === "error" && <XCircle className="h-8 w-8 text-destructive" />}
        <Button size="sm" onClick={handleTest} disabled={status === "testing"}>
          {status === "testing" ? "Probando..." : "Probar conexión"}
        </Button>
      </CardContent>
    </Card>
  );
}
