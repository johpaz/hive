import { canvasManager } from "../../canvas/canvas-manager.ts";
import { resolveUserId } from "../../storage/onboarding.ts";

/**
 * Returns the durable-in-process A2UI surfaces for the authenticated user.
 * The client should use these IDs for cleanup instead of guessing a surface
 * name such as "main" or "saludo".
 */
export async function handleGetA2UISurfaces(
  req: Request,
  addCorsHeaders: (response: Response, request: Request) => Response,
): Promise<Response> {
  const userId = await resolveUserId({});
  if (!userId) {
    return addCorsHeaders(Response.json({ surfaces: [], sessionId: null }), req);
  }

  const sessionId = `canvas:${userId}`;
  return addCorsHeaders(Response.json({
    sessionId,
    surfaces: canvasManager.getA2UISurfaces(sessionId),
  }), req);
}

export async function handleDeleteA2UISurface(
  req: Request,
  addCorsHeaders: (response: Response, request: Request) => Response,
): Promise<Response> {
  const userId = await resolveUserId({});
  const surfaceId = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "");
  if (!userId || !surfaceId) {
    return addCorsHeaders(Response.json({ success: false, error: "surfaceId required" }, { status: 400 }), req);
  }

  const sessionId = `canvas:${userId}`;
  const known = canvasManager.getA2UISurfaces(sessionId).some((surface) => surface.surfaceId === surfaceId);
  if (!known) {
    return addCorsHeaders(Response.json({ success: false, error: "Surface not found", surfaceId }, { status: 404 }), req);
  }

  await canvasManager.sendA2UIMessage(sessionId, "a2ui:deleteSurface", { surfaceId });
  return addCorsHeaders(Response.json({ success: true, sessionId, surfaceId }), req);
}
