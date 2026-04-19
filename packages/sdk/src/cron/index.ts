/**
 * Hive SDK - Cron Module
 *
 * Exposes the scheduler and cron job management functions.
 * Uses Croner v10.0.1 for scheduling.
 *
 * @example
 * import {
 *   cronCreateTool,
 *   createCronTools,
 *   setSchedulerInstance,
 * } from "@johpaz/hive-agents-sdk/cron";
 */

export {
  cronCreateTool,
  cronListTool,
  cronUpdateTool,
  cronPauseTool,
  cronResumeTool,
  cronDeleteTool,
  cronTriggerTool,
  cronHistoryTool,
  createTools as createCronTools,
  setSchedulerInstance,
  resolveBestChannel,
} from "@johpaz/hive-agents-core/tools/cron";