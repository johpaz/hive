import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";

interface ProviderRateLimitsProps {
  rpm?: number;
  tpm?: number;
  currentRpm?: number;
  currentTpm?: number;
}

export function ProviderRateLimits({ rpm = 500, tpm = 100000, currentRpm = 120, currentTpm = 35000 }: ProviderRateLimitsProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Límites de Rate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <Label>Requests/min</Label>
            <span className="text-muted-foreground">{currentRpm}/{rpm}</span>
          </div>
          <Progress value={(currentRpm / rpm) * 100} className="h-1.5" />
          <Input type="number" defaultValue={rpm} className="h-8 text-sm" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <Label>Tokens/min</Label>
            <span className="text-muted-foreground">{(currentTpm / 1000).toFixed(0)}K/{(tpm / 1000).toFixed(0)}K</span>
          </div>
          <Progress value={(currentTpm / tpm) * 100} className="h-1.5" />
          <Input type="number" defaultValue={tpm} className="h-8 text-sm" />
        </div>
      </CardContent>
    </Card>
  );
}
