/**
 * Hive SDK - Cron Module
 *
 * Exposes the scheduler and cron job management functions.
 * Includes both legacy cron tools and new Croner-based schedule tools.
 *
 * @example
 * import {
 *   scheduleCreateTool,
 *   scheduleListTool,
 *   initCronScheduler,
 * } from "@johpaz/hive-agents-sdk/cron";
 */

// New schedule tools (scheduled_tasks table - Croner-based)
export {
  scheduleCreateTool,
  scheduleListTool,
  schedulePauseTool,
  scheduleResumeTool,
  scheduleDeleteTool,
  scheduleTriggerTool,
  scheduleHistoryTool,
  createTools as createScheduleTools,
  setSchedulerInstance,
} from "@johpaz/hive-agents-core/tools/schedule";

// Legacy cron tools (cron_jobs table) - re-export for backward compatibility
// Note: These are also available via @johpaz/hive-agents-sdk/tools
export {
  cronCreateTool,
  cronListTool,
  cronPauseTool,
  cronResumeTool,
  cronDeleteTool,
  cronTriggerTool,
  cronHistoryTool,
  createTools as createCronTools,
  resolveBestChannel,
} from "@johpaz/hive-agents-core/tools/cron";
