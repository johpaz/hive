import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  X,
  Loader2,
  Trash2,
  Settings2,
  Terminal,
  Globe,
  Power,
  Key,
  ShieldCheck,
  Code,
  Lock
} from "lucide-react";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";
import { apiClient } from "@/lib/api";
import { MCPToolExplorer } from "./MCPToolExplorer";
import { useMCPServers } from "@/hooks/useProviders";

interface MCPServerConfigProps {
  server: {
    id: string;
    name: string;
    transport: string;
    status: string;
    enabled: boolean | number;
    active: boolean | number;
    builtin: boolean | number;
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    tools?: any[];
  };
  onClose: () => void;
}

function getAuthFromHeaders(headers?: Record<string, string>): { authType: string; authToken: string } {
  if (!headers) return { authType: "none", authToken: "" };
  if (headers["x-api-key"]) return { authType: "api-key", authToken: headers["x-api-key"] };
  if (headers["Authorization"]?.startsWith("Bearer ")) {
    return { authType: "bearer", authToken: headers["Authorization"].replace("Bearer ", "") };
  }
  if (Object.keys(headers).length > 0) return { authType: "custom", authToken: "" };
  return { authType: "none", authToken: "" };
}

export function MCPServerConfig({ server, onClose }: MCPServerConfigProps) {
  const { updateMCPServer, toggleMCPServer, deleteMCPServer, fetchMCPServers } = useMCPServers();
  const [transport, setTransport] = useState(server.transport || "stdio");
  const [command, setCommand] = useState(server.command || "");
  const [args, setArgs] = useState(server.args?.join(" ") || "");
  const [url, setUrl] = useState(server.url || "");
  const [authType, setAuthType] = useState(() => getAuthFromHeaders(server.headers).authType);
  const [authToken, setAuthToken] = useState(() => getAuthFromHeaders(server.headers).authToken);
  const [headers, setHeaders] = useState(server.headers ? JSON.stringify(server.headers, null, 2) : "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "tools">("config");
  const [liveStatus, setLiveStatus] = useState(server.status);
  const [liveActive, setLiveActive] = useState(server.active);

  const isConnected = liveStatus === "connected" || liveActive === 1 || liveActive === true;

  // Fetch fresh data from DB when dialog opens (headers are unredacted)
  useEffect(() => {
    let cancelled = false;
    const fetchDetail = async () => {
      setIsFetching(true);
      try {
        const data = await apiClient<any>(`/api/mcp/servers/${server.id}`);
        if (cancelled) return;
        setTransport(data.transport || "stdio");
        setCommand(data.command || "");
        setArgs(Array.isArray(data.args) ? data.args.join(" ") : "");
        setUrl(data.url || "");
        const auth = getAuthFromHeaders(data.headers);
        setAuthType(auth.authType);
        setAuthToken(auth.authToken);
        setHeaders(data.headers ? JSON.stringify(data.headers, null, 2) : "");
        setLiveStatus(data.status || server.status);
        setLiveActive(data.enabled ? 1 : 0);
      } catch {
        // fallback to store data — already set in initial state
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    };
    fetchDetail();
    return () => { cancelled = true; };
  }, [server.id]);

  const handleUpdate = async () => {
    setIsUpdating(true);
    loader.show("Actualizando configuración...");
    try {
      const config: any = { transport };
      if (transport === "stdio") {
        if (!command) {
          Toast.fire({ icon: "warning", title: "El comando es obligatorio" });
          return;
        }
        config.command = command;
        // Parse arguments: handle JSON arrays or space/comma separated strings
        const trimmedArgs = args.trim();
        if (trimmedArgs.startsWith('[') && trimmedArgs.endsWith(']')) {
          try {
            config.args = JSON.parse(trimmedArgs);
          } catch {
            config.args = trimmedArgs.match(/"[^"]*"|'[^']*'|[^\\s,]+/g)?.map(arg =>
              arg.replace(/^["']|["']$/g, '').replace(/,$/, '').trim()
            ).filter(Boolean) || [];
          }
        } else {
          config.args = trimmedArgs.match(/"[^"]*"|'[^']*'|[^\\s,]+/g)?.map(arg =>
            arg.replace(/^["']|["']$/g, '').replace(/,$/, '').trim()
          ).filter(Boolean) || [];
        }
      } else if (transport === "sse") {
        if (!url) {
          Toast.fire({ icon: "warning", title: "La URL es obligatoria" });
          return;
        }
        config.url = url;

        let finalHeaders: Record<string, string> = {};
        if (authType === "api-key" && authToken) {
          finalHeaders["x-api-key"] = authToken;
        } else if (authType === "bearer" && authToken) {
          finalHeaders["Authorization"] = `Bearer ${authToken}`;
        } else if (authType === "custom" && headers.trim()) {
          try {
            finalHeaders = JSON.parse(headers.trim());
          } catch (e) {
            Toast.fire({ icon: "error", title: "JSON de Headers inválido" });
            return;
          }
        }

        if (Object.keys(finalHeaders).length > 0) {
          config.headers = finalHeaders;
        }
      }

      await updateMCPServer(server.id, config);
      await fetchMCPServers();
      Toast.fire({ icon: "success", title: "Configuración actualizada" });
    } catch (error) {
      Toast.fire({ icon: "error", title: error instanceof Error ? error.message : "Error al actualizar configuración" });
    } finally {
      setIsUpdating(false);
      loader.hide();
    }
  };

  const handleToggleConnection = async () => {
    setIsToggling(true);
    loader.show(isConnected ? "Desconectando servidor..." : "Conectando servidor...");
    try {
      await toggleMCPServer(server.id, !isConnected);
      const newActive = !isConnected ? 1 : 0;
      setLiveActive(newActive);
      setLiveStatus(!isConnected ? "connected" : "disconnected");
      Toast.fire({ icon: "success", title: isConnected ? "Servidor desconectado" : "Servidor conectado" });
      setTimeout(fetchMCPServers, 1500);
    } catch {
      Toast.fire({ icon: "error", title: "Error al cambiar estado de conexión" });
    } finally {
      setIsToggling(false);
      loader.hide();
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await apiClient(`/api/mcp/servers/${server.id}`, {
        method: "DELETE",
        showLoader: "Eliminando servidor...",
        showError: true
      });
      await fetchMCPServers();
      onClose();
    } catch {
      // Error handled by apiClient
    } finally {
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px] border-cyan-500/20 bg-zinc-950/95 backdrop-blur-xl p-0 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isConnected ? "bg-cyan-500/10 text-cyan-400" : "bg-zinc-800 text-zinc-500"}`}>
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-white flex items-center gap-2">
                  Configurar {server.name}
                  {isConnected && <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />}
                </DialogTitle>
                <DialogDescription className="text-[10px] font-mono opacity-50 uppercase tracking-widest mt-0.5">
                  ID: {server.id} • {server.transport}
                </DialogDescription>
              </div>
            </div>
            {!server.builtin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirmingDelete(true)}
                disabled={isDeleting || confirmingDelete}
                className="text-zinc-600 hover:text-red-400 hover:bg-red-400/10 h-8 w-8 transition-colors"
                title="Eliminar Servidor"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1 mt-6 border-b border-white/5">
            <button
              onClick={() => setActiveTab("config")}
              className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all relative ${activeTab === "config" ? "text-cyan-400" : "text-zinc-500 hover:text-zinc-300"
                }`}
            >
              Configuración
              {activeTab === "config" && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-500" />}
            </button>
            <button
              onClick={() => setActiveTab("tools")}
              className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all relative ${activeTab === "tools" ? "text-cyan-400" : "text-zinc-500 hover:text-zinc-300"
                }`}
            >
              Herramientas
              {activeTab === "tools" && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-500" />}
            </button>
          </div>
        </DialogHeader>

        {confirmingDelete && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-xs text-red-400 font-medium mb-3">
              ¿Eliminar <span className="font-bold">{server.name}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(false)}
                disabled={isDeleting}
                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white"
              >
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Sí, eliminar"}
              </Button>
            </div>
          </div>
        )}

        <div className="p-6">
          {activeTab === "config" ? (
            <div className="space-y-4 animate-in fade-in duration-300">
              {isFetching && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Cargando configuración...</span>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Transporte</Label>
                <Select value={transport} onValueChange={setTransport}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-white/10">
                    <SelectItem value="stdio" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5" />
                        <span>stdio (Binario Local)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="sse" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" />
                        <span>SSE (Remote HTTP)</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {transport === "stdio" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Comando</Label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      className="bg-white/5 border-white/10 focus:border-cyan-500/50 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Argumentos</Label>
                    <Input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      className="bg-white/5 border-white/10 focus:border-cyan-500/50 h-9"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Endpoint URL</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="bg-white/5 border-white/10 focus:border-cyan-500/50 h-9"
                    />
                  </div>
                  <div className="space-y-4 pt-2 border-t border-white/5">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Autenticación</Label>
                      <Select value={authType} onValueChange={setAuthType}>
                        <SelectTrigger className="bg-white/5 border-white/10 focus:border-cyan-500/50 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10">
                          <SelectItem value="none" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                            <div className="flex items-center gap-2">
                              <Globe className="h-3.5 w-3.5" />
                              <span>Ninguna</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="api-key" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                            <div className="flex items-center gap-2">
                              <Key className="h-3.5 w-3.5" />
                              <span>API Key (x-api-key)</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="bearer" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              <span>Bearer Token (Authorization)</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="custom" className="focus:bg-cyan-500/20 focus:text-cyan-400">
                            <div className="flex items-center gap-2">
                              <Code className="h-3.5 w-3.5" />
                              <span>Custom Headers (JSON)</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(authType === "api-key" || authType === "bearer") && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          {authType === "api-key" ? "API Key" : "Bearer Token"}
                        </Label>
                        <div className="relative">
                          <Input
                            type="password"
                            placeholder="sk-..."
                            value={authToken}
                            onChange={(e) => setAuthToken(e.target.value)}
                            className="bg-white/5 border-white/10 focus:border-cyan-500/50 transition-all h-9 pl-9"
                          />
                          <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                        </div>
                      </div>
                    )}

                    {authType === "custom" && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="flex items-center justify-between">
                          <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Headers JSON</Label>
                        </div>
                        <textarea
                          value={headers}
                          onChange={(e) => setHeaders(e.target.value)}
                          placeholder='{ "x-custom-auth": "secret" }'
                          rows={3}
                          className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-lg bg-zinc-900 border border-white/5 flex items-center justify-between mt-6">
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-full ${isConnected ? "bg-green-500/10 text-green-400" : "bg-zinc-800 text-zinc-500"}`}>
                    <Power className={`h-3.5 w-3.5 ${isConnected ? "animate-pulse" : ""}`} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-tight">Estado del Nodo</span>
                    <span className={`text-[9px] font-mono ${isConnected ? "text-green-500" : "text-zinc-500"}`}>
                      {isConnected ? "ACTIVE_CONNECTION" : "INACTIVE_NODE"}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={isConnected ? "outline" : "default"}
                  onClick={handleToggleConnection}
                  disabled={isToggling}
                  className={`h-7 px-4 text-[10px] font-bold uppercase tracking-wider ${isConnected ? "border-zinc-800 text-zinc-400 hover:bg-zinc-800" : "bg-cyan-600 hover:bg-cyan-500 text-white"
                    }`}
                >
                  {isToggling ? <Loader2 className="h-3 w-3 animate-spin" /> : isConnected ? "Desconectar" : "Conectar"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="animate-in fade-in duration-300">
              <MCPToolExplorer serverId={server.id} serverName={server.name} tools={server.tools || []} />
            </div>
          )}
        </div>

        <DialogFooter className="p-6 bg-white/[0.02] border-t border-white/5">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-zinc-500 hover:text-white"
          >
            Cerrar
          </Button>
          {activeTab === "config" && (
            <Button
              onClick={handleUpdate}
              disabled={isUpdating}
              className="bg-cyan-600 hover:bg-cyan-500 text-white min-w-[120px]"
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar Cambios"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
