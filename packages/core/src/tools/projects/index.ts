/**
 * Projects Tools - 8 tools
 * 
 * @category projects
 */

import type { Tool } from "../types.ts";
import { projectCreateTool } from "./project-create.ts";
import { projectListTool } from "./project-list.ts";
import { projectUpdateTool } from "./project-update.ts";
import { projectDoneTool } from "./project-done.ts";
import { projectFailTool } from "./project-fail.ts";
import { taskCreateTool } from "./task-create.ts";
import { taskUpdateTool } from "./task-update.ts";
import { taskEvaluateTool } from "./task-evaluate.ts";

export function createTools(): Tool[] {
  return [
    projectCreateTool,
    projectListTool,
    projectUpdateTool,
    projectDoneTool,
    projectFailTool,
    taskCreateTool,
    taskUpdateTool,
    taskEvaluateTool,
  ];
}

export * from "./project-create.ts";
export * from "./project-list.ts";
export * from "./project-update.ts";
export * from "./project-done.ts";
export * from "./project-fail.ts";
export * from "./task-create.ts";
export * from "./task-update.ts";
export * from "./task-evaluate.ts";
