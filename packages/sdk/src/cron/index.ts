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
 * } from "@johpaz/hiveAgents-sdk/cron";
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
} from "@johpaz/hiveAgents/tools/schedule";

// Legacy cron tools (cron_jobs table) - re-export for backward compatibility
export {
  cronAddTool,
  cronListTool,
  cronEditTool,
  cronRemoveTool,
  createTools as createCronTools,
  initCronScheduler,
  resolveBestChannel,
} from "@johpaz/hiveAgents/tools/cron";
