import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import type { AsinCache } from "./providers/asin.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { writeReviewFile, runWithConcurrency } from "./utils.js";
import { createAsinCache } from "./providers/asin.js";
import { inferBook } from "./inference.js";
import { createPathInterpreter } from "./path-interpreter.js";
import { deterministicSearch } from "./deterministic-search.js";
import { createVerifier } from "./verifier.js";
import { findLocalCoverArt } from "./providers/cover-art.js";
import { header, success, skipped, flagged, progress, raw, warn, error as logError } from "./logger.js";

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

  const asinCache = createAsinCache(CACHE_DIR);
  const interpretPath = createPathInterpreter({
    model: config.llm_model,
    apiKey: config.llm_api_key || "",
    apiBaseUrl: config.llm_api_base_url || undefined,
    dryRun: config.dry_run,
    outputDir: config.output,
  });

  const verifyBook = createVerifier({
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
  await runWithConcurrency(bookSets, concurrency, async (bookSet) => {
    try {
      await processBook(bookSet, config, verifyBook, fallbacks, interpretPath, asinCache);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(msg);
    }
  }, 500);

  asinCache.save();

  if (fallbacks.length > 0) {
    header("\n=== ABS FALLBACK SUMMARY ===");
    warn(`${fallbacks.length} book(s) fell back to local output:\n`);
    for (const fb of fallbacks) {
      raw(`  - "${fb.title}": ${fb.reason}`);
    }
  }
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

  success(`Found ${totalBooks} book(s) across ${totalFiles} audio file(s).`);

  for (const set of bookSets) {
    const title = set.books[0]?.title || "Unknown";
    raw(`  - "${title}": ${set.files.length} file(s)`);
  }

  if (filesMissingMetadata.length > 0) {
    warn(`Files missing metadata (${filesMissingMetadata.length}):`);
    for (const file of filesMissingMetadata) {
      raw(`  - ${file.path}`);
    }
  }
}

async function processBook(
  bookSet: BookSet,
  config: Config,
  verifyBook: ReturnType<typeof createVerifier>,
  fallbacks: Array<{ title: string; reason: string }>,
  interpretPath: ReturnType<typeof createPathInterpreter>,
  asinCache: AsinCache,
): Promise<void> {
  const book = bookSet.books[0];
  if (!book) return;

  progress(`Processing: ${book.title || "Unknown"}`);

  const firstFile = bookSet.files[0];
  const sourceDir = firstFile ? path.dirname(firstFile.path) : "";
  const localCover = await findLocalCoverArt(sourceDir);

  const pathResult = await interpretPath(bookSet);
  if (pathResult.status === "flagged") {
    flagged(`  Flagged: ${pathResult.reason}`);
    return;
  }

  book.title = pathResult.title;
  book.author = pathResult.author;

  const searchResult = await deterministicSearch(bookSet, pathResult.title, pathResult.author, {
    cache: asinCache,
    hardcoverApiKey: config.hardcover_api_key,
    outputDir: config.output,
    dryRun: config.dry_run,
    outputMode: config.output_mode,
    absUrl: config.abs_url,
    absApiToken: config.abs_api_token,
    absLibraryId: config.abs_library_id,
    localCover,
  });

  if (searchResult.status === "written") {
    const fallbackNote = searchResult.fallbackReason ? ` (fell back: ${searchResult.fallbackReason})` : "";
    success(`  Written: ${searchResult.outputDir} (${searchResult.filesWritten} files)${fallbackNote}`);
    if (searchResult.fallbackReason) {
      fallbacks.push({ title: book.title, reason: searchResult.fallbackReason });
    }
    return;
  }

  if (searchResult.status === "skipped") {
    skipped(`  Skipped: ${searchResult.reason}`);
    return;
  }

  const result = await verifyBook({
    bookSet,
    inferredTitle: searchResult.title,
    inferredAuthor: searchResult.author,
    metadata: searchResult.metadata,
    reason: searchResult.reason,
    localCover,
  });

  if (result.status === "written") {
    const fallbackNote = result.fallbackReason ? ` (fell back: ${result.fallbackReason})` : "";
    success(`  Written: ${result.outputDir} (${result.filesWritten} files)${fallbackNote}`);
    if (result.fallbackReason) {
      fallbacks.push({ title: book.title, reason: result.fallbackReason });
    }
  } else if (result.status === "skipped") {
    skipped(`  Skipped: ${result.reason}`);
  } else {
    flagged(`  Flagged: ${result.reason}`);
  }
}

export function flagForReview(book: Book, filePaths: string[], config: Config, reason: string): void {
  writeReviewFile(config.output, config.dry_run, book.title, book.author, filePaths, reason);
}
