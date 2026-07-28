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

const SYNOPSIS_PATTERN = /synopsis/i;

const SIDECAR_RULES: Record<string, "useful" | "junk"> = {
  ".nfo": "useful",
  ".cue": "useful",
  ".json": "useful",
  ".txt": "junk",
  "desktop.ini": "junk",
  "icon.ico": "junk",
};

export type SidecarVerdict = "useful" | "junk" | null;

export function classifySidecar(filename: string): SidecarVerdict {
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);

  if (SYNOPSIS_PATTERN.test(path.basename(lower, ext))) return "useful";

  return SIDECAR_RULES[ext] ?? SIDECAR_RULES[lower] ?? null;
}

function copySidecarFiles(sourceDir: string, outputDir: string): void {
  if (!fs.existsSync(sourceDir)) return;

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const verdict = classifySidecar(entry.name);
    if (verdict === "useful") {
      fs.copyFileSync(path.join(sourceDir, entry.name), path.join(outputDir, entry.name));
    }
  }
}

export function copyFilesToOutput(files: AudioFile[], outputDir: string): AudioFile[] {
  ensureDir(outputDir);

  if (files.length > 0) {
    const sourceDir = path.dirname(files[0].path);
    copySidecarFiles(sourceDir, outputDir);
  }

  return files.map((file) => {
    const outputPath = path.join(outputDir, path.basename(file.path));
    fs.copyFileSync(file.path, outputPath);
    return { ...file, path: outputPath };
  });
}

export function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function fuzzyMatch(a: string, b: string): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  if (normA.replace(/[^a-z0-9]/g, "") === normB.replace(/[^a-z0-9]/g, "")) return true;
  return false;
}
