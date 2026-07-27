import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { BookSet, AudioFile, Book } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";
import { createAsinCache, acquireAsin, verifyAsin } from "./providers/asin.js";
import { searchOpenLibraryAsin } from "./providers/open-library.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";
import { fetchNextCandidate } from "./providers/metadata-resolver.js";
import { inferBook } from "./inference.js";
import { createLlmVerifier } from "./verifier.js";
import type { Verifier, VerificationResult } from "./verifier.js";

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
    searchHardcover: searchHardcoverAsin,
    verifyAsinFn: (asin) => verifyAsin({ asin }),
  });

  if (!asinResult.asin) {
    console.log(`  No ASIN found - flagged for manual review`);
    flagForReview(book, filePaths, config, "No ASIN could be acquired from any source");
    return;
  }

  book.asin = asinResult.asin;
  console.log(`  ASIN: ${asinResult.asin} (${asinResult.source})`);

  const skipProviders: string[] = [];
  let lastVerdict: VerificationResult | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const candidateResult = await fetchNextCandidate({
      identity: { title: book.title, author: book.author },
      asin: asinResult.asin,
      hardcoverApiKey: config.hardcover_api_key,
      skipProviders,
    });

    if (!candidateResult.metadata) break;

    skipProviders.push(candidateResult.source);

    const verdict = await verifier({
      identity: { title: book.title, author: book.author },
      existingMetadata: bookSet.files[0].existingMetadata,
      candidate: candidateResult.metadata,
    });

    lastVerdict = verdict;

    if (verdict.verdict === "trust") {
      const metadata = candidateResult.metadata;
      console.log(`  Verified: ${metadata.title} by ${metadata.author}`);
      if (metadata.series) {
        console.log(`  Series: ${metadata.series} (${metadata.seriesPart})`);
      }
      console.log(`  Verifier: ${verdict.reason}`);
      return;
    }

    if (verdict.verdict === "flag") break;

    console.log(`  Retry requested (${candidateResult.source}): ${verdict.reason}`);
  }

  if (lastVerdict) {
    console.log(`  Flagged for review: ${lastVerdict.reason}`);
    flagForReview(book, filePaths, config, lastVerdict.reason);
  } else {
    console.log(`  Could not resolve metadata - flagged for manual review`);
    flagForReview(book, filePaths, config, "Metadata could not be resolved from any provider");
  }
}

function flagForReview(book: Book, filePaths: string[], config: Config, reason: string): void {
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
