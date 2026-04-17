import type { DynamicString, DynamicNumber, DynamicBoolean, DynamicStringList, FunctionCall } from "@/types/a2ui";

// ─── JSON Pointer Resolution ────────────────────────────────────────────────

export function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path || path === "/") return obj;
  const parts = path.replace(/^\//, "").split("/");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (!path || path === "/") return value as Record<string, unknown>;
  const parts = path.replace(/^\//, "").split("/");
  const result = structuredClone(obj);
  let cur: Record<string, unknown> = result;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  if (value === undefined) {
    delete cur[parts[parts.length - 1]];
  } else {
    cur[parts[parts.length - 1]] = value;
  }
  return result;
}

// ─── Dynamic Value Resolution ────────────────────────────────────────────────

export function isPath(obj: unknown): obj is { path: string } {
  return obj != null && typeof obj === "object" && "path" in obj && !("call" in obj);
}

export function isFunctionCall(obj: unknown): obj is FunctionCall {
  return obj != null && typeof obj === "object" && "call" in obj;
}

export function resolveDynamicString(
  dyn: DynamicString | undefined,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => string>
): string {
  if (dyn == null) return "";
  if (typeof dyn === "string") return dyn;
  if (isPath(dyn)) {
    const val = resolvePath(dyn.path, dataModel, scopeData);
    return val != null ? String(val) : "";
  }
  if (isFunctionCall(dyn)) {
    const result = executeFunctionCall(dyn, dataModel, scopeData, formatters);
    return result != null ? String(result) : "";
  }
  return String(dyn);
}

export function resolveDynamicNumber(
  dyn: DynamicNumber | undefined,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>
): number {
  if (dyn == null) return 0;
  if (typeof dyn === "number") return dyn;
  if (isPath(dyn)) {
    const val = resolvePath(dyn.path, dataModel, scopeData);
    return typeof val === "number" ? val : 0;
  }
  if (isFunctionCall(dyn)) {
    const result = executeFunctionCall(dyn, dataModel, scopeData);
    return typeof result === "number" ? result : 0;
  }
  return Number(dyn) || 0;
}

export function resolveDynamicBoolean(
  dyn: DynamicBoolean | undefined,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>
): boolean {
  if (dyn == null) return false;
  if (typeof dyn === "boolean") return dyn;
  if (isPath(dyn)) {
    const val = resolvePath(dyn.path, dataModel, scopeData);
    return val === true || val === "true";
  }
  if (isFunctionCall(dyn)) {
    const result = executeFunctionCall(dyn, dataModel, scopeData);
    return result === true;
  }
  return Boolean(dyn);
}

export function resolveDynamicStringList(
  dyn: DynamicStringList | undefined,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>
): string[] {
  if (dyn == null) return [];
  if (Array.isArray(dyn)) return dyn;
  if (isPath(dyn)) {
    const val = resolvePath(dyn.path, dataModel, scopeData);
    if (Array.isArray(val)) return val.map(String);
    return val != null ? [String(val)] : [];
  }
  if (isFunctionCall(dyn)) {
    const result = executeFunctionCall(dyn, dataModel, scopeData);
    if (Array.isArray(result)) return result.map(String);
    return [];
  }
  return [];
}

// ─── Path Resolution (Absolute + Relative) ─────────────────────────────────

export function resolvePath(
  path: string,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>
): unknown {
  if (!path) return undefined;

  // Absolute path: starts with /
  if (path.startsWith("/")) {
    return getAtPath(dataModel, path);
  }

  // Relative path: resolve against scope (collection template context)
  if (scopeData) {
    const val = getAtPath(scopeData, path);
    if (val !== undefined) return val;
  }

  // Fallback: try data model root
  return getAtPath(dataModel, path);
}

// ─── Function Execution ─────────────────────────────────────────────────────

export function executeFunctionCall(
  fc: FunctionCall,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): unknown {
  const args: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fc.args ?? {})) {
    args[key] = resolveArg(val, dataModel, scopeData, formatters);
  }

  if (formatters && fc.call in formatters) {
    return formatters[fc.call](args);
  }

  // Built-in formatters
  switch (fc.call) {
    case "formatString": {
      const template = String(args.value ?? "");
      return formatString(template, dataModel, scopeData, formatters);
    }
    case "formatDate": {
      const dateStr = String(args.value ?? "");
      const fmt = String(args.format ?? "yyyy-MM-dd");
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return formatDate(d, fmt);
      } catch {
        return dateStr;
      }
    }
    case "formatNumber": {
      const num = Number(args.value ?? 0);
      if (isNaN(num)) return "0";
      const grouping = args.grouping !== false;
      const precision = Number(args.precision ?? 0);
      return num.toLocaleString("en-US", {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
        useGrouping: grouping,
      });
    }
    case "formatCurrency": {
      const num = Number(args.value ?? 0);
      const currency = String(args.currency ?? "USD");
      try {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
        }).format(num);
      } catch {
        return `$${num.toFixed(2)}`;
      }
    }
    case "required":
      return args.value != null && args.value !== "" && args.value !== undefined;
    case "regex": {
      const value = String(args.value ?? "");
      const pattern = String(args.pattern ?? "");
      if (!pattern) return true;
      try { return new RegExp(pattern).test(value); } catch { return false; }
    }
    case "email": {
      const value = String(args.value ?? "");
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }
    case "length": {
      const value = String(args.value ?? "");
      const min = Number(args.min ?? 0);
      const max = Number(args.max ?? Infinity);
      return value.length >= min && value.length <= max;
    }
    case "numeric": {
      const value = String(args.value ?? "");
      const num = Number(value);
      if (isNaN(num)) return false;
      const min = args.min != null ? Number(args.min) : -Infinity;
      const max = args.max != null ? Number(args.max) : Infinity;
      return num >= min && num <= max;
    }
    case "and": {
      const values = args.values as unknown[];
      return values.every((v) => v === true || v === "true");
    }
    case "or": {
      const values = args.values as unknown[];
      return values.some((v) => v === true || v === "true");
    }
    case "not":
      return !(args.value === true || args.value === "true");
    default:
      return undefined;
  }
}

function resolveArg(
  arg: unknown,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): unknown {
  if (arg == null) return null;
  if (typeof arg === "string" || typeof arg === "number" || typeof arg === "boolean") return arg;
  if (isPath(arg)) return resolvePath(arg.path, dataModel, scopeData);
  if (isFunctionCall(arg)) return executeFunctionCall(arg, dataModel, scopeData, formatters);
  return arg;
}

// ─── Format String (template interpolation) ──────────────────────────────────

export function formatString(
  template: string,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>,
  formatters?: Record<string, (args: Record<string, unknown>) => unknown>
): string {
  // ${/absolute/path} → data model value
  // ${relativePath} → scope value
  // ${functionCall(arg1, arg2)} → function result
  return template.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    // Check for function calls like formatDate(value:${...}, format:'...')
    const fnMatch = expr.match(/^(\w+)\((.+)\)$/s);
    if (fnMatch) {
      const fnName = fnMatch[1];
      const fnArgs = parseFunctionArgs(fnMatch[2], dataModel, scopeData);
      const result = executeFunctionCall({ call: fnName, args: fnArgs }, dataModel, scopeData, formatters);
      return result != null ? String(result) : match;
    }

    // Path expression
    const val = resolvePath(expr, dataModel, scopeData);
    if (val !== undefined) return String(val);
    return match;
  });
}

function parseFunctionArgs(
  argsStr: string,
  dataModel: Record<string, unknown>,
  scopeData?: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  // Simple parsing: key:value pairs separated by commas
  // Values can be: ${path}, 'string', number, boolean
  const pairs = argsStr.split(",").map((s) => s.trim());
  let i = 0;
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      let value = pair.slice(colonIdx + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      // Resolve ${...} in value
      if (value.startsWith("${") && value.endsWith("}")) {
        const path = value.slice(2, -1);
        args[key] = resolvePath(path, dataModel, scopeData);
      } else if (value === "true" || value === "false") {
        args[key] = value === "true";
      } else if (!isNaN(Number(value))) {
        args[key] = Number(value);
      } else {
        args[key] = value;
      }
    } else {
      // Positional arg
      args[String(i)] = pair;
    }
    i++;
  }
  return args;
}

// ─── Date Formatting ────────────────────────────────────────────────────────

function formatDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  const pad = (n: number, len = 2) => String(n).padStart(len, "0");

  const replacements: Record<string, string> = {
    "yyyy": String(year),
    "yy": String(year % 100).padStart(2, "0"),
    "MMMM": date.toLocaleString("en-US", { month: "long" }),
    "MMM": date.toLocaleString("en-US", { month: "short" }),
    "MM": pad(month),
    "M": String(month),
    "dd": pad(day),
    "d": String(day),
    "HH": pad(hours),
    "H": String(hours),
    "hh": pad(hours % 12 || 12),
    "h": String(hours % 12 || 12),
    "mm": pad(minutes),
    "m": String(minutes),
    "ss": pad(seconds),
    "s": String(seconds),
    "a": hours < 12 ? "AM" : "PM",
    "E": date.toLocaleString("en-US", { weekday: "short" }),
    "EEEE": date.toLocaleString("en-US", { weekday: "long" }),
  };

  let result = format;
  // Sort keys by length descending to avoid partial replacements
  const sortedKeys = Object.keys(replacements).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    result = result.replace(new RegExp(key, "g"), replacements[key]);
  }
  return result;
}

// ─── Data Model Update (JSON Pointer upsert) ────────────────────────────────

export function updateDataModel(
  current: Record<string, unknown>,
  path: string | undefined,
  value: unknown
): Record<string, unknown> {
  if (!path || path === "/") {
    // Replace entire data model
    return (value as Record<string, unknown>) ?? {};
  }
  return setAtPath(current, path, value);
}