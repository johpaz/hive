import { Card, CardContent } from "@/components/ui/card";
import { QrCode } from "lucide-react";

interface ChannelQRCodeProps {
  qrData?: string;
  pairingCode?: string;
}

export function ChannelQRCode({ qrData, pairingCode }: ChannelQRCodeProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-6">
        <div className="flex h-48 w-48 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/50">
          {qrData ? (
            <img src={qrData} alt="QR Code" className="h-full w-full rounded-lg object-contain" />
          ) : (
            <QrCode className="h-16 w-16 text-muted-foreground/50" />
          )}
        </div>
        {pairingCode && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Código de emparejamiento</p>
            <p className="font-mono text-lg font-bold tracking-widest">{pairingCode}</p>
          </div>
        )}
        {!qrData && !pairingCode && (
          <p className="text-xs text-muted-foreground">Esperando código QR...</p>
        )}
      </CardContent>
    </Card>
  );
}
