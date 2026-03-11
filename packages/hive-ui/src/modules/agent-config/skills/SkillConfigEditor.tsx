import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

interface SkillConfigEditorProps {
  skillId: string;
}

export function SkillConfigEditor({ skillId }: SkillConfigEditorProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings className="h-4 w-4" />
          Configurar skill
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">Configuración de skill: {skillId}</p>
      </CardContent>
    </Card>
  );
}
