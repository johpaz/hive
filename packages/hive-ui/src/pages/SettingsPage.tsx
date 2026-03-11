import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { EthicsTemplateGallery } from "@/modules/agent-config/ethics/EthicsTemplateGallery";
import { ToolManager } from "@/modules/agent-config/tools/ToolManager";
import { MCPServerList } from "@/modules/agent-config/mcp/MCPServerList";
import { UserProfileEditor } from "@/modules/agent-config/user/UserProfileEditor";
import { SkillsTab } from "@/modules/agent-config/skills/SkillsTab";
import { NotesPanel } from "@/components/NotesPanel";
import { CronJobsPanel } from "@/components/CronJobsPanel";
import { useSkills, useTools, useMCPServers } from "@/hooks/useProviders";

type PanelId = "etica" | "herramientas" | "mcp" | "skills" | "perfil" | "notas" | "cron-jobs";

function PanelContent({ panel }: { panel: PanelId }) {
  switch (panel) {
    case "etica":
      return (
        <div className="p-4">
          <EthicsTemplateGallery />
        </div>
      );
    case "herramientas":
      return (
        <div className="p-4">
          <ToolManager />
        </div>
      );
    case "mcp":
      return (
        <div className="p-4">
          <MCPServerList />
        </div>
      );
    case "skills":
      return (
        <div className="p-4">
          <SkillsTab />
        </div>
      );
    case "perfil":
      return (
        <div className="p-4">
          <UserProfileEditor />
        </div>
      );
    case "notas":
      return (
        <div className="p-4">
          <NotesPanel />
        </div>
      );
    case "cron-jobs":
      return (
        <div className="p-4">
          <CronJobsPanel />
        </div>
      );
    default:
      return null;
  }
}

const VALID_PANELS: PanelId[] = ["etica", "herramientas", "mcp", "skills", "perfil", "notas", "cron-jobs"];

export function SettingsPage({ forcePanel }: { forcePanel?: PanelId }) {
  const { panel } = useParams<{ panel: string }>();
  const { fetchSkills } = useSkills();
  const { fetchTools } = useTools();
  const { fetchMCPServers } = useMCPServers();

  useEffect(() => {
    fetchSkills();
    fetchTools();
    fetchMCPServers();
  }, [fetchSkills, fetchTools, fetchMCPServers]);

  const activePanel: PanelId = forcePanel || (VALID_PANELS.includes(panel as PanelId)
    ? (panel as PanelId)
    : "herramientas");

  const panelTitles: Record<PanelId, { title: string; subtitle: string; eyebrow: string }> = {
    etica: {
      eyebrow: "PROTOCOLOS DE CONDUCTA",
      title: "Ética & Alineación",
      subtitle: "Configura los límites morales y el comportamiento base de tus agentes."
    },
    herramientas: {
      eyebrow: "CAPACIDADES DINÁMICAS",
      title: "Gestión de Herramientas",
      subtitle: "Habilita y configura las funciones que tus agentes pueden ejecutar."
    },
    mcp: {
      eyebrow: "CONECTIVIDAD EXTERNA",
      title: "Servidores MCP",
      subtitle: "Conecta Hive con fuentes de datos externas y herramientas de terceros."
    },
    skills: {
      eyebrow: "HABILIDADES ESPECIALIZADAS",
      title: "Galería de Skills",
      subtitle: "Nodos cognitivos preconfigurados para tareas específicas de alto nivel."
    },
    perfil: {
      eyebrow: "IDENTIDAD DEL OPERADOR",
      title: "Perfil de Usuario",
      subtitle: "Gestiona tu información personal y preferencias de la interfaz."
    },
    notas: {
      eyebrow: "MEMORIA OPERATIVA",
      title: "Notas del Sistema",
      subtitle: "Registro de información persistente y recordatorios del enjambre."
    },
    "cron-jobs": {
      eyebrow: "AUTOMATIZACIÓN TEMPORAL",
      title: "Tareas Programadas",
      subtitle: "Gestión de ejecuciones recurrentes y disparadores cron."
    }
  };

  const { title, subtitle, eyebrow } = panelTitles[activePanel];

  return (
    <div className="hive-page-container">
      <div className="hive-page-header">
        <div className="relative z-10">
          <div className="hive-page-header__eyebrow">
            <div className="hive-page-header__dot" />
            <span className="hive-page-header__label">{eyebrow}</span>
          </div>
          <h2 className="hive-title-page">
            {title.split(' & ')[0]} {title.includes(' & ') && <span className="hive-title-page__accent">& {title.split(' & ')[1]}</span>}
            {title.includes(' ') && !title.includes(' & ') && (
              <>
                {title.split(' ')[0]} <span className="hive-title-page__accent">{title.split(' ').slice(1).join(' ')}</span>
              </>
            )}
            {!title.includes(' ') && title}
          </h2>
          <p className="hive-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="animate-fade-in">
        <PanelContent panel={activePanel} />
      </div>
    </div>
  );
}
