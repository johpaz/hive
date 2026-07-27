/**
 * A2UI Protocol v0.9 - TypeScript Types
 * Based on: https://github.com/google/A2UI/specification/v0_9
 */

export type ComponentId = string;

// ─── Dynamic Values (Data Binding) ─────────────────────────────────────────

export type DynamicString = string | { path: string } | { call: string; args: Record<string, unknown> };
export type DynamicNumber = number | { path: string } | { call: string; args: Record<string, unknown> };
export type DynamicBoolean = boolean | { path: string } | { call: string; args: Record<string, unknown> };
export type DynamicStringList = string[] | { path: string } | { call: string; args: Record<string, unknown> };

// ─── Child Lists ────────────────────────────────────────────────────────────

export interface ChildListExplicit {
  explicitList: ComponentId[];       // A2UI v0.9 spec oficial
}

export interface ChildListArray {
  array: ComponentId[];              // formato legacy/custom
}

export interface ChildListTemplate {
  template: {                        // A2UI v0.9 spec oficial
    dataBinding: string;
    componentId: ComponentId;
  };
}

export interface ChildListTemplateLegacy {
  path: string;                      // formato legacy/custom
  componentId: ComponentId;
}

export type ChildList =
  | ChildListExplicit
  | ChildListArray
  | ChildListTemplate
  | ChildListTemplateLegacy
  | string;

// ─── Actions ────────────────────────────────────────────────────────────────

export interface ActionEvent {
  name: string;
  context?: Record<string, unknown>;
}

export interface FunctionCall {
  call: string;
  args: Record<string, unknown>;
}

export interface ActionDef {
  event?: ActionEvent;
  functionCall?: FunctionCall;
}

// ─── Validation Checks ──────────────────────────────────────────────────────

export interface CheckDef {
  call: string;
  args: Record<string, unknown>;
  message?: string;
  condition?: FunctionCall;
}

// ─── Components ──────────────────────────────────────────────────────────────

export interface ComponentDef {
  id: ComponentId;
  component: string;
  weight?: number;

  children?: ChildList;
  child?: ComponentId;

  text?: DynamicString;
  usageHint?: string;
  variant?: string;

  url?: DynamicString;
  fit?: string;
  alt?: string;

  name?: DynamicString;

  label?: DynamicString;
  value?: unknown;
  placeholder?: DynamicString;
  textFieldType?: string;
  checks?: CheckDef[];

  options?: Array<{ label: DynamicString; value?: string }>;
  maxAllowedSelections?: number;
  selections?: unknown;

  minValue?: number;
  maxValue?: number;
  step?: number;

  distribution?: string;
  alignment?: string;

  axis?: string;
  direction?: string;
  primary?: boolean;
  disabled?: boolean;

  action?: ActionDef;

  tabItems?: Array<{ title: DynamicString; child: ComponentId }>;
  entryPointChild?: ComponentId;
  contentChild?: ComponentId;

  // Aliases/Extensions
  trigger?: ComponentId;
  content?: ComponentId;

  src?: DynamicString;
  width?: number;
  height?: number;

  enableDate?: boolean;
  enableTime?: boolean;

  [key: string]: unknown;
}

// ─── Protocol Messages (Server → Client) ───────────────────────────────────

export interface CreateSurfaceMessage {
  version: "v0.9";
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: {
      primaryColor?: string;
      iconUrl?: string;
      agentDisplayName?: string;
      [key: string]: unknown;
    };
    sendDataModel?: boolean;
  };
}

export interface UpdateComponentsMessage {
  version: "v0.9";
  updateComponents: {
    surfaceId: string;
    components: ComponentDef[];
  };
}

export interface UpdateDataModelMessage {
  version: "v0.9";
  updateDataModel: {
    surfaceId: string;
    path?: string;
    value?: unknown;
  };
}

export interface DeleteSurfaceMessage {
  version: "v0.9";
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIServerMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage;

// ─── Protocol Messages (Client → Server) ─────────────────────────────────────

export interface A2UIActionMessage {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export interface A2UIErrorMessage {
  code: string;
  surfaceId: string;
  path: string;
  message: string;
}

// ─── Surface State ──────────────────────────────────────────────────────────

export interface A2UISurface {
  surfaceId: string;
  catalogId: string;
  theme?: CreateSurfaceMessage["createSurface"]["theme"];
  sendDataModel?: boolean;
  rootId?: ComponentId;
  components: ComponentDef[];
  dataModel: Record<string, unknown>;
  componentOrder: ComponentDef[];
}

// ─── Icon Catalog ────────────────────────────────────────────────────────────

const A2UI_ICONS = [
  "accountCircle", "add", "arrowBack", "arrowForward", "attachFile",
  "calendarToday", "call", "camera", "check", "close", "delete",
  "download", "edit", "event", "error", "favorite", "favoriteOff",
  "folder", "help", "home", "info", "locationOn", "lock", "lockOpen",
  "mail", "menu", "moreVert", "moreHoriz", "notificationsOff",
  "notifications", "payment", "person", "phone", "photo", "print",
  "refresh", "search", "send", "settings", "share", "shoppingCart",
  "star", "starHalf", "starOff", "upload", "visibility", "visibilityOff",
  "warning",
] as const;

export type A2UIIconName = typeof A2UI_ICONS[number];

// ─── Theme ──────────────────────────────────────────────────────────────────

export interface A2UITheme {
  primaryColor?: string;
  iconUrl?: string;
  agentDisplayName?: string;
}