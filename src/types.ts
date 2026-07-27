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
