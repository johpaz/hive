import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiClient } from "@/lib/api";
import {
  Phone,
  Wifi,
  WifiOff,
  RefreshCw,
  LogOut,
  Settings,
  AlertCircle,
  CheckCircle2,
  Loader2,
  HelpCircle,
  Users,
} from "lucide-react";

interface WhatsAppDetails {
  status: string;
  phoneNumber?: string;
  waVersion?: string;
  qrCode?: string;
  lastConnected?: number;
  reconnectAttempts: number;
  reconnectMaxAttempts: number;
  error?: string;
  acceptGroups: boolean;
  dmPolicy?: string;
}

export function WhatsAppConfigPanel() {
  const [details, setDetails] = useState<WhatsAppDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [config, setConfig] = useState({
    acceptGroups: false,
    reconnectMaxAttempts: 10,
    reconnectBaseDelayMs: 5000,
    dmPolicy: "allowlist",
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDetails = useCallback(async () => {
    try {
      const data = await apiClient<{ channels: any[] }>("/api/channels", { showError: false });
      const waChannels = data?.channels?.filter((c: any) => c.type === "whatsapp") || [];
      if (waChannels.length > 0) {
        const waChannel = waChannels[0];
        setChannelId(waChannel.id);
        const detailsData = await apiClient<WhatsAppDetails>(
          `/api/channels/whatsapp/${waChannel.id}/details`,
          { showError: false }
        ).catch(() => null);
        if (detailsData) {
          setDetails(detailsData);
          setConfig({
            acceptGroups: detailsData.acceptGroups ?? false,
            reconnectMaxAttempts: detailsData.reconnectMaxAttempts ?? 10,
            reconnectBaseDelayMs: 5000,
            dmPolicy: detailsData.dmPolicy ?? "allowlist",
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch WhatsApp details:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDetails();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchDetails]);

  const handleConnect = async () => {
    if (!channelId) return;
    setIsConnecting(true);
    try {
      await apiClient(`/api/channels/${channelId}/reconnect`, {
        method: "POST",
      });
      pollRef.current = setInterval(fetchDetails, 3000);
    } catch (error) {
      console.error("Failed to connect:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async (clearSession = false) => {
    if (!channelId) return;
    setIsDisconnecting(true);
    try {
      await apiClient(`/api/channels/whatsapp/${channelId}/disconnect`, {
        method: "POST",
        body: { clearSession },
      });
      await fetchDetails();
    } catch (error) {
      console.error("Failed to disconnect:", error);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!channelId) return;
    setIsSavingConfig(true);
    try {
      await apiClient(`/api/channels/whatsapp/${channelId}/config`, {
        method: "PUT",
        body: config,
      });
      await fetchDetails();
    } catch (error) {
      console.error("Failed to save config:", error);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const getStatusBadge = () => {
    if (!details) return null;
    const statusConfig: Record<string, { color: string; bg: string; icon: any }> = {
      connected: { color: "text-green-400", bg: "bg-green-500/10", icon: CheckCircle2 },
      connecting: { color: "text-amber-400", bg: "bg-amber-500/10", icon: Loader2 },
      disconnected: { color: "text-red-400", bg: "bg-red-500/10", icon: WifiOff },
      qr: { color: "text-blue-400", bg: "bg-blue-500/10", icon: RefreshCw },
      error: { color: "text-red-400", bg: "bg-red-500/10", icon: AlertCircle },
    };
    const { color, bg, icon: Icon } = statusConfig[details.status] || statusConfig.disconnected;
    return (
      <Badge className={`${bg} ${color} border-none`}>
        <Icon className={`h-3 w-3 mr-1 ${details.status === "connecting" ? "animate-spin" : ""}`} />
        {details.status === "connected" ? "Conectado" :
          details.status === "connecting" ? "Conectando..." :
            details.status === "qr" ? "Esperando QR" :
              details.status === "error" ? "Error" : "Desconectado"}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!channelId) {
    return (
      <div className="hive-card border-white/10">
        <div className="hive-card-body flex flex-col items-center justify-center py-12">
          <Phone className="h-12 w-12 text-white/20 mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">WhatsApp no configurado</h3>
          <p className="text-sm text-white/40 text-center max-w-md">
            Ve a la página de Canales para conectar tu cuenta de WhatsApp.
          </p>
          <Button asChild className="mt-4">
            <a href="/channels">Ir a Canales</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Estado de Conexión */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3 border-b border-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Phone className="h-4 w-4 text-emerald-400" />
            Estado de Conexión
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {details?.status === "connected" ? (
                <Wifi className="h-5 w-5 text-green-400" />
              ) : (
                <WifiOff className="h-5 w-5 text-red-400" />
              )}
              <div>
                <p className="text-sm font-medium text-white">
                  {details?.status === "connected" && details.phoneNumber
                    ? `+${details.phoneNumber}`
                    : "Sin conexión"}
                </p>
                {details?.waVersion && (
                  <p className="text-xs text-white/40">
                    WhatsApp Web v{details.waVersion}
                  </p>
                )}
              </div>
            </div>
            {getStatusBadge()}
          </div>

          {details?.lastConnected && (
            <div className="text-xs text-white/40">
              Última conexión: {new Date(details.lastConnected).toLocaleString("es-CO")}
            </div>
          )}

          {details?.error && (
            <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-200/80 text-xs">
                {details.error}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {details?.status === "connected" ? "Reconectar" : "Conectar"}
            </Button>

            <Button
              onClick={() => handleDisconnect(false)}
              disabled={isDisconnecting || details?.status === "disconnected"}
              variant="outline"
              size="sm"
            >
              {isDisconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Desconectar
            </Button>

            <Button
              onClick={() => handleDisconnect(true)}
              disabled={isClearing}
              variant="outline"
              size="sm"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              {isClearing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <LogOut className="h-4 w-4 mr-2" />
              )}
              Cerrar Sesión
            </Button>
          </div>

          <p className="text-xs text-white/30">
            <strong>Cerrar Sesión</strong> borra las credenciales y requiere escanear un nuevo QR.
          </p>
        </CardContent>
      </Card>

      {/* Configuración */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3 border-b border-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Settings className="h-4 w-4 text-blue-400" />
            Configuración
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-white/50" />
              <Label className="text-sm">Aceptar mensajes de grupo</Label>
            </div>
            <Switch
              checked={config.acceptGroups}
              onCheckedChange={(checked) => setConfig({ ...config, acceptGroups: checked })}
            />
          </div>

          <p className="text-xs text-white/40">
            Si está activado, el agente procesará mensajes de grupos donde estés. Por defecto,
            solo procesa mensajes directos (te escribes a ti mismo).
          </p>

          <div className="space-y-2 pt-2">
            <Label className="text-sm">Política de Mensajes</Label>
            <Select
              value={config.dmPolicy}
              onValueChange={(value) => setConfig({ ...config, dmPolicy: value })}
            >
              <SelectTrigger className="bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10">
                <SelectItem value="open">Abierto - Cualquier mensaje</SelectItem>
                <SelectItem value="pairing">Emparejamiento - Requiere vinculación</SelectItem>
                <SelectItem value="allowlist">Lista blanca - Solo usuarios permitidos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Intentos de reconexión</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={config.reconnectMaxAttempts}
              onChange={(e) => setConfig({ ...config, reconnectMaxAttempts: parseInt(e.target.value) || 10 })}
              className="bg-white/5 border-white/10"
            />
            <p className="text-xs text-white/40">
              Intentos máximos antes de detenerse (default: 10)
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Delay base de reconexión (ms)</Label>
            <Input
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={config.reconnectBaseDelayMs}
              onChange={(e) => setConfig({ ...config, reconnectBaseDelayMs: parseInt(e.target.value) || 5000 })}
              className="bg-white/5 border-white/10"
            />
            <p className="text-xs text-white/40">
              Espera inicial entre reintentos con backoff exponencial (default: 5000 ms)
            </p>
          </div>

          <Button
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
            className="w-full"
          >
            {isSavingConfig ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Guardar Configuración
          </Button>
        </CardContent>
      </Card>

      {/* Guía de Uso */}
      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-3 border-b border-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-amber-400" />
            Guía de Uso
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4 text-sm text-white/70">
          <div>
            <h4 className="font-medium text-white mb-1">¿Cómo funciona?</h4>
            <p className="text-xs text-white/50">
              WhatsApp en Hive usa el protocolo WhatsApp Web (Baileys). Te conectas escaneando
              un QR con tu teléfono. Luego, <strong>te escribes a ti mismo</strong> para chatear con
              el agente — es como si usaras un segundo WhatsApp vinculado.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-white mb-1">Cómo vincular</h4>
            <ol className="text-xs text-white/50 list-decimal list-inside space-y-1">
              <li>Haz clic en "Conectar" arriba</li>
              <li>Escanea el QR con WhatsApp → Ajustes → Dispositivos vinculados</li>
              <li>Espera a que diga "Conectado"</li>
            </ol>
          </div>

          <div>
            <h4 className="font-medium text-white mb-1">Si se desconecta</h4>
            <p className="text-xs text-white/50">
              El sistema intentará reconectarse automáticamente. Si ves "Error" o "loggedOut", haz clic en
              "Reconectar" para generar un nuevo QR y escanea de nuevo.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-white mb-1">Limitaciones</h4>
            <p className="text-xs text-white/50">
              Este NO es la API oficial de WhatsApp (que cuesta $!). Usabaileys (protocolo no oficial)
              que puede rompersi WhatsApp cambia el protocolo. Es para uso personal.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-white mb-1">Voz</h4>
            <p className="text-xs text-white/50">
              Activa voz en la configuración del canal en la página de Canales. Necesitas configurar un
              provider STT/TTS en Ajustes → Voz.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}