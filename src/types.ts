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
  seriesPart?: string;
  narrator?: string;
  coverUrl?: string;
  coverId?: number;
  durationMinutes?: number;
}

export interface Book extends ResolvedMetadata {
  path: string;
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
