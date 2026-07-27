import path from "node:path";
import type { AudioFile, Book, BookIdentity } from "./types.js";
import { validateAsin } from "./providers/asin.js";

function authorFromPath(inputDir: string, filePath: string): string {
  const relative = path.relative(inputDir, filePath);
  const parts = relative.split(path.sep);
  return parts.length > 1 ? parts[0] : "";
}

export function inferBookIdentity(files: AudioFile[], inputDir: string): BookIdentity {
  const first = files[0];
  const meta = first.existingMetadata;
  const fileDir = path.dirname(first.path);
  const dirName = path.basename(fileDir);
  const isBookDir = path.resolve(fileDir) !== path.resolve(inputDir);
  const filenameStem = path.basename(first.path, path.extname(first.path)).replace(/[_-]/g, " ").trim();

  const tagTitle = (meta.title || "").trim();
  const tagAlbum = (meta.album || "").trim();
  const tagArtist = (meta.artist || "").trim();
  const title = (isBookDir ? dirName : null) || tagAlbum || tagTitle || filenameStem;
  const author = authorFromPath(inputDir, first.path) || tagArtist || "";

  return { title, author };
}

export function inferBook(files: AudioFile[], inputDir: string): Book {
  const first = files[0];
  const identity = inferBookIdentity(files, inputDir);
  const meta = first.existingMetadata;
  const existingAsin = meta.asin && validateAsin(meta.asin) ? meta.asin : "";
  return {
    path: first.path,
    title: identity.title,
    author: identity.author,
    asin: existingAsin,
  };
}
