import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

interface SkillCreatorProps {
  onCreateSkill: (data: { name: string; category: string; tools: string; triggers: string; body: string }) => void;
}

export function SkillCreator({ onCreateSkill }: SkillCreatorProps) {
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onCreateSkill({
      name: formData.get("name") as string,
      category: formData.get("category") as string || "",
      tools: formData.get("tools") as string || "",
      triggers: formData.get("triggers") as string || "",
      body: formData.get("body") as string || "",
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" />
          Crear skill
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nombre</Label>
            <Input name="name" placeholder="Nombre del skill" className="h-8 text-sm" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Categoría</Label>
            <Input name="category" placeholder="Ej: web, code, data" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tools (comma-separated)</Label>
            <Input name="tools" placeholder="web_search,web_fetch" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Triggers (comma-separated)</Label>
            <Input name="triggers" placeholder="busca,investiga,research" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Contenido (Markdown)</Label>
            <Textarea name="body" placeholder="Contenido/instrucciones del skill" className="min-h-[100px] text-sm" />
          </div>
          <Button type="submit" size="sm">Crear</Button>
        </form>
      </CardContent>
    </Card>
  );
}
