import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ProviderRetryPolicyProps {
  maxRetries?: number;
  retryDelayMs?: number;
  exponentialBackoff?: boolean;
  retryOn?: string[];
}

export function ProviderRetryPolicy({ maxRetries = 3, retryDelayMs = 1000, exponentialBackoff = true }: ProviderRetryPolicyProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Política de Reintentos</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Máximo de reintentos</Label>
          <Input type="number" defaultValue={maxRetries} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Delay inicial (ms)</Label>
          <Input type="number" defaultValue={retryDelayMs} className="h-8 text-sm" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Backoff exponencial</span>
          <Switch defaultChecked={exponentialBackoff} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reintentar en</Label>
          <Select defaultValue="all">
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los errores</SelectItem>
              <SelectItem value="rate_limit">Solo rate limit</SelectItem>
              <SelectItem value="timeout">Solo timeout</SelectItem>
              <SelectItem value="5xx">Solo errores 5xx</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
