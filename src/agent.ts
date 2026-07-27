import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache, acquireAsin } from "./providers/asin.js";
import { searchOpenLibraryAsin } from "./providers/open-library.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";

const CACHE_DIR = ".wayfinder/cache";

export async function processLibrary(config: Config): Promise<void> {
  const files = scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files);

  printSummary(bookSets);

  const asinCache = createAsinCache(CACHE_DIR);

  for (const bookSet of bookSets) {
    await processBook(bookSet, config, asinCache);
  }

  asinCache.save();
}

function inferBook(files: AudioFile[]): Book {
  const first = files[0];
  const meta = first.existingMetadata;
  let title = meta.title || meta.album || "";
  let author = meta.artist || "";
  if (!title) {
    title = first.path;
  }
  return {
    path: first.path,
    title,
    author,
    asin: "",
  };
}

function groupIntoBooks(files: AudioFile[]): BookSet[] {
  const sets = detectMultiFileSets(files);
  const result: BookSet[] = [];

  const multiFilePaths = new Set<string>();
  for (const set of sets) {
    for (const file of set.files) {
      multiFilePaths.add(file.path);
    }
  }

  for (const set of sets) {
    const book = inferBook(set.files);
    result.push({ books: [book], files: set.files });
  }

  for (const file of files) {
    if (!multiFilePaths.has(file.path)) {
      const book = inferBook([file]);
      result.push({ books: [book], files: [file] });
    }
  }

  return result;
}

function printSummary(bookSets: BookSet[]): void {
  const totalBooks = bookSets.length;
  const totalFiles = bookSets.reduce((sum, set) => sum + set.files.length, 0);
  const filesMissingMetadata = bookSets.flatMap((set) =>
    set.files.filter((f) => Object.keys(f.existingMetadata).length === 0)
  );

  console.log(`Found ${totalBooks} book(s) across ${totalFiles} audio file(s).`);

  if (filesMissingMetadata.length > 0) {
    console.log(`Files missing metadata (${filesMissingMetadata.length}):`);
    for (const file of filesMissingMetadata) {
      console.log(`  - ${file.path}`);
    }
  }
}

async function processBook(bookSet: BookSet, config: Config, cache: ReturnType<typeof createAsinCache>): Promise<void> {
  const book = bookSet.books[0];
  if (!book) return;

  console.log(`Processing: ${book.title || "Unknown"}`);

  const result = await acquireAsin({
    title: book.title,
    author: book.author,
    filePaths: bookSet.files.map((f) => f.path),
    cache,
    hardcoverApiKey: config.hardcover_api_key,
    searchOpenLibrary: searchOpenLibraryAsin,
    searchHardcover: searchHardcoverAsin,
  });

  if (result.asin) {
    book.asin = result.asin;
    console.log(`  ASIN: ${result.asin} (${result.source})`);
  } else {
    console.log(`  No ASIN found - flagged for manual review`);
    flagForReview(book, bookSet.files.map((f) => f.path), config);
  }
}

function flagForReview(book: Book, filePaths: string[], config: Config): void {
  const reviewDir = path.join(config.output, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const safeName = book.title.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "unknown";
  const reviewPath = path.join(reviewDir, `${safeName}.json`);
  const reviewData = {
    title: book.title,
    author: book.author,
    files: filePaths,
    reason: "No ASIN could be acquired from any source",
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2), "utf-8");
}
