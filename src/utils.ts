import fs from "node:fs";
import path from "node:path";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const INVALID_PATH_CHAR = /[<>:"/\\|?*]/g;

function sanitizePathComponent(input: string): string {
  return input.replace(INVALID_PATH_CHAR, "").trim();
}

export function buildBookFolderPath(
  outputDir: string,
  author: string,
  title: string,
  series?: string,
): string {
  const safeAuthor = sanitizePathComponent(author) || "Unknown Author";
  const safeTitle = sanitizePathComponent(title) || "Unknown Title";

  if (series) {
    const safeSeries = sanitizePathComponent(series);
    return path.join(outputDir, safeAuthor, safeSeries, safeTitle);
  }

  return path.join(outputDir, safeAuthor, safeTitle);
}

export function writeCoverArt(
  coverArt: Buffer | null | undefined,
  bookDir: string,
): string | null {
  if (!coverArt) return null;

  fs.mkdirSync(bookDir, { recursive: true });
  const coverPath = path.join(bookDir, "cover.jpg");
  fs.writeFileSync(coverPath, coverArt);
  return coverPath;
}
