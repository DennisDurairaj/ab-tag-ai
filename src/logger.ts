import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const COLOR_FN = {
  red: pc.red,
  yellow: pc.yellow,
  green: pc.green,
  magenta: pc.magenta,
  cyan: pc.cyan,
  dim: pc.dim,
} as const;

export interface Logger {
  raw(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  header(msg: string): void;
  progress(msg: string): void;
  success(msg: string): void;
  skipped(msg: string): void;
  flagged(msg: string): void;
  dryRun(msg: string): void;
  detail(msg: string): void;
  tagged(tag: string, msg: string, color: keyof typeof COLOR_FN): void;
}

export function createLogger(level: LogLevel = "info"): Logger {
  function canLog(lvl: LogLevel): boolean {
    return LEVEL_ORDER[lvl] >= LEVEL_ORDER[level];
  }

  return {
    raw(msg: string) { if (canLog("info")) console.log(msg); },
    warn(msg: string) { if (canLog("warn")) console.warn(pc.yellow(msg)); },
    error(msg: string) { if (canLog("error")) console.error(pc.red(msg)); },
    debug(msg: string) { if (canLog("debug")) console.log(pc.dim(msg)); },
    header(msg: string) { if (canLog("info")) console.log(pc.bold(pc.cyan(msg))); },
    progress(msg: string) { if (canLog("info")) console.log(pc.cyan(msg)); },
    success(msg: string) { if (canLog("info")) console.log(pc.green(msg)); },
    skipped(msg: string) { if (canLog("info")) console.log(pc.dim(msg)); },
    flagged(msg: string) { if (canLog("info")) console.log(pc.magenta(msg)); },
    dryRun(msg: string) { if (canLog("info")) console.log(pc.blue(msg)); },
    detail(msg: string) { if (canLog("debug")) console.log(pc.dim(msg)); },
    tagged(tag: string, msg: string, color: keyof typeof COLOR_FN = "dim") {
      if (!canLog("info")) return;
      console.error(pc.dim(`  [${tag}] `) + COLOR_FN[color](msg));
    },
  };
}

let currentLogger: Logger = createLogger("info");

export function setLogger(logger: Logger): void {
  currentLogger = logger;
}

export function setLogLevel(level: LogLevel): void {
  currentLogger = createLogger(level);
}

export function raw(msg: string) { currentLogger.raw(msg); }
export function warn(msg: string) { currentLogger.warn(msg); }
export function error(msg: string) { currentLogger.error(msg); }
export function debug(msg: string) { currentLogger.debug(msg); }
export function header(msg: string) { currentLogger.header(msg); }
export function progress(msg: string) { currentLogger.progress(msg); }
export function success(msg: string) { currentLogger.success(msg); }
export function skipped(msg: string) { currentLogger.skipped(msg); }
export function flagged(msg: string) { currentLogger.flagged(msg); }
export function dryRun(msg: string) { currentLogger.dryRun(msg); }
export function detail(msg: string) { currentLogger.detail(msg); }
export function tagged(tag: string, msg: string, color: keyof typeof COLOR_FN = "dim") { currentLogger.tagged(tag, msg, color); }
