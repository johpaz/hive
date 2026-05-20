import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Shield,
  Loader2,
  Search,
  Terminal,
  FolderOpen,
  Globe,
  Brain,
  Calendar,
  Bell,
  Laptop,
  Shrink,
  Eye,
  Pencil,
  FileEdit,
  UserPlus,
  FileText,
  FileUp,
  Edit3,
  MessageSquare,
  PlayCircle,
  Settings2,
  CheckCircle2
} from "lucide-react";
import { useTools } from "@/hooks/useProviders";
import { Toast } from "@/lib/swal";
import { loader } from "@/stores/useLoaderStore";

const TOOL_ICONS: Record<string, any> = {
  web_search: Search,
  shell: Terminal,
  file_manager: FolderOpen,
  http_client: Globe,
  memory: Brain,
  cron_manager: Calendar,
  system_notify: Bell,
  browser_automation: Laptop,
  context_compact: Shrink,
  workspace_read: Eye,
  workspace_write: Pencil,
  workspace_patch: FileEdit,
  create_agent: UserPlus,
  read: FileText,
  write: FileUp,
  edit: Edit3,
  notify: MessageSquare,
  exec: PlayCircle,
};

const CATEGORY_LABELS: Record<string, string> = {
  bundled: "Nativas",
  workspace: "Workspace",
  builtin: "Sistema",
};

export function ToolPermissions() {
  const { tools, isLoading, fetchTools, toggleTool, updateTool } = useTools();
  const [editingTool, setEditingTool] = useState<any>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleToggle = async (id: string, active: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (togglingId) return;
    setTogglingId(id);
    try {
      await toggleTool(id, active);
      Toast.fire({ icon: "success", title: `Herramienta ${active ? "activada" : "desactivada"}` });
    } catch (error) {
      Toast.fire({ icon: "error", title: "Error al actualizar estado de la herramienta" });
    } finally {
      setTogglingId(null);
    }
  };

  const handleOpenEdit = (tool: any) => {
    setEditingTool({ ...tool });
  };

  const handleSave = async () => {
    if (!editingTool) return;
    setIsSaving(true);
    loader.show("Guardando configuración de herramienta...");
    try {
      await updateTool(editingTool.id, {
        name: editingTool.name,
        description: editingTool.description,
      });
      Toast.fire({ icon: "success", title: "Configuración guardada" });
      fetchTools();
      setEditingTool(null);
    } catch (error) {
      Toast.fire({ icon: "error", title: "Error al guardar cambios" });
    } finally {
      setIsSaving(false);
      loader.hide();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  const categories = ["bundled", "workspace", "builtin"];
  const toolsByCategory = categories.reduce((acc, cat) => {
    acc[cat] = tools.filter(t => t.category === cat);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <Shield className="h-5 w-5 text-purple-400" />
          Permisos y Herramientas
        </h3>
        <p className="text-sm text-zinc-400">
          Configura el acceso y las capacidades de las herramientas del agente.
        </p>
      </div>

      <Tabs defaultValue="bundled" className="w-full">
        <TabsList className="bg-zinc-900/50 border border-white/5 p-1 h-auto flex-wrap sm:flex-nowrap">
          {categories.map(cat => (
            <TabsTrigger
              key={cat}
              value={cat}
              className="data-[state=active]:bg-purple-500 data-[state=active]:text-white transition-all py-2 px-4"
            >
              {CATEGORY_LABELS[cat] || cat}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map(cat => (
          <TabsContent key={cat} value={cat} className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {toolsByCategory[cat]?.map((tool) => {
                const Icon = TOOL_ICONS[tool.id] || Settings2;
                return (
                  <Card
                    key={tool.id}
                    onClick={() => handleOpenEdit(tool)}
                    className={`group relative overflow-hidden transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/5 cursor-pointer ${tool.active ? "border-purple-500/20 bg-purple-500/[0.02]" : "opacity-70 grayscale-[0.2] border-white/5 bg-transparent"
                      }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className={`p-2 rounded-lg transition-colors ${tool.active ? "bg-purple-500/10 text-purple-400" : "bg-zinc-800 text-zinc-500"}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <Switch
                          checked={tool.active}
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          onCheckedChange={(checked) => handleToggle(tool.id, checked, { stopPropagation: () => { } } as any)}
                          disabled={togglingId === tool.id}
                          className="data-[state=checked]:bg-purple-500"
                        />
                      </div>
                      <CardTitle className="text-sm font-bold mt-3 group-hover:text-purple-400 transition-colors">
                        {tool.name}
                      </CardTitle>
                      <CardDescription className="text-xs line-clamp-2 mt-1">
                        {tool.description}
                      </CardDescription>
                    </CardHeader>
                    {tool.active && (
                      <div className="absolute top-2 right-12">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                          <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[10px] font-medium text-emerald-500 uppercase tracking-wider">Conectado</span>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
            {(!toolsByCategory[cat] || toolsByCategory[cat].length === 0) && (
              <div className="py-12 text-center border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                <p className="text-sm text-zinc-500">No hay herramientas disponibles en esta categoría.</p>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!editingTool} onOpenChange={(open) => !open && setEditingTool(null)}>
        <DialogContent className="sm:max-w-[425px] border-purple-500/20 bg-zinc-950/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              {editingTool && (
                <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-400">
                  {(() => {
                    const Icon = TOOL_ICONS[editingTool.id] || Settings2;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </div>
              )}
              Configurar Herramienta
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Ajusta los detalles y accesos de <span className="font-mono text-purple-400">{editingTool?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tool-name" className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Nombre Público</Label>
              <Input
                id="tool-name"
                value={editingTool?.name || ""}
                onChange={(e) => setEditingTool({ ...editingTool, name: e.target.value })}
                className="bg-white/5 border-white/10 focus:border-purple-500/50 transition-all"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tool-desc" className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Descripción</Label>
              <Textarea
                id="tool-desc"
                value={editingTool?.description || ""}
                onChange={(e) => setEditingTool({ ...editingTool, description: e.target.value })}
                className="bg-white/5 border-white/10 focus:border-purple-500/50 transition-all min-h-[100px]"
              />
            </div>

            <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              <div className="text-xs text-emerald-200/70">
                Esta herramienta se conectará automáticamente al agente cuando esté activa.
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditingTool(null)}
              className="hover:bg-white/5 text-zinc-400"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
