import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, type LucideProps } from "lucide-react";
import { useChannels } from "@/hooks/useChannels";
import { ChannelIcon } from "../shared/ChannelIcon";
import type { ChannelType } from "@/types";
import { useState } from "react";

function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

const channelInfo: Record<string, { name: string; description: string }> = {
  telegram: { name: "Telegram", description: "Bot de Telegram con comandos y grupos" },
  whatsapp: { name: "WhatsApp", description: "WhatsApp Web con QR o código" },
  discord: { name: "Discord", description: "Bot de Discord para servidores" },
  slack: { name: "Slack", description: "Integración con workspaces" },
  signal: { name: "Signal", description: "Mensajería segura" },
  webchat: { name: "Web Chat", description: "Widget embebible" },
  matrix: { name: "Matrix", description: "Protocolo descentralizado" },
  teams: { name: "Microsoft Teams", description: "Integración con Teams" },
};

export function AvailableChannelsGrid() {
  const { channels, fetchChannels, toggleChannel } = useChannels();
  const [isToggling, setIsToggling] = useState<string | null>(null);

  const handleActivate = async (type: string) => {
    setIsToggling(type);
    try {
      await toggleChannel(type, true);
      await fetchChannels();
    } catch (error) {
      console.error("Error al activar canal:", error);
    } finally {
      setIsToggling(null);
    }
  };

  // Get channels that are not yet active
  const inactiveChannelTypes = Object.keys(channelInfo).filter(
    (type) => !channels.some((c) => c.type === type && c.active)
  );

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Canales Disponibles</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {inactiveChannelTypes.map((type) => {
          const info = channelInfo[type];
          return (
            <Card key={type} className="transition-colors hover:border-primary/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ChannelIcon type={type as ChannelType} className="h-6 w-6" />
                  <div>
                    <p className="text-sm font-semibold">{info.name}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{info.description}</p>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => handleActivate(type)}
                  disabled={isToggling === type}
                >
                  {isToggling === type ? (
                    <>Activando...</>
                  ) : (
                    <>
                      <Icon icon={Plus as any} className="mr-1 h-3 w-3" />
                      Activar
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {inactiveChannelTypes.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
            Todos los canales están activados
          </div>
        )}
      </div>
    </div>
  );
}
