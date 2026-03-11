import type { Agent } from "@/types";
import { AgentStatusBadge } from "./AgentStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface AgentDetailProps {
  agent: Agent | null;
}

export function AgentDetail({ agent }: AgentDetailProps) {
  if (!agent) {
    return <p className="text-sm text-muted-foreground">Agente no encontrado</p>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{agent.name}</CardTitle>
        <AgentStatusBadge status={agent.status} />
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground">{agent.description}</p>
        {/* Detail sections will be added here */}
      </CardContent>
    </Card>
  );
}
