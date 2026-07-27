import fs from "node:fs";
import path from "node:path";
import id3 from "node-id3";
import type { AudioFile, ResolvedMetadata } from "../types.js";

export interface Id3TagOptions {
  title: string;
  album: string;
  artist: string;
  trackNumber: string;
  series?: string;
  seriesPart?: string;
  coverArt?: Buffer;
}

export interface TrackedFile extends AudioFile {
  trackNumber: number;
}

export function assignTrackNumbers(files: AudioFile[]): TrackedFile[] {
  if (files.length === 0) return [];

  const sorted = [...files].sort((a, b) => {
    const nameA = path.basename(a.path);
    const nameB = path.basename(b.path);
    return nameA.localeCompare(nameB);
  });

  return sorted.map((file, index) => ({
    ...file,
    trackNumber: index + 1,
  }));
}

export function writeId3Tags(filePath: string, options: Id3TagOptions): boolean {
  if (!fs.existsSync(filePath)) return false;

  const tags: Record<string, unknown> = {
    title: options.title,
    album: options.album,
    artist: options.artist,
    trackNumber: options.trackNumber,
  };

  if (options.series || options.seriesPart) {
    const userDefinedText: Array<{ description: string; value: string }> = [];
    if (options.series) {
      userDefinedText.push({ description: "series", value: options.series });
    }
    if (options.seriesPart) {
      userDefinedText.push({ description: "series-part", value: options.seriesPart });
    }
    tags.userDefinedText = userDefinedText;
  }

  if (options.coverArt) {
    tags.image = {
      mime: "image/jpeg",
      type: {
        id: 3,
        name: "front cover",
      },
      description: "Cover art",
      imageBuffer: options.coverArt,
    };
  }

  try {
    const result = id3.write(tags, filePath);
    return result === true;
  } catch {
    return false;
  }
}

export function tagMultiFileSet(
  files: AudioFile[],
  metadata: ResolvedMetadata,
  coverArt?: Buffer,
): void {
  const trackedFiles = assignTrackNumbers(files);

  for (const file of trackedFiles) {
    const fileTitle = file.existingMetadata.title || path.basename(file.path, path.extname(file.path));

    writeId3Tags(file.path, {
      title: fileTitle,
      album: metadata.title,
      artist: metadata.author,
      trackNumber: String(file.trackNumber),
      series: metadata.series,
      seriesPart: metadata.seriesPart,
      coverArt,
    });
  }
}
