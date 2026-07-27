import type { Config } from "./config.js";

export interface Book {
  path: string;
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesPart?: number;
  coverArt?: Buffer;
}

export interface AudioFile {
  path: string;
  format: "mp3" | "m4b";
  existingMetadata: Record<string, string>;
}

export interface BookSet {
  books: Book[];
  files: AudioFile[];
}

export async function processLibrary(config: Config): Promise<void> {
  const files = await scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files);

  for (const bookSet of bookSets) {
    await processBook(bookSet, config);
  }
}

async function scanForAudioFiles(_inputDir: string): Promise<AudioFile[]> {
  return [];
}

function groupIntoBooks(_files: AudioFile[]): BookSet[] {
  return [];
}

async function processBook(_bookSet: BookSet, _config: Config): Promise<void> {
}