import {
  AudioLines,
  LayoutDashboard,
  Bot,
  Layers,
  ScrollText,
  SlidersHorizontal,
  MessageSquare,
  Brain,
  ShieldAlert,
  Wrench,
  Server,
  User,
  Wand2,
  StickyNote,
  Clock,
  Video,
  Globe,
  Hexagon,
  ArrowUpCircle,
  MonitorCog,
  type LucideProps,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useCanvasStore } from "@/stores/canvasStore";
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
  { title: "HiveLive", url: "/voz", icon: AudioLines },
  { title: "Agentes", url: "/agents", icon: Bot },
  { title: "Canales", url: "/channels", icon: MessageSquare },
  { title: "Providers", url: "/providers", icon: Brain },
  { title: "Oficina 3D", url: "/office", icon: Hexagon },
  { title: "Panel interactivo", url: "/a2ui", icon: Layers },
  { title: "Reuniones", url: "/meeting", icon: Video },
  { title: "API Client", url: "/api-client", icon: Globe },

];

export const configGroups = [
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
    ],
  },
  {
    label: "Sistema",
    items: [
      { id: "pantalla", label: "Pantalla y audio", icon: MonitorCog },
      { id: "actualizaciones", label: "Actualizaciones", icon: ArrowUpCircle },
    ],
  },
];

const cognitiveItems = [
  { title: "Notas", url: "/notas", icon: StickyNote },
  { title: "Cron Jobs", url: "/cron-jobs", icon: Clock },
];



export function AppSidebar() {
  const location = useLocation();
  const isConfigActive = location.pathname.startsWith("/settings");
  const unseenA2UICount = useCanvasStore((s) => s.unseenA2UICount);

  return (
    <Sidebar collapsible="icon" className="hive-sidebar border-r !top-12 bottom-auto !h-[calc(100svh-3rem)]">
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
                      <span className="flex-1">{item.title}</span>
                      {item.url === "/a2ui" && unseenA2UICount > 0 && (
                        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
                          {unseenA2UICount}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
