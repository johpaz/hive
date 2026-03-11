import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface ProviderEndpointConfigProps {
  baseUrl?: string;
  organization?: string;
  onSave?: (config: { baseUrl: string; organization?: string }) => void;
}

export function ProviderEndpointConfig({ baseUrl, organization, onSave }: ProviderEndpointConfigProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Configuración de Endpoint</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Base URL</Label>
          <Input defaultValue={baseUrl} placeholder="https://api.openai.com/v1" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Organización (opcional)</Label>
          <Input defaultValue={organization} placeholder="org-..." className="h-8 text-sm" />
        </div>
      </CardContent>
    </Card>
  );
}
