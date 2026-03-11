import { mkdirSync, existsSync, accessSync, constants } from "node:fs";
import * as path from "node:path";
import { getDb } from "../../storage/sqlite";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Valida un path de workspace
 * POST /api/workspace/validate
 * Body: { path: string }
 */
export async function handleValidateWorkspace(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { path: workspacePath } = body;

    if (!workspacePath || typeof workspacePath !== "string") {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "Path es requerido",
          exists: false,
          accessible: false,
        }),
        req
      );
    }

    // Verificar que sea un path absoluto
    const isAbsolute = path.isAbsolute(workspacePath);
    if (!isAbsolute) {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "El path debe ser absoluto (ej: /home/user/proyectos o C:\\Users\\user\\proyectos)",
          exists: false,
          accessible: false,
          isAbsolute: false,
        }),
        req
      );
    }

    // Verificar si existe
    const exists = existsSync(workspacePath);

    if (!exists) {
      return addCorsHeaders(
        Response.json({
          ok: true,
          exists: false,
          accessible: false,
          isAbsolute: true,
          canCreate: true,
          message: "El directorio no existe. Puede crearlo.",
        }),
        req
      );
    }

    // Verificar permisos de lectura/escritura
    let accessible = true;
    let errorMessage: string | null = null;

    try {
      accessSync(workspacePath, constants.R_OK | constants.W_OK);
    } catch (err) {
      accessible = false;
      errorMessage = (err as Error).message;
    }

    return addCorsHeaders(
      Response.json({
        ok: true,
        exists: true,
        accessible,
        isAbsolute: true,
        canCreate: false,
        error: errorMessage,
        message: accessible
          ? "Directorio válido y accesible"
          : "El directorio existe pero no tiene permisos de lectura/escritura",
      }),
      req
    );
  } catch (error) {
    return addCorsHeaders(
      Response.json({
        ok: false,
        error: (error as Error).message,
        exists: false,
        accessible: false,
      }),
      req
    );
  }
}

/**
 * Crea un directorio de workspace
 * POST /api/workspace/create
 * Body: { path: string }
 */
export async function handleCreateWorkspace(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const { path: workspacePath } = body;

    if (!workspacePath || typeof workspacePath !== "string") {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "Path es requerido",
        }),
        req
      );
    }

    // Verificar que sea un path absoluto
    if (!path.isAbsolute(workspacePath)) {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "El path debe ser absoluto",
        }),
        req
      );
    }

    // Crear directorio
    mkdirSync(workspacePath, { recursive: true });

    return addCorsHeaders(
      Response.json({
        ok: true,
        path: workspacePath,
        message: "Directorio creado exitosamente",
      }),
      req
    );
  } catch (error) {
    return addCorsHeaders(
      Response.json({
        ok: false,
        error: (error as Error).message,
      }),
      req
    );
  }
}

/**
 * Abre un directorio en el explorador del sistema
 * GET /api/workspace/open?path=/path/to/dir
 */
export async function handleOpenWorkspace(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const workspacePath = url.searchParams.get("path");

    if (!workspacePath || typeof workspacePath !== "string") {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "Path es requerido",
        }),
        req
      );
    }

    if (!path.isAbsolute(workspacePath)) {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "El path debe ser absoluto",
        }),
        req
      );
    }

    if (!existsSync(workspacePath)) {
      return addCorsHeaders(
        Response.json({
          ok: false,
          error: "El directorio no existe",
        }),
        req
      );
    }

    // Comando para abrir en el explorador según el SO
    let command: string;
    const platform = process.platform;

    if (platform === "win32") {
      command = `explorer "${workspacePath}"`;
    } else if (platform === "darwin") {
      command = `open "${workspacePath}"`;
    } else {
      command = `xdg-open "${workspacePath}"`;
    }

    await execAsync(command);

    return addCorsHeaders(
      Response.json({
        ok: true,
        message: "Directorio abierto en el explorador",
      }),
      req
    );
  } catch (error) {
    return addCorsHeaders(
      Response.json({
        ok: false,
        error: (error as Error).message,
      }),
      req
    );
  }
}

export async function handleGetWorkspace(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  workspacePath: string,
  wsType: "soul" | "user" | "ethics"
): Promise<Response> {
  const filePath = path.join(workspacePath, `${wsType.toUpperCase()}.md`);
  const wsFile = Bun.file(filePath);

  const defaults: Record<string, string> = {
    soul: "# Agent Soul\n\nDefine your agent's personality here.",
    user: "# User Profile\n\nAdd user preferences here.",
    ethics: "# Ethics\n\nDefine ethical guidelines here.",
  };

  const content = (await wsFile.exists())
    ? await wsFile.text()
    : defaults[wsType];

  return addCorsHeaders(
    new Response(content, { headers: { "Content-Type": "text/plain" } }),
    req
  );
}

export async function handleUpdateWorkspace(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  workspacePath: string,
  wsType: "soul" | "user" | "ethics",
  reloadFn?: (type: string) => Promise<void>
): Promise<Response> {
  const content = await req.text();
  const filePath = path.join(workspacePath, `${wsType.toUpperCase()}.md`);

  mkdirSync(workspacePath, { recursive: true });
  await Bun.write(filePath, content);

  // Trigger reload if callback provided
  if (reloadFn) {
    await reloadFn(wsType);
  }

  return addCorsHeaders(
    Response.json({ success: true, savedAt: new Date().toISOString() }),
    req
  );
}
