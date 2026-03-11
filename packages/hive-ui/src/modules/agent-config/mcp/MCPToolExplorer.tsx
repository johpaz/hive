import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Search, Hammer, AlertCircle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Tool {
  name: string;
  description: string;
  inputSchema?: any;
}

interface MCPToolExplorerProps {
  serverId: string;
  serverName: string;
  tools?: Tool[]; // Tools from parent component (already loaded)
}

export function MCPToolExplorer({ serverId, serverName, tools = [] }: MCPToolExplorerProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTools = tools.filter(tool =>
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
        <Input
          placeholder="Buscar herramientas..."
          className="pl-8 h-8 text-[11px] bg-white/5 border-white/10 focus:border-cyan-500/30"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
        {filteredTools.length === 0 ? (
          <div className="py-8 text-center text-[10px] text-zinc-500 italic">
            {searchQuery ? "No se encontraron herramientas que coincidan." : "Este servidor no expone herramientas actualmente."}
          </div>
        ) : (
          filteredTools.map((tool) => (
            <div
              key={tool.name}
              className="p-3 rounded-lg bg-zinc-900/50 border border-white/5 hover:border-cyan-500/20 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded bg-cyan-500/5 text-cyan-400 group-hover:bg-cyan-500/10 transition-colors">
                    <Hammer className="h-3.5 w-3.5" />
                  </div>
                  <h5 className="text-[11px] font-bold text-zinc-200 group-hover:text-cyan-400 transition-colors">{tool.name}</h5>
                </div>
                {tool.inputSchema && (
                  <Badge variant="outline" className="text-[9px] border-zinc-800 text-zinc-600 h-4">
                    JSON Schema
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed line-clamp-2">
                {tool.description}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="p-2 rounded bg-cyan-500/5 border border-cyan-500/10 flex items-center gap-2">
        <Info className="h-3 w-3 text-cyan-500" />
        <span className="text-[9px] text-cyan-200/50">
          Estas herramientas son gestionadas directamente por <span className="text-cyan-400 font-mono">{serverName}</span>.
        </span>
      </div>
    </div>
  );
}
