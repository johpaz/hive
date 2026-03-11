/**
 * fs_edit - Edit specific lines or sections of a file
 * 
 * @category filesystem
 * @seedId fs_edit
 * @spanish editar archivo, modificar líneas, actualizar contenido
 */

import type { Tool } from "../types.ts";
import { logger } from "../../utils/logger.ts";
import { resolveInWorkspace, getWorkspace } from "./workspace-guard.ts";
import * as fs from "node:fs";

const log = logger.child("fs-edit");

export const fsEditTool: Tool = {
  name: "fs_edit",
  description: "Edit specific lines or sections of a file. Spanish: editar archivo, modificar líneas, actualizar contenido",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      oldString: {
        type: "string",
        description: "The text to search for and replace",
      },
      newString: {
        type: "string",
        description: "The text to replace with",
      },
      replaceAll: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
      },
    },
    required: ["path", "oldString", "newString"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const workspace = getWorkspace(config);
    let filePath: string;
    try {
      filePath = resolveInWorkspace(params.path as string, workspace);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const oldString = params.oldString as string;
    const newString = params.newString as string;
    const replaceAll = (params.replaceAll as boolean) ?? false;

    log.debug(`Editing file: ${filePath}`);

    try {
      if (!fs.existsSync(filePath)) {
        return {
          ok: false,
          error: `File not found: ${filePath}`,
        };
      }

      const content = fs.readFileSync(filePath, "utf-8");

      if (!content.includes(oldString)) {
        return {
          ok: false,
          error: `String not found in file: ${oldString.substring(0, 50)}...`,
        };
      }

      let newContent: string;
      let occurrences = 0;
      if (replaceAll) {
        occurrences = content.split(oldString).length - 1;
        newContent = content.split(oldString).join(newString);
      } else {
        const index = content.indexOf(oldString);
        occurrences = content.split(oldString).length - 1;

        if (occurrences > 1) {
          return {
            ok: false,
            error: `Found ${occurrences} occurrences. Use replaceAll: true or provide more context.`,
          };
        }

        newContent = content.replace(oldString, newString);
      }

      fs.writeFileSync(filePath, newContent, "utf-8");

      return {
        ok: true,
        path: filePath,
        replacements: replaceAll ? occurrences : 1,
      };
    } catch (error) {
      log.error(`Error editing file: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to edit file: ${(error as Error).message}`,
      };
    }
  },
};
