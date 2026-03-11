import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const mockRules = [
  { id: "1", name: "No divulgar datos personales", severity: "block" as const, enabled: true },
  { id: "2", name: "Verificar antes de eliminar", severity: "warn" as const, enabled: true },
  { id: "3", name: "Registrar acciones sensibles", severity: "info" as const, enabled: false },
];

const severityColors: Record<string, "destructive" | "secondary" | "outline"> = {
  block: "destructive",
  warn: "secondary",
  info: "outline",
};

export function EthicsRulesList() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Reglas activas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mockRules.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={severityColors[rule.severity]} className="text-xs">{rule.severity}</Badge>
              <span className="text-sm">{rule.name}</span>
            </div>
            <Switch defaultChecked={rule.enabled} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
