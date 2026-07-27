import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache } from "./providers/asin.js";
import { inferBook } from "./inference.js";
import { createOrchestrator } from "./orchestrator.js";

const CACHE_DIR = ".wayfinder/cache";

export async function processLibrary(config: Config): Promise<void> {
  const files = scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files, config.input);

  printSummary(bookSets);

  const asinCache = createAsinCache(CACHE_DIR);
  const orchestrateBook = createOrchestrator({
    model: config.llm_model,
    apiKey: config.llm_api_key || undefined,
    apiBaseUrl: config.llm_api_base_url || undefined,
    hardcoverApiKey: config.hardcover_api_key,
    outputDir: config.output,
    dryRun: config.dry_run,
    cache: asinCache,
  });

  for (const bookSet of bookSets) {
    await processBook(bookSet, config, orchestrateBook);
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

async function processBook(bookSet: BookSet, _config: Config, orchestrateBook: ReturnType<typeof createOrchestrator>): Promise<void> {
  const book = bookSet.books[0];
  if (!book) return;

  console.log(`Processing: ${book.title || "Unknown"}`);

  const result = await orchestrateBook(bookSet);

  if (result.status === "written") {
    console.log(`  Written: ${result.outputDir} (${result.filesWritten} files)`);
  } else {
    console.log(`  Flagged: ${result.reason}`);
  }
}

export function flagForReview(book: Book, filePaths: string[], config: Config, reason: string): void {
  if (config.dry_run) {
    const safeName = book.title.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "unknown";
    const reviewPath = path.join(config.output, "review", `${safeName}.json`);
    console.log(`  [DRY-RUN] Would write review to ${reviewPath}: ${reason}`);
    return;
  }

  const reviewDir = path.join(config.output, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const safeName = book.title.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "unknown";
  const reviewPath = path.join(reviewDir, `${safeName}.json`);
  const reviewData = {
    title: book.title,
    author: book.author,
    files: filePaths,
    reason,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2), "utf-8");
}
