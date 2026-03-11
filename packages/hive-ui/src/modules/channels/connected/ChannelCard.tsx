import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, RefreshCw, Power, type LucideProps } from "lucide-react";
import type { ConnectedChannel } from "@/types";
import { ChannelStatusBadge } from "./ChannelStatusBadge";
import { ChannelIcon } from "../shared/ChannelIcon";
import { useChannels } from "@/hooks/useChannels";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { ChannelConfigPanel } from "./ChannelConfigPanel";

function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

interface ChannelCardProps {
  channel: ConnectedChannel;
}

export function ChannelCard({ channel }: ChannelCardProps) {
  const { toggleChannel } = useChannels();
  const [isToggling, setIsToggling] = useState(false);

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      await toggleChannel(channel.id, false);
    } catch (error) {
      console.error("Error al desactivar canal:", error);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChannelIcon type={channel.type} className="h-5 w-5" />
            <CardTitle className="text-sm">{channel.name}</CardTitle>
          </div>
          <ChannelStatusBadge status={channel.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{channel.stats?.messagesLast24h ?? 0} mensajes (24h)</p>
            <p>{channel.stats?.activeUsers ?? 0} usuarios activos</p>
          </div>
          <div className="flex gap-1">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Icon icon={Settings as any} className="h-3.5 w-3.5" />
                </Button>
              </SheetTrigger>
              <SheetContent className="sm:max-w-[540px] border-l-white/5 bg-background/95 backdrop-blur-2xl">
                <SheetHeader className="pb-6">
                  <SheetTitle>Configuración del Canal</SheetTitle>
                  <SheetDescription>
                    Ajusta la personalización y políticas de seguridad para {channel.name}.
                  </SheetDescription>
                </SheetHeader>
                <div className="py-2">
                  <ChannelConfigPanel channel={channel} />
                </div>
              </SheetContent>
            </Sheet>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Icon icon={RefreshCw as any} className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={handleToggle}
              disabled={isToggling}
            >
              <Icon icon={Power as any} className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
