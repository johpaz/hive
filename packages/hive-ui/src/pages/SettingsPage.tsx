import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { EthicsTemplateGallery } from "@/modules/agent-config/ethics/EthicsTemplateGallery";
import { ToolManager } from "@/modules/agent-config/tools/ToolManager";
import { MCPServerList } from "@/modules/agent-config/mcp/MCPServerList";
import { UserProfileEditor } from "@/modules/agent-config/user/UserProfileEditor";
import { SkillsTab } from "@/modules/agent-config/skills/SkillsTab";
import { NotesPanel } from "@/components/NotesPanel";
import { CronJobsPanel } from "@/components/CronJobsPanel";
import { DesktopUpdateCard } from "@/components/DesktopUpdateCard";
import { PantallaAudioCard } from "@/components/PantallaAudioCard";
import { useSkills, useTools, useMCPServers } from "@/hooks/useProviders";
import { splitPanelTitle } from "./settingsTitle";

export type PanelId = "etica" | "herramientas" | "mcp" | "skills" | "perfil" | "notas" | "cron-jobs" | "actualizaciones" | "pantalla";

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
    case "actualizaciones":
      return (
        <div className="p-4">
          <DesktopUpdateCard />
        </div>
      );
    case "pantalla":
      return (
        <div className="p-4">
          <PantallaAudioCard />
        </div>
      );
  default:
      return null;
  }
}

// Esta lista decide si la URL es válida: un panel que falte acá cae en
// "herramientas" y el ítem del menú parece no hacer nada.
export const VALID_PANELS: PanelId[] = ["etica", "herramientas", "mcp", "skills", "perfil", "notas", "cron-jobs", "actualizaciones", "pantalla"];

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

  const requestedPanel = panel === "seguridad" ? "perfil" : panel;
  const activePanel: PanelId = forcePanel || (VALID_PANELS.includes(requestedPanel as PanelId)
    ? (requestedPanel as PanelId)
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
    },
    actualizaciones: {
      eyebrow: "MANTENIMIENTO",
      title: "Actualizaciones",
      subtitle: "Consulta tu versión, busca una nueva e instálala sin salir de la app."
    },
    pantalla: {
      eyebrow: "APARIENCIA Y SONIDO",
      title: "Pantalla & Audio",
      subtitle: "Ajusta el tamaño de la vista y elige por dónde se oye la voz en vivo."
    }
};

  const { title, subtitle, eyebrow } = panelTitles[activePanel];
  const titleParts = splitPanelTitle(title);

  return (
    <div className="hive-page-container">
      <div className="hive-page-header">
        <div className="relative z-10">
          <div className="hive-page-header__eyebrow">
            <div className="hive-page-header__dot" />
            <span className="hive-page-header__label">{eyebrow}</span>
          </div>
          <h2 className="hive-title-page">
            {titleParts.lead}
            {titleParts.accent && <> <span className="hive-title-page__accent">{titleParts.accent}</span></>}
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
