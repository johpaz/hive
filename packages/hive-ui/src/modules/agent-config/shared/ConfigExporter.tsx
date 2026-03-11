import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface ConfigExporterProps {
  content: string;
  filename: string;
}

export function ConfigExporter({ content, filename }: ConfigExporterProps) {
  const handleExport = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" className="gap-1" onClick={handleExport}>
      <Download className="h-3.5 w-3.5" />
      Exportar
    </Button>
  );
}
