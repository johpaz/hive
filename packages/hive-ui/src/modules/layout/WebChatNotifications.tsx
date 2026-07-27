import { useEffect } from "react";
import { Bell } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useWebSocket } from "@/hooks/useWebSocket";

interface WebChatNotification {
  type: "notification";
  notificationId?: string;
  content?: string;
}

export function WebChatNotifications() {
  const { send, subscribe } = useWebSocket();

  useEffect(() => subscribe("notification", (data: WebChatNotification) => {
    if (!data.notificationId || document.visibilityState !== "visible") return;
    toast(data.content || "Nueva notificación", {
      id: data.notificationId,
      icon: <Bell className="h-4 w-4" />,
      duration: 8000,
    });
    send({
      type: "notification_ack",
      notificationId: data.notificationId,
    });
  }), [send, subscribe]);

  return null;
}
