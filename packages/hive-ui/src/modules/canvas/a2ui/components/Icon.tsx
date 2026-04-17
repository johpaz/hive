import type { ComponentDef } from "@/types/a2ui";
import type { RenderCtx } from "../A2UIRenderer";
import { resolveDynamicString } from "../dataBinding";
import {
  Settings, Home, Search, Mail, Phone, Camera, Calendar, Star,
  Check, X, Trash2, Download, Upload, Pencil, RefreshCw, Send,
  Share2, ShoppingCart, AlertTriangle, Info, CircleAlert, Heart,
  Folder, HelpCircle, Lock, Unlock, Eye, EyeOff, Plus,
  ArrowLeft, ArrowRight, User, Bell, MoreVertical,
  MoreHorizontal, MapPin, CreditCard, Image, Printer,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  settings: Settings,
  home: Home,
  search: Search,
  mail: Mail,
  call: Phone,
  camera: Camera,
  calendarToday: Calendar,
  star: Star,
  check: Check,
  close: X,
  delete: Trash2,
  download: Download,
  upload: Upload,
  edit: Pencil,
  refresh: RefreshCw,
  send: Send,
  share: Share2,
  shoppingCart: ShoppingCart,
  warning: AlertTriangle,
  info: Info,
  error: CircleAlert,
  favorite: Heart,
  favoriteOff: Heart,
  folder: Folder,
  help: HelpCircle,
  lock: Lock,
  lockOpen: Unlock,
  visibility: Eye,
  visibilityOff: EyeOff,
  add: Plus,
  arrowBack: ArrowLeft,
  arrowForward: ArrowRight,
  accountCircle: User,
  notifications: Bell,
  moreVert: MoreVertical,
  moreHoriz: MoreHorizontal,
  locationOn: MapPin,
  payment: CreditCard,
  photo: Image,
  print: Printer,
  person: User,
};

export function A2UIIcon({ def, ctx }: { def: ComponentDef; ctx: RenderCtx }) {
  const iconName = resolveDynamicString(def.name, ctx.dataModel, ctx.scopeData);
  const IconComponent = ICON_MAP[iconName] ?? HelpCircle;

  return (
    <IconComponent
      className="text-white/70"
      style={def.weight ? { flex: def.weight } : undefined}
    />
  );
}