import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChannels } from "@/hooks/useChannels";
import { ChannelCard } from "./ChannelCard";

export function ConnectedChannelsList() {
  const { activeChannels, isLoading } = useChannels();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-muted-foreground">Cargando canales...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Canales Activos</h3>
        <Badge variant="secondary">{activeChannels.length}</Badge>
      </div>
      <ScrollArea className="h-[calc(100vh-16rem)]">
        <div className="space-y-3">
          {activeChannels.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
          {activeChannels.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No hay canales conectados. Ve a la pestaña "Disponibles" para activar uno.
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
