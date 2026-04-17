import type { CheckDef, FunctionCall } from "@/types/a2ui";
import { resolvePath, executeFunctionCall } from "./dataBinding";

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ message: string; field?: string }>;
}

export function runChecks(
  checks: CheckDef[],
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): ValidationResult {
  const errors: Array<{ message: string; field?: string }> = [];

  for (const check of checks) {
    const valid = evaluateCondition(check, dataModel, scopeData, formatters);
    if (!valid) {
      errors.push({
        message: check.message ?? `Validation failed: ${check.call}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

export function evaluateCondition(
  check: CheckDef,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): boolean {
  // If check has a condition (for Button checks), evaluate it
  if (check.condition) {
    const result = executeFunctionCall(check.condition, dataModel, scopeData, formatters);
    return result === true;
  }

  // Otherwise evaluate as a validation function call
  const result = executeFunctionCall(
    { call: check.call, args: check.args ?? {} },
    dataModel,
    scopeData,
    formatters
  );
  return result === true || result === "true";
}

export function checkButtonDisabled(
  checks: CheckDef[] | undefined,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): boolean {
  if (!checks || checks.length === 0) return false;

  for (const check of checks) {
    if (!evaluateCondition(check, dataModel, scopeData, formatters)) {
      return true;
    }
  }
  return false;
}