import { ScrollArea } from "@/components/ui/scroll-area";
import type { AgentActivity } from "@/types";

interface AgentActivityLogProps {
  activities: AgentActivity[];
}

export function AgentActivityLog({ activities }: AgentActivityLogProps) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin actividad reciente</p>;
  }

  return (
    <ScrollArea className="h-60">
      <div className="space-y-2">
        {activities.map((activity) => (
          <div key={activity.id} className="rounded-md border px-3 py-2 text-xs">
            <span className="font-medium">{activity.action}</span>
            <span className="ml-2 text-muted-foreground">{activity.details}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
