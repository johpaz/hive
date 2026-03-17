export type CanvasComponentType = 
  | "alert"
  | "alert-dialog"
  | "accordion"
  | "avatar"
  | "badge"
  | "breadcrumb"
  | "button"
  | "calendar"
  | "card"
  | "carousel"
  | "chart"
  | "checkbox"
  | "collapsible"
  | "command"
  | "context-menu"
  | "dialog"
  | "drawer"
  | "dropdown-menu"
  | "form"
  | "input"
  | "input-otp"
  | "label"
  | "markdown"
  | "menubar"
  | "navigation-menu"
  | "pagination"
  | "popover"
  | "progress"
  | "radio-group"
  | "resizable"
  | "scroll-area"
  | "select"
  | "separator"
  | "sheet"
  | "sidebar"
  | "skeleton"
  | "slider"
  | "sonner"
  | "switch"
  | "table"
  | "tabs"
  | "textarea"
  | "toast"
  | "toaster"
  | "toggle"
  | "toggle-group"
  | "tooltip"
  | "aspect-ratio"
  | "hover-card"
  | "bee-loader"
  | "custom";

export interface CanvasComponent {
  id: string;
  type: CanvasComponentType;
  props: Record<string, unknown>;
  position: { x: number; y: number };
  size: { width: number; height: number };
  agentId: string;
}

export interface CanvasEvent {
  id: string;
  sessionId: string;
  type: "add" | "remove" | "update" | "interact";
  componentId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface InteractionEvent {
  componentId: string;
  action: string;
  data: Record<string, unknown>;
  timestamp: string;
}
