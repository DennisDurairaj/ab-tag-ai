import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import id3 from "node-id3";
import ffprobe from "ffprobe-static";
import { execSync } from "node:child_process";

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

export interface AudioFile {
  path: string;
  format: "mp3" | "m4b";
  existingMetadata: Record<string, string>;
}

export interface Book {
  path: string;
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesPart?: number;
  coverArt?: Buffer;
}

export interface BookSet {
  books: Book[];
  files: AudioFile[];
}

export interface MultiFileSet {
  prefix: string;
  files: AudioFile[];
  directory: string;
}

export function scanForAudioFiles(inputDir: string): AudioFile[] {
  const mp3Files = globSync("**/*.mp3", { cwd: inputDir, absolute: true });
  const m4bFiles = globSync("**/*.m4b", { cwd: inputDir, absolute: true });

  const files: AudioFile[] = [];

  for (const filePath of mp3Files) {
    const metadata = readMp3Metadata(filePath);
    files.push({ path: filePath, format: "mp3", existingMetadata: metadata });
  }

  for (const filePath of m4bFiles) {
    const metadata = readM4bMetadata(filePath);
    files.push({ path: filePath, format: "m4b", existingMetadata: metadata });
  }

  return files;
}

function readMp3Metadata(filePath: string): Record<string, string> {
  try {
    const tags = id3.read(filePath);
    if (!tags) return {};
    const metadata: Record<string, string> = {};
    if (tags.title) metadata.title = tags.title;
    if (tags.artist) metadata.artist = tags.artist;
    if (tags.album) metadata.album = tags.album;
    return metadata;
  } catch {
    return {};
  }
}

function readM4bMetadata(filePath: string): Record<string, string> {
  try {
    const output = execSync(
      `"${ffprobe.path}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(output);
    const metadata: Record<string, string> = {};
    const format = parsed.format || {};
    if (format.tags) {
      if (format.tags.title) metadata.title = format.tags.title;
      if (format.tags.artist) metadata.artist = format.tags.artist;
      if (format.tags.album) metadata.album = format.tags.album;
    }
    return metadata;
  } catch {
    return {};
  }
}

export function detectMultiFileSets(files: AudioFile[]): MultiFileSet[] {
  const byDir = new Map<string, AudioFile[]>();

  for (const file of files) {
    const dir = path.dirname(file.path);
    const existing = byDir.get(dir) || [];
    existing.push(file);
    byDir.set(dir, existing);
  }

  const sets: MultiFileSet[] = [];

  for (const [dir, dirFiles] of byDir) {
    if (dirFiles.length < 2) continue;

    const grouped = groupByPrefix(dirFiles);
    for (const [prefix, group] of grouped) {
      if (group.length >= 2) {
        sets.push({ prefix, files: group, directory: dir });
      }
    }
  }

  return sets;
}

function groupByPrefix(files: AudioFile[]): Map<string, AudioFile[]> {
  const groups = new Map<string, AudioFile[]>();

  for (const file of files) {
    const basename = path.basename(file.path, path.extname(file.path));
    const prefix = extractPrefix(basename);
    const existing = groups.get(prefix) || [];
    existing.push(file);
    groups.set(prefix, existing);
  }

  return groups;
}

function extractPrefix(basename: string): string {
  const patterns = [
    /^(.*?)[_\-\s]?\d+$/,
    /^(.*?)[_\-\s]?Part\d+$/i,
    /^(.*?)[_\-\s]?Chapter\s*\d+$/i,
  ];

  for (const pattern of patterns) {
    const match = basename.match(pattern);
    if (match && match[1].trim()) {
      return match[1].trim();
    }
  }

  return basename;
}