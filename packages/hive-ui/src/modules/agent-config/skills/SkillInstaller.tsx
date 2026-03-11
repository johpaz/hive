import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function SkillInstaller() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Download className="h-4 w-4" />
          Instalar skill
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Instala skills desde el marketplace o archivo local</p>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm">Marketplace</Button>
          <Button variant="outline" size="sm">Archivo local</Button>
        </div>
      </CardContent>
    </Card>
  );
}
