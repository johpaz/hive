import { Badge } from "@/components/ui/badge";
import type { ModelPerformance } from "@/types";

interface ModelBenchmarkBadgeProps {
  performance: ModelPerformance;
}

export function ModelBenchmarkBadge({ performance }: ModelBenchmarkBadgeProps) {
  const qualityColor = {
    low: "bg-muted text-muted-foreground",
    medium: "bg-hive-thinking/15 text-hive-thinking",
    high: "bg-hive-connected/15 text-hive-connected",
    highest: "bg-primary/15 text-primary",
  };

  return (
    <Badge variant="outline" className={`${qualityColor[performance.quality]} text-[10px] py-0 h-4`}>
      {performance.quality === "highest" ? "⭐ Top" : performance.quality}
    </Badge>
  );
}
