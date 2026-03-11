import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ChannelIcon } from "../shared/ChannelIcon";
import type { ChannelType } from "@/types";

interface ChannelTypeCardProps {
  type: ChannelType;
  name: string;
  description: string;
  onConnect?: () => void;
}

export function ChannelTypeCard({ type, name, description, onConnect }: ChannelTypeCardProps) {
  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="flex flex-col items-center gap-3 p-4 text-center">
        <ChannelIcon type={type} className="h-8 w-8" />
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={onConnect}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Conectar
        </Button>
      </CardContent>
    </Card>
  );
}
