import { Card, CardContent } from "@/components/ui/card";
import type { ChannelStats as ChannelStatsType } from "@/types";

interface ChannelStatsProps {
  stats: ChannelStatsType;
}

export function ChannelStats({ stats }: ChannelStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-lg font-bold">{stats.totalMessages.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">Total mensajes</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-lg font-bold">{stats.messagesLast24h}</p>
          <p className="text-[10px] text-muted-foreground">Últimas 24h</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-lg font-bold">{stats.activeUsers}</p>
          <p className="text-[10px] text-muted-foreground">Usuarios activos</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 text-center">
          <p className="text-lg font-bold">{(stats.errorRate * 100).toFixed(1)}%</p>
          <p className="text-[10px] text-muted-foreground">Tasa de error</p>
        </CardContent>
      </Card>
    </div>
  );
}
