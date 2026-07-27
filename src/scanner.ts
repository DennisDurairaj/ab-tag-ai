import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { globSync } from "glob";
import id3 from "node-id3";
import { execSync } from "node:child_process";
import type { AudioFile, AudioMetadata, MultiFileSet } from "./types.js";

const _require = createRequire(import.meta.url);

interface FFprobeStatic {
  path: string;
}

let ffprobePath: string;
try {
  ffprobePath = (_require("ffprobe-static") as FFprobeStatic).path;
} catch {
  ffprobePath = "ffprobe";
}

function extractCommonTags(tags: Record<string, string | undefined>): AudioMetadata {
  const metadata: AudioMetadata = {};
  if (tags.title) metadata.title = tags.title;
  if (tags.artist) metadata.artist = tags.artist;
  if (tags.album) metadata.album = tags.album;
  return metadata;
}

function inferFromFilename(filePath: string): AudioMetadata {
  const basename = path.basename(filePath, path.extname(filePath));
  const metadata: AudioMetadata = {};

  const parts = basename.split(/\s*-\s*/);
  if (parts.length >= 2 && parts[0].trim()) {
    metadata.artist = parts[0].trim();
    metadata.title = parts.slice(1).join(" - ").trim();
  } else {
    metadata.title = basename.trim();
  }

  return metadata;
}

function readMp3Metadata(filePath: string): AudioMetadata {
  try {
    const tags = id3.read(filePath);
    if (!tags) return {};
    return extractCommonTags(tags as Record<string, string | undefined>);
  } catch {
    return {};
  }
}

function readM4bMetadata(filePath: string): AudioMetadata {
  try {
    const output = execSync(
      `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: "utf-8" }
    );
    const parsed = JSON.parse(output);
    const format = parsed.format || {};
    if (format.tags) {
      return extractCommonTags(format.tags);
    }
    return {};
  } catch {
    return {};
  }
}

function scanFiles(
  filePaths: string[],
  format: "mp3" | "m4b",
  readMetadata: (path: string) => AudioMetadata
): AudioFile[] {
  const files: AudioFile[] = [];
  for (const filePath of filePaths) {
    let metadata = readMetadata(filePath);
    if (Object.keys(metadata).length === 0) {
      metadata = inferFromFilename(filePath);
    }
    files.push({ path: filePath, format, existingMetadata: metadata });
  }
  return files;
}

export function scanForAudioFiles(inputDir: string): AudioFile[] {
  console.log(`Scanning ${inputDir} for audio files...`);

  if (!fs.existsSync(inputDir)) {
    console.log(`Directory does not exist: ${inputDir}`);
    return [];
  }

  const mp3Files = globSync("**/*.mp3", { cwd: inputDir, absolute: true });
  const m4bFiles = globSync("**/*.m4b", { cwd: inputDir, absolute: true });

  const files = [
    ...scanFiles(mp3Files, "mp3", readMp3Metadata),
    ...scanFiles(m4bFiles, "m4b", readM4bMetadata),
  ];

  console.log(`Found ${mp3Files.length} MP3 file(s) and ${m4bFiles.length} M4B file(s).`);

  return files;
}

function groupByStem(files: AudioFile[]): Map<string, AudioFile[]> {
  const groups = new Map<string, AudioFile[]>();

  for (const file of files) {
    const basename = path.basename(file.path, path.extname(file.path));
    const stem = extractCommonStem(basename);
    const existing = groups.get(stem) || [];
    existing.push(file);
    groups.set(stem, existing);
  }

  return groups;
}

function extractCommonStem(basename: string): string {
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

    const grouped = groupByStem(dirFiles);
    for (const [stem, group] of grouped) {
      if (group.length >= 2) {
        sets.push({ commonStem: stem, files: group, directory: dir });
      }
    }
  }

  return sets;
}
