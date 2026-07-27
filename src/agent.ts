import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache, acquireAsin, verifyAsin } from "./providers/asin.js";
import { searchOpenLibraryAsin } from "./providers/open-library.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";
import { resolveMetadata } from "./providers/metadata-resolver.js";
import { downloadAndResizeCover } from "./providers/cover-art.js";
import { tagMultiFileSet } from "./taggers/index.js";
import { buildBookFolderPath, writeCoverArt } from "./utils.js";
import { inferBook } from "./inference.js";

const CACHE_DIR = ".wayfinder/cache";

export async function processLibrary(config: Config): Promise<void> {
  const files = scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files, config.input);

  printSummary(bookSets);

  const asinCache = createAsinCache(CACHE_DIR);

  for (const bookSet of bookSets) {
    await processBook(bookSet, config, asinCache);
  }

  asinCache.save();
}

function groupIntoBooks(files: AudioFile[], inputDir: string): BookSet[] {
  const sets = detectMultiFileSets(files);
  const result: BookSet[] = [];

  const multiFilePaths = new Set<string>();
  for (const set of sets) {
    for (const file of set.files) {
      multiFilePaths.add(file.path);
    }
  }

  for (const set of sets) {
    const book = inferBook(set.files, inputDir);
    result.push({ books: [book], files: set.files });
  }

  for (const file of files) {
    if (!multiFilePaths.has(file.path)) {
      const book = inferBook([file], inputDir);
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

  for (const set of bookSets) {
    const title = set.books[0]?.title || "Unknown";
    console.log(`  - "${title}": ${set.files.length} file(s)`);
  }

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

  const filePaths = bookSet.files.map((f) => f.path);

  const asinResult = await acquireAsin({
    identity: { title: book.title, author: book.author },
    filePaths,
    cache,
    hardcoverApiKey: config.hardcover_api_key,
    existingAsin: book.asin || undefined,
    searchOpenLibrary: searchOpenLibraryAsin,
    searchHardcover: searchHardcoverAsin,
    verifyAsinFn: (asin, identity) => verifyAsin({ asin, identity }),
  });

  if (!asinResult.asin) {
    console.log(`  No ASIN found - flagged for manual review`);
    flagForReview(book, filePaths, config);
    return;
  }

  book.asin = asinResult.asin;
  console.log(`  ASIN: ${asinResult.asin} (${asinResult.source})`);

  const metadataResult = await resolveMetadata({
    identity: { title: book.title, author: book.author },
    asin: asinResult.asin,
    hardcoverApiKey: config.hardcover_api_key,
  });

  if (!metadataResult.metadata) {
    console.log(`  Could not resolve metadata - flagged for manual review`);
    flagForReview(book, filePaths, config);
    return;
  }

  const metadata = metadataResult.metadata;
  console.log(`  Title: ${metadata.title}`);
  console.log(`  Author: ${metadata.author}`);
  if (metadata.series) {
    console.log(`  Series: ${metadata.series} (${metadata.seriesPart})`);
  }

  const coverArt = await downloadAndResizeCover({
    coverUrl: metadata.coverUrl,
    coverId: metadata.coverId,
  });

  if (coverArt) {
    console.log(`  Cover art downloaded (${coverArt.length} bytes)`);
  }

  const bookDir = buildBookFolderPath(config.output, metadata.author, metadata.title, metadata.series);
  const coverPath = writeCoverArt(coverArt, bookDir);
  if (coverPath) {
    console.log(`  Cover art written to ${coverPath}`);
  }

  tagMultiFileSet(bookSet.files, metadata, coverArt ?? undefined);
  console.log(`  Tags written to ${bookSet.files.length} file(s)`);
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
