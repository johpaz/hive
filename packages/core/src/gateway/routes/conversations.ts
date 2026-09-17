/**
 * Conversations API — la lista de conversaciones de la web.
 *
 * Antes no existía: todos los canales compartían un único hilo cuyo `thread_id`
 * era el `userId`, así que no había nada que listar ni forma de abrir una
 * conversación nueva. Ahora cada canal y cada contacto tienen su hilo
 * (`agent/thread-id.ts`) y esta ruta expone los de la web.
 *
 * El id de una conversación lleva "/" (`usuario/canal/peer`), así que NO va en el
 * path: viaja por query string o en el cuerpo. Es opaco para el cliente — se manda
 * de vuelta tal cual llegó.
 */

import { resolveUserId } from "../../storage/onboarding";
import { logger } from "../../utils/logger";
import {
  listThreads,
  createWebConversation,
  renameThread,
  deleteThread,
  getThread,
} from "../../agent/thread-store";
import type { ConversationThreadDoc } from "../../storage/collections";

const log = logger.child("api:conversations");

type Cors = (res: Response, req: Request) => Response;

interface ConversationWire {
  id: string;
  title: string | null;
  channel: string;
  peerKind: "direct" | "group";
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
}

function toWire(doc: ConversationThreadDoc): ConversationWire {
  return {
    id: doc.id,
    title: doc.title,
    channel: doc.channel,
    peerKind: doc.peer_kind,
    messageCount: doc.message_count,
    lastMessageAt: doc.last_message_at,
    createdAt: doc.created_at,
  };
}

/** El dueño de la instancia: sistema mono-usuario, igual que resolveContext. */
async function currentUserId(): Promise<string | null> {
  return (await resolveUserId({ channel: "webchat" })) ?? null;
}

/** Rechaza cualquier hilo que no sea del usuario — incluido el que no existe. */
async function ownedThread(threadId: string, userId: string): Promise<ConversationThreadDoc | null> {
  const thread = await getThread(threadId);
  if (!thread || thread.user_id !== userId) return null;
  return thread;
}

export async function handleListConversations(req: Request, cors: Cors): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return cors(Response.json({ conversations: [] }), req);

  const url = new URL(req.url);
  const channel = url.searchParams.get("channel") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  const threads = await listThreads(userId, { channel, includeArchived });
  return cors(Response.json({ conversations: threads.map(toWire) }), req);
}

export async function handleCreateConversation(req: Request, cors: Cors): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) {
    return cors(Response.json({ error: "No hay usuario configurado" }, { status: 409 }), req);
  }

  const body = await req.json().catch(() => ({} as { title?: string }));
  const conversation = await createWebConversation(userId, body.title);
  log.info(`[conversations] Nueva conversación ${conversation.id}`);
  return cors(Response.json({ conversation: toWire(conversation) }, { status: 201 }), req);
}

export async function handleRenameConversation(req: Request, cors: Cors): Promise<Response> {
  const userId = await currentUserId();
  const body = await req.json().catch(() => ({} as { threadId?: string; title?: string }));
  const threadId = body.threadId?.trim();
  const title = body.title;

  if (!threadId || typeof title !== "string") {
    return cors(Response.json({ error: "threadId y title son obligatorios" }, { status: 400 }), req);
  }
  if (!userId || !(await ownedThread(threadId, userId))) {
    return cors(Response.json({ error: "Conversación desconocida" }, { status: 404 }), req);
  }

  await renameThread(threadId, title);
  const updated = await getThread(threadId);
  return cors(Response.json({ conversation: updated ? toWire(updated) : null }), req);
}

export async function handleDeleteConversation(req: Request, cors: Cors): Promise<Response> {
  const userId = await currentUserId();
  const url = new URL(req.url);
  const threadId =
    url.searchParams.get("threadId")?.trim() ||
    (await req.json().catch(() => ({} as { threadId?: string }))).threadId?.trim();

  if (!threadId) {
    return cors(Response.json({ error: "threadId es obligatorio" }, { status: 400 }), req);
  }
  if (!userId || !(await ownedThread(threadId, userId))) {
    return cors(Response.json({ error: "Conversación desconocida" }, { status: 404 }), req);
  }

  await deleteThread(threadId);
  return cors(Response.json({ success: true }), req);
}
