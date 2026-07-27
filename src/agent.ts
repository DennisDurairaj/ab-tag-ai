import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache, acquireAsin, verifyAsin } from "./providers/asin.js";
import { searchOpenLibraryAsin } from "./providers/open-library.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";
import { fetchNextCandidate } from "./providers/metadata-resolver.js";
import { downloadAndResizeCover, findLocalCoverArt } from "./providers/cover-art.js";
import { tagMultiFileSet } from "./taggers/index.js";
import { buildBookFolderPath, writeCoverArt, copyFilesToOutput } from "./utils.js";
import { inferBook } from "./inference.js";
import { createLlmVerifier } from "./verifier.js";
import type { Verifier } from "./verifier.js";
import { verifyWithRetry } from "./verify-loop.js";

const CACHE_DIR = ".wayfinder/cache";

export async function processLibrary(config: Config): Promise<void> {
  const files = scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files, config.input);

  printSummary(bookSets);

  const asinCache = createAsinCache(CACHE_DIR);
  const verifier = createLlmVerifier({ model: config.llm_model });

  for (const bookSet of bookSets) {
    await processBook(bookSet, config, asinCache, verifier);
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

async function processBook(bookSet: BookSet, config: Config, cache: ReturnType<typeof createAsinCache>, verifier: Verifier): Promise<void> {
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
    searchHardcover: async (identity, apiKey) => {
      const result = await searchHardcoverAsin(identity, apiKey);
      return result.asin;
    },
    verifyAsinFn: (asin) => verifyAsin({ asin }),
  });

  if (!asinResult.asin) {
    console.log(`  No ASIN found - flagged for manual review`);
    flagForReview(book, filePaths, config, "No ASIN could be acquired from any source");
    return;
  }

  book.asin = asinResult.asin;
  console.log(`  ASIN: ${asinResult.asin} (${asinResult.source})`);

  const sourceDir = bookSet.files.length > 0 ? path.dirname(bookSet.files[0].path) : null;
  const localCover = sourceDir ? await findLocalCoverArt(sourceDir) : null;

  const result = await verifyWithRetry({
    identity: { title: book.title, author: book.author },
    existingMetadata: bookSet.files[0].existingMetadata,
    fetcher: (skipProviders) => fetchNextCandidate({
      identity: { title: book.title, author: book.author },
      asin: asinResult.asin,
      hardcoverApiKey: config.hardcover_api_key,
      skipProviders,
    }),
    verifier,
  });

  if (result.trusted) {
    const metadata = result.metadata;
    console.log(`  Verified: ${metadata.title} by ${metadata.author}`);
    if (metadata.series) {
      console.log(`  Series: ${metadata.series} (${metadata.seriesPart})`);
    }
    console.log(`  Verifier: ${result.verdict.reason}`);

    const bookDir = buildBookFolderPath(config.output, metadata.author, metadata.title, metadata.series);

    if (config.dry_run) {
      console.log(`  [DRY-RUN] Would write cover art to ${bookDir}`);
      if (localCover) {
        console.log(`  [DRY-RUN] Would copy cover from source directory`);
      } else if (metadata.coverUrl || (metadata.coverId && metadata.coverId > 0)) {
        console.log(`  [DRY-RUN] Would download cover from provider`);
      }
      console.log(`  [DRY-RUN] Would copy ${bookSet.files.length} file(s) to ${bookDir}`);
      const tagSummary = `album="${metadata.title}", artist="${metadata.author}"` +
        (metadata.series ? `, series="${metadata.series}"` : "");
      console.log(`  [DRY-RUN] Would tag with ${tagSummary}`);
      return;
    }

    const coverArt = localCover ?? await downloadAndResizeCover({
      coverUrl: metadata.coverUrl,
      coverId: metadata.coverId,
    });
    const coverPath = writeCoverArt(coverArt, bookDir);
    if (coverPath) {
      if (localCover) {
        console.log(`  Cover art copied from source directory`);
      } else {
        console.log(`  Cover art downloaded from provider`);
      }
    }

    const copiedFiles = copyFilesToOutput(bookSet.files, bookDir);
    tagMultiFileSet(copiedFiles, metadata, coverArt ?? undefined);
    console.log(`  Copied and tagged ${copiedFiles.length} file(s) to ${bookDir}`);
    return;
  }

  if (result.verdict) {
    console.log(`  Flagged for review: ${result.verdict.reason}`);
    flagForReview(book, filePaths, config, result.verdict.reason);
  } else {
    console.log(`  Could not resolve metadata - flagged for manual review`);
    flagForReview(book, filePaths, config, "Metadata could not be resolved from any provider");
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
