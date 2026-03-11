import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";

interface ChannelWebhookConfigProps {
  webhookUrl?: string;
  onSave?: (url: string) => void;
}

export function ChannelWebhookConfig({ webhookUrl, onSave }: ChannelWebhookConfigProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Configuración de Webhook</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">URL del Webhook</Label>
          <div className="flex gap-2">
            <Input defaultValue={webhookUrl} placeholder="https://..." className="h-8 text-sm" />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Configura esta URL en la plataforma del canal para recibir eventos.</p>
      </CardContent>
    </Card>
  );
}
