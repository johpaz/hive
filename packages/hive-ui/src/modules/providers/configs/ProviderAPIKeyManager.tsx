import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { useState } from "react";

interface ProviderAPIKeyManagerProps {
  providerName: string;
  maskedKey?: string;
  onRotate?: (newKey: string) => void;
}

export function ProviderAPIKeyManager({ providerName, maskedKey, onRotate }: ProviderAPIKeyManagerProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">API Key — {providerName}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">API Key actual</Label>
          <div className="relative">
            <Input type={showKey ? "text" : "password"} defaultValue={maskedKey} readOnly className="h-8 pr-16 text-sm" />
            <div className="absolute right-0 top-0 flex">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" className="w-full">
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Rotar API Key
        </Button>
      </CardContent>
    </Card>
  );
}
