import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DiffViewerProps {
  before: string;
  after: string;
  labelBefore?: string;
  labelAfter?: string;
}

export function DiffViewer({ before, after, labelBefore = "Anterior", labelAfter = "Actual" }: DiffViewerProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground">{labelBefore}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-xs">{before || "Vacío"}</pre>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground">{labelAfter}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-xs">{after || "Vacío"}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
