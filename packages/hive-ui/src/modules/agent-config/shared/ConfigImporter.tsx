import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface ConfigImporterProps {
  onImport: (content: string) => void;
  accept?: string;
}

export function ConfigImporter({ onImport, accept = ".md,.json,.yaml" }: ConfigImporterProps) {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImport(reader.result as string);
    reader.readAsText(file);
  };

  return (
    <Button variant="outline" size="sm" className="relative gap-1">
      <Upload className="h-3.5 w-3.5" />
      Importar
      <input type="file" accept={accept} onChange={handleFile} className="absolute inset-0 cursor-pointer opacity-0" />
    </Button>
  );
}
