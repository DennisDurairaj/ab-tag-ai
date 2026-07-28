import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import type { AsinCache } from "./providers/asin.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache } from "./providers/asin.js";
import { inferBook } from "./inference.js";
import { createOrchestrator } from "./orchestrator.js";
import { createPathInterpreter } from "./path-interpreter.js";
import { deterministicSearch } from "./deterministic-search.js";
import { findLocalCoverArt } from "./providers/cover-art.js";

const CACHE_DIR = ".wayfinder/cache";

async function scanFilteredFiles(inputDir: string, include: string[]): Promise<AudioFile[]> {
  const allFiles: AudioFile[] = [];
  for (const pattern of include) {
    const dir = path.join(inputDir, pattern);
    allFiles.push(...await scanForAudioFiles(dir));
  }
  return allFiles;
}

export async function processLibrary(config: Config): Promise<void> {
  const files = config.include.length > 0
    ? await scanFilteredFiles(config.input, config.include)
    : await scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files, config.input);

  printSummary(bookSets);

  printSummary(bookSets);

  const asinCache = createAsinCache(CACHE_DIR);
  const interpretPath = createPathInterpreter({
    model: config.llm_model,
    apiKey: config.llm_api_key || "",
    apiBaseUrl: config.llm_api_base_url || undefined,
    dryRun: config.dry_run,
    outputDir: config.output,
  });
  const orchestrateBook = createOrchestrator({
    model: config.llm_model,
    apiKey: config.llm_api_key || undefined,
    apiBaseUrl: config.llm_api_base_url || undefined,
    hardcoverApiKey: config.hardcover_api_key,
    outputDir: config.output,
    dryRun: config.dry_run,
    cache: asinCache,
    outputMode: config.output_mode,
    absUrl: config.abs_url,
    absApiToken: config.abs_api_token,
    absLibraryId: config.abs_library_id,
  });

  const fallbacks: Array<{ title: string; reason: string }> = [];

  const concurrency = Math.max(1, config.concurrency);
  await processWithConcurrency(bookSets, concurrency, (bookSet) =>
    processBook(bookSet, config, orchestrateBook, fallbacks, interpretPath, asinCache)
  );

  asinCache.save();

  if (fallbacks.length > 0) {
    console.log("\n=== ABS FALLBACK SUMMARY ===");
    console.log(`${fallbacks.length} book(s) fell back to local output:\n`);
    for (const fb of fallbacks) {
      console.log(`  - "${fb.title}": ${fb.reason}`);
    }
  }
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  let active = 0;
  let index = 0;
  let started = 0;

  return new Promise((resolve) => {
    function next() {
      while (active < concurrency && index < queue.length) {
        const item = queue[index++];
        const delay = started++ * 500;
        active++;
        const run = () => fn(item).finally(() => {
          active--;
          next();
        });
        if (delay > 0) {
          setTimeout(run, delay);
        } else {
          run();
        }
      }
      if (active === 0 && index >= queue.length) {
        resolve();
      }
    }
    next();
  });
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

async function processBook(
  bookSet: BookSet,
  _config: Config,
  orchestrateBook: ReturnType<typeof createOrchestrator>,
  fallbacks: Array<{ title: string; reason: string }>,
  interpretPath: ReturnType<typeof createPathInterpreter>,
  asinCache: AsinCache,
): Promise<void> {
  const book = bookSet.books[0];
  if (!book) return;

  console.log(`Processing: ${book.title || "Unknown"}`);

  const firstFile = bookSet.files[0];
  const sourceDir = firstFile ? path.dirname(firstFile.path) : "";
  const localCover = await findLocalCoverArt(sourceDir);

  const pathResult = await interpretPath(bookSet);
  if (pathResult.status === "flagged") {
    console.log(`  Flagged: ${pathResult.reason}`);
    return;
  }

  book.title = pathResult.title;
  book.author = pathResult.author;

  const searchResult = await deterministicSearch(bookSet, pathResult.title, pathResult.author, {
    cache: asinCache,
    hardcoverApiKey: _config.hardcover_api_key,
    outputDir: _config.output,
    dryRun: _config.dry_run,
    outputMode: _config.output_mode,
    absUrl: _config.abs_url,
    absApiToken: _config.abs_api_token,
    absLibraryId: _config.abs_library_id,
    localCover,
  });

  if (searchResult.status === "written") {
    const fallbackNote = searchResult.fallbackReason ? ` (fell back: ${searchResult.fallbackReason})` : "";
    console.log(`  Written: ${searchResult.outputDir} (${searchResult.filesWritten} files)${fallbackNote}`);
    if (searchResult.fallbackReason) {
      fallbacks.push({ title: book.title, reason: searchResult.fallbackReason });
    }
    return;
  }

  if (searchResult.status === "skipped") {
    console.log(`  Skipped: ${searchResult.reason}`);
    return;
  }

  const result = await orchestrateBook(bookSet, localCover);

  if (result.status === "written") {
    const fallbackNote = result.fallbackReason ? ` (fell back: ${result.fallbackReason})` : "";
    console.log(`  Written: ${result.outputDir} (${result.filesWritten} files)${fallbackNote}`);
    if (result.fallbackReason) {
      fallbacks.push({ title: book.title, reason: result.fallbackReason });
    }
  } else if (result.status === "skipped") {
    console.log(`  Skipped: ${result.reason}`);
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
