import { ChatContainer } from "@/modules/chat/ChatContainer";
import { useUserStore } from "@/stores/userStore";

export function WebChatPage() {
  const { currentUser } = useUserStore();
  const activeSession = currentUser?.id || "default";

  return (
    <div className="h-full bg-zinc-950 overflow-hidden">
      <ChatContainer agentId="main" sessionId={activeSession} />
    </div>
  );
}