import fs from "node:fs";
import path from "node:path";
import type { AudioFile } from "./types.js";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function copyFilesToOutput(files: AudioFile[], outputDir: string): AudioFile[] {
  ensureDir(outputDir);
  return files.map((file) => {
    const outputPath = path.join(outputDir, path.basename(file.path));
    fs.copyFileSync(file.path, outputPath);
    return { ...file, path: outputPath };
  });
}
