import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";
import { Settings, type LucideProps } from "lucide-react";

// Wrapper to fix React 19 + Lucide type compatibility
function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
    return <IconComponent {...props} />;
}

interface GlobalConfig {
    gateway?: { host?: string; port?: number };
    models?: {
        defaultProvider?: string;
        defaults?: Record<string, string>;
        providers?: Record<string, { apiKey?: string; baseURL?: string }>;
    };
    agents?: { list?: Array<{ id: string; name?: string; default?: boolean; workspace?: string }> };
    mcp?: { servers?: Record<string, unknown> };
    skills?: { allowBundled?: string[]; managedDir?: string };
    channels?: Record<string, unknown>;
}

export function GlobalConfigOverview() {
    const [config, setConfig] = useState<GlobalConfig | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        apiClient<GlobalConfig>("/api/config")
            .then(setConfig)
            .catch((e) => setError(e.message))
            .finally(() => setIsLoading(false));
    }, []);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Icon icon={Settings as any} className="h-4 w-4 text-amber-400" />
                        Configuración global
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground animate-pulse">Cargando configuración...</p>
                </CardContent>
            </Card>
        );
    }

    if (error || !config) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Icon icon={Settings as any} className="h-4 w-4 text-amber-400" />
                        Configuración global
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-destructive">Error: {error || "No se pudo cargar"}</p>
                </CardContent>
            </Card>
        );
    }

    const provider = config.models?.defaultProvider ?? "—";
    const model = config.models?.defaults?.[provider] ?? "—";
    const agentCount = config.agents?.list?.length ?? 0;
    const mcpCount = config.mcp?.servers ? Object.keys(config.mcp.servers).length : 0;
    const channelCount = config.channels ? Object.keys(config.channels).length : 0;
    const skillCount = config.skills?.allowBundled?.length ?? 0;
    const gateway = config.gateway;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <Icon icon={Settings as any} className="h-4 w-4 text-amber-400" />
                    Configuración global
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="LLM Provider" value={provider} />
                    <ConfigItem label="Modelo" value={model} />
                    <ConfigItem label="Gateway" value={gateway ? `${gateway.host}:${gateway.port}` : "—"} />
                    <ConfigItem label="Agentes" value={String(agentCount)} />
                    <ConfigItem label="Canales" value={String(channelCount)} />
                    <ConfigItem label="MCP Servers" value={String(mcpCount)} />
                    <ConfigItem label="Skills activos" value={String(skillCount)} />
                </div>

                {/* Workspace files */}
                <div className="mt-3 border-t pt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Archivos del workspace</p>
                    <div className="flex flex-wrap gap-1.5">
                        {["SOUL.md", "ETHICS.md", "USER.md", "TOOLS.md", "MCP.md", "SKILLS.md"].map((file) => (
                            <Badge key={file} variant="outline" className="text-xs">
                                {file}
                            </Badge>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xs font-medium truncate">{value}</p>
        </div>
    );
}
