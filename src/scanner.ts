import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { globSync } from "glob";
import id3 from "node-id3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AudioFile, AudioMetadata, MultiFileSet } from "./types.js";
import { progress, error as logError, success } from "./logger.js";
import { runWithConcurrency } from "./utils.js";

const execFileAsync = promisify(execFile);

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

async function readM4bMetadata(filePath: string): Promise<AudioMetadata> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "quiet", "-print_format", "json", "-show_format", filePath],
    );
    const parsed = JSON.parse(stdout);
    const format = parsed.format || {};
    if (format.tags) {
      return extractCommonTags(format.tags);
    }
    return {};
  } catch {
    return {};
  }
}

async function scanFiles(
  filePaths: string[],
  format: "mp3" | "m4b",
  readMetadata: (filePath: string) => AudioMetadata | Promise<AudioMetadata>,
  concurrency: number,
): Promise<AudioFile[]> {
  if (filePaths.length === 0) return [];

  const typedRead = readMetadata as (filePath: string) => Promise<AudioMetadata>;
  const metadataResults = await runWithConcurrency(filePaths, concurrency, async (fp) => {
    let metadata = await typedRead(fp);
    if (Object.keys(metadata).length === 0) {
      metadata = inferFromFilename(fp);
    }
    return metadata;
  });

  return filePaths.map((fp, i) => ({
    path: fp,
    format,
    existingMetadata: metadataResults[i],
  }));
}

export async function scanForAudioFiles(inputDir: string, concurrency = 8): Promise<AudioFile[]> {
  progress(`Scanning ${inputDir} for audio files...`);

  if (!fs.existsSync(inputDir)) {
    logError(`Directory does not exist: ${inputDir}`);
    return [];
  }

  const mp3Files = globSync("**/*.mp3", { cwd: inputDir, absolute: true });
  const m4bFiles = globSync("**/*.m4b", { cwd: inputDir, absolute: true });

  const [mp3Results, m4bResults] = await Promise.all([
    scanFiles(mp3Files, "mp3", readMp3Metadata, concurrency),
    scanFiles(m4bFiles, "m4b", readM4bMetadata, concurrency),
  ]);

  const files = [...mp3Results, ...m4bResults];

  success(`Found ${mp3Files.length} MP3 file(s) and ${m4bFiles.length} M4B file(s).`);

  return files;
}

function pushToMapGroup<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key) || [];
  existing.push(value);
  map.set(key, existing);
}

function groupByStem(files: AudioFile[]): Map<string, AudioFile[]> {
  const groups = new Map<string, AudioFile[]>();

  for (const file of files) {
    const basename = path.basename(file.path, path.extname(file.path));
    const stem = extractCommonStem(basename);
    pushToMapGroup(groups, stem, file);
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
    pushToMapGroup(byDir, dir, file);
  }

  const sets: MultiFileSet[] = [];

  for (const [dir, dirFiles] of byDir) {
    if (dirFiles.length < 2) continue;

    const grouped = groupByStem(dirFiles);
    let hasGroup = false;
    for (const [stem, group] of grouped) {
      if (group.length >= 2) {
        sets.push({ commonStem: stem, files: group, directory: dir });
        hasGroup = true;
      }
    }

    if (!hasGroup) {
      sets.push({ commonStem: path.basename(dir), files: dirFiles, directory: dir });
    }
  }

  return sets;
}
