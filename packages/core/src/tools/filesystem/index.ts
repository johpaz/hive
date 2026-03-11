/**
 * Filesystem Tools - 7 tools
 * 
 * @category filesystem
 */

import type { Tool } from "../types.ts";
import { fsReadTool } from "./fs-read.ts";
import { fsWriteTool } from "./fs-write.ts";
import { fsEditTool } from "./fs-edit.ts";
import { fsDeleteTool } from "./fs-delete.ts";
import { fsListTool } from "./fs-list.ts";
import { fsGlobTool } from "./fs-glob.ts";
import { fsExistsTool } from "./fs-exists.ts";

export function createTools(): Tool[] {
  return [
    fsReadTool,
    fsWriteTool,
    fsEditTool,
    fsDeleteTool,
    fsListTool,
    fsGlobTool,
    fsExistsTool,
  ];
}

export * from "./fs-read.ts";
export * from "./fs-write.ts";
export * from "./fs-edit.ts";
export * from "./fs-delete.ts";
export * from "./fs-list.ts";
export * from "./fs-glob.ts";
export * from "./fs-exists.ts";
