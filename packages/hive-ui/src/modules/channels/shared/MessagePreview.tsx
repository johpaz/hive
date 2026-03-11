import { Card, CardContent } from "@/components/ui/card";

interface MessagePreviewProps {
  content: string;
  sender?: string;
  timestamp?: string;
}

export function MessagePreview({ content, sender, timestamp }: MessagePreviewProps) {
  return (
    <Card className="max-w-sm">
      <CardContent className="p-3">
        {sender && <p className="text-xs font-semibold">{sender}</p>}
        <p className="text-sm">{content}</p>
        {timestamp && <p className="mt-1 text-[10px] text-muted-foreground text-right">{timestamp}</p>}
      </CardContent>
    </Card>
  );
}
