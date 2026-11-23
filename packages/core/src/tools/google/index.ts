/**
 * Google Workspace tools (Gmail, Calendar, Drive).
 *
 * Sólo entran en el loadout cuando el host llamó `configureGoogle()`.
 * Cada tool opera con la cuenta que el usuario de la sesión conectó.
 */
import type { Tool } from "../types.ts";
import { gmailTools } from "./gmail.ts";
import { calendarTools } from "./calendar.ts";
import { driveTools } from "./drive.ts";

export function createTools(): Tool[] {
  return [...gmailTools, ...calendarTools, ...driveTools];
}

export * from "./gmail.ts";
export * from "./calendar.ts";
export * from "./drive.ts";
