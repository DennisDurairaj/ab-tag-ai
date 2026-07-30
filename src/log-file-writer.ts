import fs from "node:fs";
import path from "node:path";

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimestamp(d: Date): string {
  const datePart = formatDate(d);
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${datePart} ${h}:${min}:${s}`;
}

const MAX_AGE_DAYS = 7;

function logFileName(dateStr: string): string {
  return `${dateStr}.log`;
}

function fileDateFromName(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? match[1] : null;
}

export class LogFileWriter {
  private logsDir: string;
  private currentDate: string | null = null;
  private currentPath: string | null = null;
  private writeFailed = false;

  constructor(outputDir: string) {
    this.logsDir = path.join(outputDir, "logs");
  }

  startup(now: Date): void {
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
    } catch {
      console.warn("Log file writer: unable to create logs directory, logging disabled");
      this.writeFailed = true;
      return;
    }

    this.cleanup(now);

    this.currentDate = formatDate(now);
    this.currentPath = path.join(this.logsDir, logFileName(this.currentDate));
  }

  private cleanup(now: Date): void {
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - MAX_AGE_DAYS));

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.logsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fileDate = fileDateFromName(entry.name);
      if (!fileDate) continue;
      const entryDate = new Date(fileDate);
      if (entryDate < cutoff) {
        try {
          fs.unlinkSync(path.join(this.logsDir, entry.name));
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  write(now: Date, message: string): void {
    if (this.writeFailed) return;

    const dateStr = formatDate(now);
    if (dateStr !== this.currentDate) {
      this.currentDate = dateStr;
      this.currentPath = path.join(this.logsDir, logFileName(dateStr));
    }

    if (!this.currentPath) return;

    const line = `[${formatTimestamp(now)}] ${message}\n`;

    try {
      fs.appendFileSync(this.currentPath, line, "utf-8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Log file writer: write failed (${msg}), logging to file disabled`);
      this.writeFailed = true;
    }
  }
}
