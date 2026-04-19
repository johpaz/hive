import {
  LayoutDashboard,
  Bot,
  Layers,
  Cable,
  ScrollText,
  SlidersHorizontal,
  MessageSquare,
  Brain,
  ShieldAlert,
  Wrench,
  Server,
  User,
  Wand2,
  FolderKanban,
  StickyNote,
  Clock,
  Mic,
  GraduationCap,
  BookOpen,
  Network,
  Settings2,
  History,
  type LucideProps,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { apiClient } from "@/lib/api";
import { useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

function Icon({ icon: IconComponent, ...props }: { icon: React.ComponentType<LucideProps> } & LucideProps) {
  return <IconComponent {...props} />;
}

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Web Chat", url: "/chat", icon: MessageSquare },
  { title: "Agentes", url: "/agents", icon: Bot },
  { title: "Proyectos", url: "/projects", icon: FolderKanban },
  { title: "Canales", url: "/channels", icon: MessageSquare },
  { title: "Providers", url: "/providers", icon: Brain },
  { title: "Canvas", url: "/canvas", icon: Layers },
  { title: "Bridge", url: "/bridge", icon: Cable },

];

const configGroups = [
  {
    label: "Entorno",
    items: [
      { id: "herramientas", label: "Herramientas", icon: Wrench },
      { id: "mcp", label: "MCP Servers", icon: Server },
      { id: "skills", label: "Skills", icon: Wand2 },
      { id: "etica", label: "Ética", icon: ShieldAlert },
    ],
  },
  {
    label: "Usuario",
    items: [
      { id: "perfil", label: "Perfil", icon: User },
      { id: "voz", label: "Voz", icon: Mic },
      { id: "seguridad", label: "Seguridad", icon: ShieldAlert },
    ],
  },
];

const cognitiveItems = [
  { title: "Notas", url: "/notas", icon: StickyNote },
  { title: "Cron Jobs", url: "/cron-jobs", icon: Clock },
];

const hiveLearnSubItems = [
  { id: "learn", label: "Aprender", url: "/hivelearn", icon: BookOpen },
  { id: "sessions", label: "Sesiones", url: "/hivelearn/sessions", icon: History },
  { id: "swarm", label: "Enjambre", url: "/hivelearn/swarm", icon: Network },
  { id: "config", label: "Configuración", url: "/hivelearn/config", icon: Settings2 },
];

export function AppSidebar() {
  const location = useLocation();
  const isConfigActive = location.pathname.startsWith("/settings");
  const isHiveLearnActive = location.pathname.startsWith("/hivelearn");
  const [hiveLearnEnabled, setHiveLearnEnabled] = useState(false);

  useEffect(() => {
    apiClient<{ enabled: boolean }>("/api/hivelearn/status", { showError: false })
      .then(d => setHiveLearnEnabled(d.enabled ?? false))
      .catch(() => setHiveLearnEnabled(false));
  }, []);

  return (
    <Sidebar collapsible="icon" className="hive-sidebar">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="hive-sidebar-item group/item text-white/50 hover:text-white"
                      activeClassName="hive-sidebar-item--active text-blue-400 font-bold"
                    >
                      <Icon icon={item.icon as any} className="h-4 w-4 transition-transform group-hover/item:scale-110" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* HiveLearn — solo visible si está activado */}
              {hiveLearnEnabled && <Collapsible open={isHiveLearnActive} asChild>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isHiveLearnActive}>
                    <NavLink
                      to="/hivelearn"
                      className="hive-sidebar-item group/item text-white/50 hover:text-white"
                      activeClassName="hive-sidebar-item--active text-amber-400 font-bold"
                    >
                      <Icon icon={GraduationCap as any} className="h-4 w-4 transition-transform group-hover/item:scale-110" />
                      <span>HiveLearn</span>
                      <span className="ml-auto rounded-full bg-amber-500/20 text-[9px] font-semibold text-amber-400 px-1.5 py-0.5 leading-none">
                        En construcción
                      </span>
                    </NavLink>
                  </SidebarMenuButton>

                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hiveLearnSubItems.map((item) => (
                        <SidebarMenuSubItem key={item.id}>
                          <SidebarMenuSubButton asChild>
                            <NavLink
                              to={item.url}
                              end={item.url === "/hivelearn"}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all text-xs"
                              activeClassName="text-amber-400 bg-amber-500/5 font-semibold"
                            >
                              <Icon icon={item.icon as any} className="h-3.5 w-3.5" />
                              <span>{item.label}</span>
                            </NavLink>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>}

              <div className="h-4" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white/20">
                Cognitivo
              </p>
              {cognitiveItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hive-sidebar-item group/item text-white/50 hover:text-white"
                      activeClassName="hive-sidebar-item--active text-blue-400 font-bold"
                    >
                      <Icon icon={item.icon as any} className="h-4 w-4 transition-transform group-hover/item:scale-110" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              <div className="h-4" />
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-white/20">
                Sistema
              </p>
              {/* Ajustes del sistema — expands sub-items when active */}
              <Collapsible open={isConfigActive} asChild>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isConfigActive}>
                    <NavLink
                      to="/settings/herramientas"
                      className="hive-sidebar-item group/item text-white/50 hover:text-white"
                      activeClassName="hive-sidebar-item--active text-blue-400 font-bold"
                    >
                      <Icon icon={SlidersHorizontal as any} className="h-4 w-4 transition-transform group-hover/item:scale-110" />
                      <span>Ajustes</span>
                    </NavLink>
                  </SidebarMenuButton>

                  <CollapsibleContent>
                    {configGroups.map((group) => (
                      <div key={group.label}>
                        <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                          {group.label}
                        </p>
                        <SidebarMenuSub>
                          {group.items.map((item) => (
                            <SidebarMenuSubItem key={item.id}>
                              <SidebarMenuSubButton asChild>
                                <NavLink
                                  to={`/settings/${item.id}`}
                                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all text-xs"
                                  activeClassName="text-blue-400 bg-blue-500/5 font-semibold"
                                >
                                  <Icon icon={item.icon as any} className="h-3.5 w-3.5" />
                                  <span>{item.label}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </div>
                    ))}
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
