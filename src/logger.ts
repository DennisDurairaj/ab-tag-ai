import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel) { currentLevel = level; }
function canLog(level: LogLevel) { return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]; }

export function raw(msg: string) { if (canLog("info")) console.log(msg); }

export function warn(msg: string) { if (canLog("warn")) console.warn(pc.yellow(msg)); }
export function error(msg: string) { if (canLog("error")) console.error(pc.red(msg)); }
export function debug(msg: string) { if (canLog("debug")) console.log(pc.dim(msg)); }

export function header(msg: string) { if (canLog("info")) console.log(pc.bold(pc.cyan(msg))); }
export function progress(msg: string) { if (canLog("info")) console.log(pc.cyan(msg)); }
export function success(msg: string) { if (canLog("info")) console.log(pc.green(msg)); }
export function skipped(msg: string) { if (canLog("info")) console.log(pc.dim(msg)); }
export function flagged(msg: string) { if (canLog("info")) console.log(pc.magenta(msg)); }
export function dryRun(msg: string) { if (canLog("info")) console.log(pc.blue(msg)); }
export function detail(msg: string) { if (canLog("debug")) console.log(pc.dim(msg)); }

const COLOR_FN = {
  red: pc.red,
  yellow: pc.yellow,
  green: pc.green,
  magenta: pc.magenta,
  cyan: pc.cyan,
  dim: pc.dim,
} as const;

export function tagged(tag: string, msg: string, color: keyof typeof COLOR_FN = "dim") {
  if (!canLog("info")) return;
  const colorFn = COLOR_FN[color];
  console.error(pc.dim(`  [${tag}] `) + colorFn(msg));
}
