import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { ConfigValidationError } from "@/types";

interface ValidationPanelProps {
  errors: ConfigValidationError[];
}

const severityIcon = {
  error: <AlertCircle className="h-4 w-4 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
};

export function ValidationPanel({ errors }: ValidationPanelProps) {
  if (errors.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">Validación ({errors.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {errors.map((err, i) => (
          <div key={`${err.section}-${err.field}-${err.severity}`} className="flex items-start gap-2 text-xs">
            {severityIcon[err.severity]}
            <div>
              <span className="font-medium">{err.section}/{err.field}:</span>{" "}
              <span className="text-muted-foreground">{err.message}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
