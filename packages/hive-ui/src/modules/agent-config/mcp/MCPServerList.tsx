import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, Server, AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MCPServerCard } from "./MCPServerCard";
import { MCPServerConfig } from "./MCPServerConfig";
import { MCPServerAdd } from "./MCPServerAdd";
import { useMCPServers } from "@/hooks/useProviders";

export function MCPServerList() {
  const { servers, activeServers, isLoading, fetchMCPServers } = useMCPServers();
  const [configuringServer, setConfiguringServer] = useState<any | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => { fetchMCPServers(); }, [fetchMCPServers]);

  const filteredServers = servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCardClick = (server: any) => {
    setConfiguringServer({
      ...server,
      args: typeof server.args === "string" ? JSON.parse(server.args) : server.args,
    });
  };

  // Note: Global loader is handled by apiClient in fetchMCPServers or initial sync

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">MCP Ecosystem</h4>
            <p className="text-[10px] text-zinc-500 font-mono">Model Context Protocol Servers</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 group-focus-within:text-cyan-400 transition-colors" />
            <Input
              placeholder="Buscar servidor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-zinc-900/50 border-white/5 focus:border-cyan-500/30 transition-all h-9 w-[260px] text-xs"
            />
          </div>
          <MCPServerAdd />
        </div>
      </div>

      {filteredServers.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-2xl bg-zinc-950/20 group hover:border-cyan-500/20 transition-colors">
          <div className="p-4 rounded-full bg-zinc-900 mb-4 group-hover:scale-110 transition-transform">
            <AlertTriangle className="h-8 w-8 text-zinc-700 group-hover:text-cyan-500/50 transition-colors" />
          </div>
          <p className="text-xs text-zinc-500 font-medium">No se detectan servidores MCP configurados.</p>
          <p className="text-[10px] text-zinc-600 mt-1">Añade uno para expandir las capacidades de tus agentes.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredServers.map(server => (
            <MCPServerCard
              key={server.id}
              server={server}
              isConnected={server.status === "connected" || server.active === true}
              onClick={() => handleCardClick(server)}
            />
          ))}
        </div>
      )}

      {configuringServer && (
        <MCPServerConfig
          server={configuringServer}
          onClose={() => setConfiguringServer(null)}
        />
      )}
    </div>
  );
}
