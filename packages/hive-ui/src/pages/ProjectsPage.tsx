import { useEffect, useState } from "react";
import { useProjectsStore, type Project, type Task } from "@/stores/projectsStore";
import { RefreshCw, ChevronDown, ChevronRight, FolderOpen, CheckCircle2, Circle, Loader2, XCircle, MinusCircle, type LucideProps } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

const PROJECT_TYPE_LABELS: Record<string, string> = {
  code: "Código",
  research: "Investigación",
  content: "Contenido",
  data: "Datos",
  general: "General",
};

const PROJECT_TYPE_COLORS: Record<string, string> = {
  code: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  research: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  content: "bg-green-500/10 text-green-400 border-green-500/20",
  data: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  general: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-400 border-green-500/20",
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  paused: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  done: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activo",
  pending: "Pendiente",
  paused: "Pausado",
  done: "Completado",
  failed: "Fallido",
  in_progress: "En progreso",
  completed: "Completada",
  blocked: "Bloqueada",
};

function TaskStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed": return <Icon icon={CheckCircle2} className="h-3.5 w-3.5 text-green-400" />;
    case "in_progress": return <Icon icon={Loader2} className="h-3.5 w-3.5 text-yellow-400 animate-spin" />;
    case "failed": return <Icon icon={XCircle} className="h-3.5 w-3.5 text-red-400" />;
    case "blocked": return <Icon icon={MinusCircle} className="h-3.5 w-3.5 text-orange-400" />;
    default: return <Icon icon={Circle} className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function TaskRow({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-3 py-1.5 px-3 rounded-md hover:bg-white/5 transition-colors group">
      <TaskStatusIcon status={task.status} />
      <span className="text-sm flex-1 text-white/40 group-hover:text-white/80 transition-colors">
        {task.name}
      </span>
      {task.description && (
        <span className="text-xs text-white/20 hidden sm:block max-w-[200px] truncate">
          {task.description}
        </span>
      )}
      <div className="flex items-center gap-2 ml-auto">
        {task.status === "in_progress" && (
          <div className="w-16">
            <Progress value={task.progress} className="h-1" />
          </div>
        )}
        <span className="text-[11px] text-white/30 w-8 text-right">
          {task.progress}%
        </span>
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const [expanded, setExpanded] = useState(project.status === "active" || project.status === "pending");
  return (
    <div className="hive-card group overflow-hidden mt-10">
      {/* Project header */}
      <button
        className="w-full flex items-center gap-3 p-4 hover:bg-white/5 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon
          icon={expanded ? ChevronDown : ChevronRight}
          className="h-4 w-4 text-white/30 shrink-0"
        />
        <Icon icon={FolderOpen} className="h-4 w-4 text-blue-400 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-white">{project.name}</span>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${PROJECT_TYPE_COLORS[project.type] ?? PROJECT_TYPE_COLORS.general}`}
            >
              {PROJECT_TYPE_LABELS[project.type] ?? project.type}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${STATUS_COLORS[project.status] ?? ""}`}
            >
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
          </div>
          {project.description && (
            <p className="hive-subtitle !mt-0.5 truncate">{project.description}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-20">
              <Progress value={project.progress} className="h-1.5" />
            </div>
            <span className="text-xs text-white/30 w-8 text-right">{project.progress}%</span>
          </div>
          {(project.tasks ?? []).length > 0 && (
            <span className="text-xs text-white/30">
              {(project.tasks ?? []).filter((t) => t.status === "completed").length}/{(project.tasks ?? []).length}
            </span>
          )}
        </div>
      </button>

      {/* Tasks list */}
      {expanded && (project.tasks ?? []).length > 0 && (
        <div className="border-t border-white/5 px-2 py-2">
          {(project.tasks ?? []).map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}

      {expanded && (project.tasks ?? []).length === 0 && (
        <div className="border-t border-white/5 px-4 py-3 text-xs text-white/20">
          Sin tareas registradas
        </div>
      )}
    </div>
  );
}

type FilterTab = "active" | "all" | "done";

export function ProjectsPage() {
  const { projects, isLoading, fetchProjects, fetchActiveProjects } = useProjectsStore();
  const [filter, setFilter] = useState<FilterTab>("active");

  const load = () => {
    if (filter === "active") fetchActiveProjects();
    else if (filter === "done") fetchProjects("done");
    else fetchProjects();
  };

  useEffect(() => {
    load();
  }, [filter]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "active", label: "Activos" },
    { key: "all", label: "Todos" },
    { key: "done", label: "Completados" },
  ];

  return (
    <div className="hive-page">
      <div className="hive-page-container">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="hive-page-header__dot" />
              <span className="hive-page-header__label">GESTIÓN</span>
            </div>
            <h1 className="hive-title-page">
              Proyectos<span className="hive-title-page__accent">.</span>
            </h1>
            <p className="hive-subtitle">
              Seguimiento de tareas y proyectos activos del agente
            </p>
          </div>
          <button
            className="hive-btn hive-btn--primary"
            onClick={load}
            disabled={isLoading}
          >
            <Icon icon={RefreshCw} className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-6 bg-white/[0.02] rounded-xl p-1 border border-white/5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all duration-300 ${filter === tab.key
                ? 'bg-blue-600 text-white shadow-btn-primary'
                : 'text-white/20 hover:text-white/40 hover:bg-white/5'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="mt-6 space-y-3">
          {isLoading ? (
            <div className="hive-empty-state">
              <Icon icon={Loader2} className="h-5 w-5 animate-spin mr-2" />
              Cargando proyectos...
            </div>
          ) : projects.length === 0 ? (
            <div className="hive-empty-state">
              <Icon icon={FolderOpen} className="h-10 w-10 opacity-30 mb-3" />
              <p className="text-sm text-white/30">No hay proyectos {filter === "active" ? "activos" : ""}</p>
              <p className="text-xs text-white/15 mt-1">
                El agente creará proyectos automáticamente cuando reciba tareas complejas
              </p>
            </div>
          ) : (
            projects.filter(Boolean).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
