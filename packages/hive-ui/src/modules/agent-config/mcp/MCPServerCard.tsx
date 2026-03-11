import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Cpu, Globe } from "lucide-react";
import type { ComponentType, SVGAttributes } from "react";

interface MCPServerCardProps {
  server: {
    id?: string;
    name: string;
    status: string;
    enabled: boolean | number;
    transport: string;
    builtin: boolean | number;
    url?: string;
    tools?: any[];
    tools_count?: number;
  };
  onClick?: () => void;
  isConnected?: boolean;
  isLoading?: boolean;
}

export function MCPServerCard({ server, onClick, isConnected, isLoading }: MCPServerCardProps) {
  const LoaderIcon = Loader2 as ComponentType<SVGAttributes<SVGSVGElement>>;

  const connectionStatus = isConnected || server.status === "connected";
  const isStdio = server.transport === "stdio";

  return (
    <Card
      onClick={onClick}
      className={`group relative overflow-hidden transition-all hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/5 cursor-pointer border-white/5 bg-zinc-950/50 backdrop-blur-sm ${connectionStatus ? "border-cyan-500/20 bg-cyan-500/[0.02]" : "opacity-80 grayscale-[0.2]"
        } ${isLoading ? "pointer-events-none opacity-50" : ""}`}
    >
      <div className={`absolute top-0 left-0 w-1 h-full transition-colors ${connectionStatus ? "bg-cyan-500" : "bg-zinc-800"
        }`} />

      <CardHeader className="pb-2">
        <div className="flex items-start justify-between mb-2">
          <div className={`p-2 rounded-lg transition-colors ${connectionStatus ? "bg-cyan-500/10 text-cyan-400" : "bg-zinc-800 text-zinc-500"
            }`}>
            {isStdio ? <Cpu className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
          </div>
          <div className="flex items-center gap-2">
            {connectionStatus ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
                <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-wider">LIVE</span>
              </div>
            ) : (
              <Badge variant="outline" className="text-[10px] border-zinc-800 text-zinc-500 uppercase tracking-tighter">
                OFFLINE
              </Badge>
            )}
          </div>
        </div>

        <CardTitle className="text-sm font-bold truncate group-hover:text-cyan-400 transition-colors">
          {server.name}
        </CardTitle>
        <CardDescription className="text-[10px] font-mono opacity-50 truncate mt-0.5">
          {server.url || `stdio: ${server.transport}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0 pb-4">
        <div className="flex items-center gap-3 mt-2">
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">Transport</span>
            <span className="text-xs font-semibold text-zinc-300">{server.transport}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">Tools</span>
            <span className="text-xs font-semibold text-zinc-300">
              {(server.tools?.length || server.tools_count || 0)} expuestas
            </span>
          </div>
        </div>

        {server.builtin && (
          <Badge variant="outline" className="mt-3 text-[9px] border-amber-500/20 text-amber-500/70 bg-amber-500/5">
            BUILTIN
          </Badge>
        )}
      </CardContent>

      {connectionStatus && (
        <div className="absolute -bottom-6 -right-6 w-12 h-12 bg-cyan-500/10 blur-2xl rounded-full" />
      )}
    </Card>
  );
}
