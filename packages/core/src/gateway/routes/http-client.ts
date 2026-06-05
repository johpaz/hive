import { apiRequestTool } from "../../tools/api/api-request.ts";

export async function handleHttpRequest(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));

    const result = await apiRequestTool.execute(body, { configurable: {} });

    return addCorsHeaders(Response.json(result), req);
  } catch (error) {
    return addCorsHeaders(Response.json({
      ok: false,
      error: `Request failed: ${(error as Error).message}`,
    }), req);
  }
}
