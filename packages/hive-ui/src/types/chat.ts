export type MessageType = "user" | "agent" | "system" | "error";

export interface Message {
  id: string;
  conversationId: string;
  type: MessageType;
  content: string;
  agentId?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
  audio?: {
    base64?: string;
    url?: string;
    mimeType?: string;
  };
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}
