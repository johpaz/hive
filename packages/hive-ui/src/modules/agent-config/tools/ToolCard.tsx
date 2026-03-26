import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import type { Tool } from "@/types";

interface ToolCardProps {
  tool: Tool;
}

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <Card className="transition-colors hover:border-orange-400/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wrench className="h-3.5 w-3.5 text-orange-400" />
          {tool.name}
          <Badge variant={tool.active ? "default" : "secondary"} className="ml-auto text-xs">
            {tool.active ? "Activa" : "Inactiva"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{tool.description}</p>
      </CardContent>
    </Card>
  );
}
