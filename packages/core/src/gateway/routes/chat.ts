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

import { getDb } from "../../storage/sqlite";
import { resolveUserId, resolveAgentId } from "../../storage/onboarding";
import { laneQueue } from "../lane-queue";
import { AgentRunner } from "../../agent/providers";
import { logger } from "../../utils/logger";

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

    const db = getDb();

    // Resolve user ID
    const finalUserId = userId || resolveUserId({ channel }) || "default";
    
    // Resolve agent ID (coordinator by default)
    const finalAgentId = agentId || resolveAgentId(null) || "main";

    // conversations.thread_id is the context key; never generate a per-request thread.
    const threadId = resolveChatThreadId(finalUserId, thread_id);

    log.info(`[chat] Processing message from user=${finalUserId} agent=${finalAgentId} thread=${threadId}`);

    // Get user timezone for timestamp
    const userRow = db.query<any, [string]>(
      "SELECT timezone FROM users WHERE id = ?"
    ).get(finalUserId);
    const userTimezone = userRow?.timezone || "UTC";
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
    const agent = db.query<any, [string]>(
      "SELECT provider_id, model_id FROM agents WHERE id = ?"
    ).get(finalAgentId);

    const provider = agent?.provider_id || "gemini";

    // Create runner
    const runner = new AgentRunner({} as any);

    let responseContent = "";
    let responseError: string | null = null;

    // Enqueue in lane queue for processing
    laneQueue.enqueue(threadId, async (_task, signal) => {
      if (signal.aborted) return;

      try {
        log.info(`[chat] Generating response for thread ${threadId}...`);

        const response = await runner.generate({
          provider: provider as any,
          messages,
          rawUserMessage: message,
          maxTokens: 4096,
          maxSteps: 15,
          threadId,
          userId: finalUserId,
          agentId: finalAgentId,
          channel,
          onStep: async (step) => {
            if (step.type === "text" && step.message) {
              log.debug(`[chat] Step: ${step.message.substring(0, 100)}`);
            }
            if (step.type === "tool_result" && step.message) {
              log.debug(`[chat] Tool result: ${step.message.substring(0, 100)}`);
            }
          },
        });

        responseContent = response.content?.trim() || "Task completed.";
        log.info(`[chat] Response generated: ${responseContent.substring(0, 100)}...`);

      } catch (error) {
        log.error(`[chat] Error for thread ${threadId}: ${(error as Error).message}`);
        responseError = (error as Error).message;
      }
    });

    // Wait for processing to complete (with timeout)
    const startTime = Date.now();
    const timeout = 120000; // 2 minutes timeout

    while (!responseContent && !responseError) {
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
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (responseError) {
      return addCorsHeaders(
        Response.json({
          success: false,
          error: responseError,
          thread_id: threadId,
        }, { status: 500 }),
        req
      );
    }

    return addCorsHeaders(
      Response.json({
        success: true,
        thread_id: threadId,
        content: responseContent,
      }),
      req
    );

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

  const messages = getDb().query(`
    SELECT id, thread_id, channel, role, content, tool_calls_json, tool_call_id, reasoning_content, token_count, created_at, updated_at FROM conversations
    WHERE thread_id = ? AND role IN ('user', 'assistant')
    ORDER BY id DESC
    LIMIT ?
  `).all(threadId, limit) as Record<string, unknown>[]

  return addCorsHeaders(Response.json({ messages: messages.reverse() }), req)
}

export async function handleGetCanvas(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({ nodes: [], edges: [] }), req)
}

export async function handleGetNotes(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const notes = getDb().query(`
    SELECT * FROM scratchpad ORDER BY updated_at DESC LIMIT 50
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ notes }), req)
}

export async function handleUpdateNote(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { threadId, content } = body
  
  if (!threadId || !content) {
    return addCorsHeaders(Response.json({ success: false, error: "threadId and content required" }), req)
  }
  
  getDb().query(`
    INSERT OR REPLACE INTO scratchpad(thread_id, key, value, updated_at)
    VALUES(?, 'note', ?, ?)
  `).run(threadId, content, Math.floor(Date.now() / 1000))
  
  return addCorsHeaders(Response.json({ success: true }), req)
}
