import type { Config } from "../../config/loader.ts";
import { getDb } from "../../storage/sqlite.ts";
import { decryptConfig } from "../../storage/crypto.ts";
import { redactConfig } from "../helpers/redact.ts";

export async function handleGetConfig(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  config: Config
): Promise<Response> {
  return addCorsHeaders(Response.json(redactConfig(config)), req);
}
