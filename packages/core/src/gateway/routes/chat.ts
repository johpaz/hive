/**
 * Chat API - Endpoint para enviar mensajes al coordinador
 * 
 * POST /api/chat
 * {
 *   "message": "Mensaje para el coordinador",
 *   "thread_id": "conversations.thread_id (opcional, usa el thread canónico del usuario si no existe)",
 *   "channel": "canal (opcional, default: webchat)"
 * }
 */

import { resolveUserId, resolveAgentId } from "../../storage/onboarding";
import { enqueueChatTurn } from "../webchat-turn";
import { getJob } from "../job-store";
import { getDefaultLLM } from "../../agent/llm-client";
import { logger } from "../../utils/logger";
import { saveScratchpadNote, listAllScratchpadNotes, isInternalSource } from "../../agent/conversation-store";
import { col, fromIndexable } from "../../storage/hive";
import type { UserDoc, AgentDoc, ConversationDoc } from "../../storage/collections";

const log = logger.child("api:chat");
export const DEFAULT_CHAT_HISTORY_LIMIT = 40;

export interface ChatRequest {
  message: string;
  thread_id?: string;
  channel?: string;
  userId?: string;
  agentId?: string;
}

export interface ChatResponse {
  success: boolean;
  thread_id: string;
  content?: string;
  error?: string;
}

export function resolveChatThreadId(finalUserId: string, requestedThreadId?: string): string {
  const trimmedThreadId = requestedThreadId?.trim();
  return trimmedThreadId || finalUserId || "default";
}

export async function handleChat(
  req: Request,
  addCorsHeaders: (res: Response, req: Request) => Response
): Promise<Response> {
  try {
    const body = await req.json();
    const { message, thread_id, channel = "webchat", userId, agentId }: ChatRequest = body;

    if (!message) {
      return addCorsHeaders(
        Response.json({ 
          success: false, 
          error: "Message is required" 
        }, { status: 400 }),
        req
      );
    }

    // Resolve user ID
    const finalUserId = userId || (await resolveUserId({ channel })) || "default";

    // Resolve agent ID (coordinator by default)
    const finalAgentId = agentId || (await resolveAgentId(null)) || "main";

    // conversations.thread_id is the context key; never generate a per-request thread.
    const threadId = resolveChatThreadId(finalUserId, thread_id);

    log.info(`[chat] Processing message from user=${finalUserId} agent=${finalAgentId} thread=${threadId}`);

    // Get user timezone for timestamp
    const usersCol = await col<UserDoc>("users");
    const userRow = await usersCol.get(finalUserId);
    const userTimezone = userRow?.doc.timezone || "UTC";
    const now = new Date();
    
    let exactTime: string;
    try {
      exactTime = now.toLocaleString("en-US", {
        timeZone: userTimezone,
        dateStyle: "full",
        timeStyle: "long",
      });
    } catch (e) {
      exactTime = now.toISOString();
    }

    // Format message with timestamp
    const messageContent = `[Timestamp: ${exactTime} (${userTimezone})]\n${message}`;

    // AgentLoop persists this user message, then compileContext loads the last
    // 15 messages from conversations by threadId. Prepending history here is
    // ineffective because AgentLoop.stream only consumes the latest user input.
    const messages = [{ role: "user" as const, content: messageContent }];

    // Get provider config from DB
    const agentsCol = await col<AgentDoc>("agents");
    const agent = await agentsCol.get(finalAgentId);

    const provider = fromIndexable(agent?.doc.provider_id ?? null) || (await getDefaultLLM())?.provider;
    if (!provider) {
      return addCorsHeaders(Response.json(
        { error: "No active LLM providers configured" },
        { status: 503 }
      ), req);
    }

    // Enqueue a durable chat_turn job: it survives a crash and re-executes,
    // delivering through the webchat channel if this HTTP client is gone.
    const job = await enqueueChatTurn({
      lane: threadId,
      payload: {
        source: "api",
        sessionId: threadId,
        content: messageContent,
        rawContent: message,
        userId: finalUserId,
        agentId: finalAgentId,
        channel,
      },
    });

    log.info(`[chat] Enqueued chat_turn job ${job.id} for thread ${threadId}`);

    // Wait for the job to complete (with timeout)
    const startTime = Date.now();
    const timeout = 120000; // 2 minutes timeout

    for (;;) {
      const current = await getJob(job.id);

      if (current?.status === "completed") {
        let responseContent = "";
        try {
          responseContent = current.result_json ? String(JSON.parse(current.result_json) ?? "") : "";
        } catch {
          responseContent = current.result_json ?? "";
        }
        return addCorsHeaders(
          Response.json({
            success: true,
            thread_id: threadId,
            content: responseContent || "Task completed.",
          }),
          req
        );
      }

      if (current && (current.status === "failed" || current.status === "cancelled" || current.status === "interrupted")) {
        return addCorsHeaders(
          Response.json({
            success: false,
            error: current.error || `Job ${current.status}`,
            thread_id: threadId,
          }, { status: 500 }),
          req
        );
      }

      if (Date.now() - startTime > timeout) {
        return addCorsHeaders(
          Response.json({
            success: false,
            error: "Request timeout",
            thread_id: threadId,
          }, { status: 504 }),
          req
        );
      }

      await new Promise(resolve => setTimeout(resolve, 150));
    }

  } catch (error) {
    log.error(`[chat] Handler error: ${(error as Error).message}`);
    return addCorsHeaders(
      Response.json({
        success: false,
        error: (error as Error).message,
        message: "Internal server error",
      }, { status: 500 }),
      req
    );
  }
}

// ── Original Chat API Functions ─────────────────────────────────────────────

export async function handleGetChatHistory(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const threadId = url.searchParams.get("sessionId") || url.searchParams.get("threadId") || "default"
  const limit = parseInt(url.searchParams.get("limit") || String(DEFAULT_CHAT_HISTORY_LIMIT))

  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = (await conversationsCol.scan({ prefix: `${threadId}:`, reverse: true }))
    // Legacy internal turns still carry role:"system" and are excluded by the
    // role allowlist; current ones persist as role:"user" + an internal
    // `source` and are excluded by isInternalSource instead.
    .filter(e => (e.doc.role === "user" || e.doc.role === "assistant") && !isInternalSource(e.doc.source))
    .slice(0, limit)

  const messages = entries.map(e => ({
    id: parseInt(e.id.slice(e.id.lastIndexOf(":") + 1), 10),
    thread_id: e.doc.thread_id,
    channel: e.doc.channel,
    role: e.doc.role,
    source: e.doc.source,
    content: e.doc.content,
    tool_calls_json: e.doc.tool_calls_json,
    tool_call_id: e.doc.tool_call_id,
    reasoning_content: e.doc.reasoning_content,
    token_count: e.doc.token_count,
    created_at: e.doc.created_at,
    updated_at: e.doc.updated_at,
  })).reverse()

  return addCorsHeaders(Response.json({ messages }), req)
}

export async function handleGetNotes(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const notes = await listAllScratchpadNotes(50)
  return addCorsHeaders(Response.json({ notes }), req)
}

export async function handleUpdateNote(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { threadId, content } = body

  if (!threadId || !content) {
    return addCorsHeaders(Response.json({ success: false, error: "threadId and content required" }), req)
  }

  await saveScratchpadNote(threadId, "note", content)

  return addCorsHeaders(Response.json({ success: true }), req)
}
