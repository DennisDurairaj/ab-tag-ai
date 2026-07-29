export interface BookIdentity {
  title: string;
  author: string;
}

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  asin?: string;
}

export interface AudioFile {
  path: string;
  format: "mp3" | "m4b";
  existingMetadata: AudioMetadata;
}

export interface ResolvedMetadata {
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesSequence?: string;
  narrator?: string;
  coverUrl?: string;
  coverId?: number;
  durationMinutes?: number;
  description?: string;
  genres?: string[];
  publisher?: string;
  language?: string;
  isbn?: string;
}

export interface Book {
  path: string;
  title: string;
  author: string;
  asin: string;
}

export interface BookSet {
  books: Book[];
  files: AudioFile[];
}

export interface MultiFileSet {
  commonStem: string;
  files: AudioFile[];
  directory: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type ProviderName = "audnexus" | "open-library" | "hardcover";
