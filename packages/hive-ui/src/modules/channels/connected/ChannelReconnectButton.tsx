import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface ChannelReconnectButtonProps {
  channelId: string;
  onReconnect?: (id: string) => void;
}

export function ChannelReconnectButton({ channelId, onReconnect }: ChannelReconnectButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={() => onReconnect?.(channelId)}>
      <RefreshCw className="mr-1 h-3.5 w-3.5" />
      Reconectar
    </Button>
  );
}
