import { ChatContainer } from "@/modules/chat/ChatContainer";
import { useUserStore } from "@/stores/userStore";

export function WebChatPage() {
  const { currentUser } = useUserStore();
  const activeSession = currentUser?.id || "default";

  return (
    <div className="h-full bg-zinc-950 overflow-hidden mt-10">
      <div className="max-w-4xl mx-auto h-full flex flex-col border-x border-white/5">
        <ChatContainer agentId="main" sessionId={activeSession} />
      </div>
    </div>
  );
}
