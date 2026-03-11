import { Button } from "@/components/ui/button";
import { Power } from "lucide-react";

interface ChannelDisconnectButtonProps {
  channelId: string;
  channelName: string;
  onDisconnect?: (id: string) => void;
}

export function ChannelDisconnectButton({ channelId, channelName, onDisconnect }: ChannelDisconnectButtonProps) {
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={() => onDisconnect?.(channelId)}
    >
      <Power className="mr-1 h-3.5 w-3.5" />
      Desconectar
    </Button>
  );
}
