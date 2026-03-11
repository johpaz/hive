import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Zap } from "lucide-react";
import { apiClient } from "@/lib/api";
import type { Skill } from "@/types";

export function SkillList() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    apiClient<{ skills: Skill[] }>("/api/skills").then((res) => {
      setSkills(res.skills);
    }).catch(() => {});
  }, []);

  async function handleToggle(skill: Skill) {
    setToggling(skill.id);
    const newActive = !skill.active;
    try {
      await apiClient(`/api/skills/${skill.id}/toggle`, {
        method: "POST",
        body: { active: newActive },
      });
      setSkills((prev) =>
        prev.map((s) => s.id === skill.id ? { ...s, active: newActive } : s)
      );
    } catch {
      // revert on error — state unchanged
    } finally {
      setToggling(null);
    }
  }

  const activeCount = skills.filter((s) => s.active).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Skills disponibles</h4>
        <Badge variant="secondary" className="text-xs">{activeCount} activos</Badge>
      </div>
      <div className="space-y-2">
        {skills.map((skill) => (
          <Card key={skill.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3 pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Zap className="h-3.5 w-3.5 text-green-400" />
                {skill.name}
              </CardTitle>
              <Switch
                checked={!!skill.active}
                disabled={toggling === skill.id}
                onCheckedChange={() => handleToggle(skill)}
              />
            </CardHeader>
            <CardContent className="pb-3">
              <p className="text-xs text-muted-foreground">
                {skill.category} • {skill.tools ? skill.tools.split(',').length : 0} tools
              </p>
            </CardContent>
          </Card>
        ))}
        {skills.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No hay skills cargadas</p>
        )}
      </div>
    </div>
  );
}
