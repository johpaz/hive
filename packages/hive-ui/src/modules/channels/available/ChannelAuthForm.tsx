import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

interface ChannelAuthFormProps {
  channelType: string;
  onSubmit?: (credentials: Record<string, string>) => void;
}

export function ChannelAuthForm({ channelType, onSubmit }: ChannelAuthFormProps) {
  const [showToken, setShowToken] = useState(false);

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Autenticación — {channelType}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Token / API Key</Label>
          <div className="relative">
            <Input type={showToken ? "text" : "password"} placeholder="Ingresa el token..." className="h-8 pr-8 text-sm" />
            <Button variant="ghost" size="icon" className="absolute right-0 top-0 h-8 w-8" onClick={() => setShowToken(!showToken)}>
              {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        <Button size="sm" className="w-full">Validar credenciales</Button>
      </CardContent>
    </Card>
  );
}
