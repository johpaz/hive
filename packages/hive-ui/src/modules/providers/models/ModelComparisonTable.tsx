import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ModelDefinition } from "@/types";
import { ModelCapabilities } from "./ModelCapabilities";

interface ModelComparisonTableProps {
  models: ModelDefinition[];
}

export function ModelComparisonTable({ models }: ModelComparisonTableProps) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Comparación de Modelos</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Modelo</TableHead>
              <TableHead className="text-xs">Provider</TableHead>
              <TableHead className="text-xs">Contexto</TableHead>
              <TableHead className="text-xs">In $/1M</TableHead>
              <TableHead className="text-xs">Out $/1M</TableHead>
              <TableHead className="text-xs">Calidad</TableHead>
              <TableHead className="text-xs">Latencia</TableHead>
              <TableHead className="text-xs">Capacidades</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs font-medium">{m.name}</TableCell>
                <TableCell className="text-xs">{m.provider}</TableCell>
                <TableCell className="text-xs">{(m.contextWindow / 1000).toFixed(0)}K</TableCell>
                <TableCell className="text-xs">${m.pricing.inputPer1M}</TableCell>
                <TableCell className="text-xs">${m.pricing.outputPer1M}</TableCell>
                <TableCell className="text-xs capitalize">{m.performance.quality}</TableCell>
                <TableCell className="text-xs capitalize">{m.performance.latency}</TableCell>
                <TableCell><ModelCapabilities capabilities={m.capabilities.slice(0, 3)} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
