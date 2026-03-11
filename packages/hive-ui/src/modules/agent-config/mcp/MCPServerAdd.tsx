import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Server, Globe, Terminal, CheckCircle2, Key, ShieldCheck, Code, Lock } from "lucide-react";
import { swal, Toast } from "@/lib/swal";
import { useMCPServers } from "@/hooks/useProviders";
import { apiClient } from "@/lib/api";

export function MCPServerAdd() {
  const { fetchMCPServers } = useMCPServers();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [transport, setTransport] = useState("stdio");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [authToken, setAuthToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name) {
      Toast.fire({ icon: "error", title: "El nombre es obligatorio" });
      return;
    }

    setIsSubmitting(true);
    try {
      const config: Record<string, unknown> = { transport };

      if (transport === "stdio") {
        if (!command) {
          Toast.fire({ icon: "error", title: "El comando es obligatorio para transporte stdio" });
          setIsSubmitting(false);
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
      } else {
        if (!url) {
          Toast.fire({ icon: "error", title: "La URL es obligatoria para transporte SSE" });
          setIsSubmitting(false);
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
            swal.fire("Error", "JSON de Headers inválido", "error");
            setIsSubmitting(false);
            return;
          }
        }

        if (Object.keys(finalHeaders).length > 0) {
          config.headers = finalHeaders;
        }
      }

      await apiClient("/api/mcp/servers", {
        method: "POST",
        body: { name, config },
        showLoader: "Conectando servidor MCP...",
        showError: true
      });

      Toast.fire({ icon: "success", title: `Servidor "${name}" añadido correctamente` });
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setAuthType("none");
      setAuthToken("");
      setHeaders("");
      setOpen(false);
      await fetchMCPServers();
    } catch (error) {
      // Error handled by apiClient auto-error
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 gap-2">
          <Plus className="h-4 w-4" />
          Añadir Servidor MCP
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] border-cyan-500/20 bg-zinc-950/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <div className="p-1.5 rounded-md bg-cyan-500/10 text-cyan-400">
              <Server className="h-4 w-4" />
            </div>
            Nuevo Servidor MCP
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Conecta una nueva fuente de herramientas para tus agentes mediante el protocolo MCP.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="mcp-name" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Nombre Identificador</Label>
            <Input
              id="mcp-name"
              placeholder="github-tools"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-white/5 border-white/10 focus:border-cyan-500/50 transition-all h-9"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Protocolo de Transporte</Label>
            <Select value={transport} onValueChange={setTransport}>
              <SelectTrigger className="bg-white/5 border-white/10 focus:border-cyan-500/50 h-9">
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
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-2">
                <Label htmlFor="mcp-cmd" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Comando Ejecutable</Label>
                <Input
                  id="mcp-cmd"
                  placeholder="npx"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="bg-white/5 border-white/10 focus:border-cyan-500/50 transition-all h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-args" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Argumentos</Label>
                <Input
                  id="mcp-args"
                  placeholder="-y @modelcontextprotocol/server-github"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className="bg-white/5 border-white/10 focus:border-cyan-500/50 transition-all h-9"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-2">
                <Label htmlFor="mcp-url" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Endpoint URL</Label>
                <Input
                  id="mcp-url"
                  placeholder="https://mcp-server.com/sse"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="bg-white/5 border-white/10 focus:border-cyan-500/50 transition-all h-9"
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
                    <Label htmlFor="mcp-token" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                      {authType === "api-key" ? "API Key" : "Bearer Token"}
                    </Label>
                    <div className="relative">
                      <Input
                        id="mcp-token"
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
                      <Label htmlFor="mcp-headers" className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Headers JSON</Label>
                    </div>
                    <textarea
                      id="mcp-headers"
                      placeholder='{ "x-custom-auth": "secret" }'
                      rows={3}
                      value={headers}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHeaders(val);
                        try {
                          if (val.trim()) JSON.parse(val.trim());
                          e.target.style.borderColor = "";
                        } catch {
                          if (val.trim()) {
                            e.target.style.borderColor = "rgba(239, 68, 68, 0.5)";
                          } else {
                            e.target.style.borderColor = "";
                          }
                        }
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-md p-2 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-cyan-500 shrink-0" />
            <div className="text-[10px] text-cyan-200/70">
              El servidor se inicializará y validará inmediatamente después de ser añadido.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            className="hover:bg-white/5 text-zinc-400 h-9 text-xs"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20 h-9 text-xs px-6"
          >
            {isSubmitting ? "Conectando..." : "Conectar Servidor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
