import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAgentStore } from "@/stores/agentStore";
import { Bot, Activity, type LucideProps } from "lucide-react";

// Wrapper to fix React 19 + Lucide type compatibility
function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
    return <IconComponent {...props} />;
}

const statusColors: Record<string, string> = {
    active: "bg-green-500",
    idle: "bg-yellow-500",
    hibernated: "bg-gray-400",
    error: "bg-red-500",
    thinking: "bg-blue-500 animate-pulse",
};

const statusLabels: Record<string, string> = {
    active: "Activo",
    idle: "Inactivo",
    hibernated: "Hibernado",
    error: "Error",
    thinking: "Pensando",
};

export function ActiveAgentsList() {
    const { agents, isLoading, error, fetchAgents } = useAgentStore();

    useEffect(() => {
        fetchAgents();
    }, [fetchAgents]);

    if (isLoading) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Icon icon={Bot as any} className="h-4 w-4 text-purple-400" />
                        Agentes activos
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground animate-pulse">Cargando agentes...</p>
                </CardContent>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Icon icon={Bot as any} className="h-4 w-4 text-purple-400" />
                        Agentes activos
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-destructive">Error: {error}</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                    <Icon icon={Bot as any} className="h-4 w-4 text-purple-400" />
                    Agentes activos
                    <Badge variant="secondary" className="ml-auto text-xs">{agents.length}</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {agents.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No hay agentes configurados</p>
                ) : (
                    <div className="space-y-2">
                        {agents.map((agent) => (
                            <div key={agent.id} className="flex items-center justify-between rounded-md border p-2">
                                <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${statusColors[agent.status] || "bg-gray-400"}`} />
                                    <div>
                                        <p className="text-xs font-medium">{agent.name || agent.id}</p>
                                        {agent.description && (
                                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{agent.description}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                        {statusLabels[agent.status] || agent.status}
                                    </Badge>
                                    {(agent as any).provider && (
                                        <Badge variant="secondary" className="text-xs">
                                            {(agent as any).provider}/{(agent as any).model}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
