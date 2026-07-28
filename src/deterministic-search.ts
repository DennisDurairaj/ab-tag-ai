import type { BookSet, ResolvedMetadata } from "./types.js";
import type { AsinCache } from "./providers/asin.js";
import { lookupAudnexusBook } from "./providers/audnexus.js";
import { fetchNextCandidate } from "./providers/metadata-resolver.js";
import type { OrchestratorConfig, ToolContext, OrchestrationResult } from "./orchestrator.js";
import { writeOutputForBook } from "./orchestrator.js";
import { fuzzyMatch } from "./utils.js";

export interface DeterministicSearchConfig {
  cache: AsinCache;
  hardcoverApiKey: string;
  outputDir: string;
  dryRun: boolean;
  outputMode: "local" | "audiobookshelf";
  absUrl: string;
  absApiToken: string;
  absLibraryId: string;
  localCover: Buffer | null;
  fetchFn?: typeof fetch;
}

export type DeterministicSearchResult =
  | { status: "written"; outputDir: string; filesWritten: number; fallbackReason?: string }
  | { status: "skipped"; outputDir: string; reason: string }
  | { status: "fallthrough" };

async function tryAudnexusEnrichment(
  asin: string,
  fallbackAuthor: string,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata | null> {
  const result = await lookupAudnexusBook(asin, { fetchFn });
  if (result) {
    return {
      title: result.title,
      author: result.authors[0]?.name || fallbackAuthor,
      asin: result.asin,
      narrator: result.narrators[0]?.name,
      coverUrl: result.image || undefined,
      durationMinutes: result.runtimeLengthMin,
    };
  }
  return null;
}

function toToolContext(bookSet: BookSet, config: DeterministicSearchConfig): ToolContext {
  const orchestratorConfig: OrchestratorConfig = {
    model: "",
    apiKey: "",
    apiBaseUrl: "",
    hardcoverApiKey: config.hardcoverApiKey,
    outputDir: config.outputDir,
    dryRun: config.dryRun,
    fetchFn: config.fetchFn,
    cache: config.cache,
    outputMode: config.outputMode,
    absUrl: config.absUrl,
    absApiToken: config.absApiToken,
    absLibraryId: config.absLibraryId,
  };

  return {
    bookSet,
    config: orchestratorConfig,
    cache: config.cache,
    localCover: config.localCover,
  };
}

function writeResultToSearchResult(result: OrchestrationResult): DeterministicSearchResult {
  if (result.status === "written") {
    return {
      status: "written",
      outputDir: result.outputDir,
      filesWritten: result.filesWritten,
      fallbackReason: result.fallbackReason,
    };
  }
  if (result.status === "skipped") {
    return {
      status: "skipped",
      outputDir: result.outputDir,
      reason: result.reason,
    };
  }
  return { status: "fallthrough" };
}

export async function deterministicSearch(
  bookSet: BookSet,
  resolvedTitle: string,
  resolvedAuthor: string,
  config: DeterministicSearchConfig,
): Promise<DeterministicSearchResult> {
  const key = `${resolvedTitle}/${resolvedAuthor}`;
  const fetchFn = config.fetchFn;

  const cachedAsin = config.cache.get(key);
  if (cachedAsin) {
    console.error(`  [Deterministic] Cache hit: ASIN ${cachedAsin} for "${resolvedTitle}"`);

    const enriched = await tryAudnexusEnrichment(cachedAsin, resolvedAuthor, fetchFn);
    const metadata: ResolvedMetadata = enriched ?? {
      title: resolvedTitle,
      author: resolvedAuthor,
      asin: cachedAsin,
    };

    const ctx = toToolContext(bookSet, config);
    const result = await writeOutputForBook(metadata, ctx);
    return writeResultToSearchResult(result.terminal);
  }

  console.error(`  [Deterministic] Cache miss — searching providers for "${resolvedTitle}" by ${resolvedAuthor}`);

  const result = await fetchNextCandidate({
    identity: { title: resolvedTitle, author: resolvedAuthor },
    asin: null,
    hardcoverApiKey: config.hardcoverApiKey,
    skipProviders: [],
    fetchFn,
  });

  if (!result.metadata) {
    console.error(`  [Deterministic] No provider results — falling through to orchestrator`);
    return { status: "fallthrough" };
  }

  const titleMatch = fuzzyMatch(resolvedTitle, result.metadata.title);
  const authorMatch = fuzzyMatch(resolvedAuthor, result.metadata.author);

  if (!titleMatch || !authorMatch) {
    console.error(`  [Deterministic] Fuzzy match failed (title: ${titleMatch}, author: ${authorMatch}) — falling through to orchestrator`);
    return { status: "fallthrough" };
  }

  console.error(`  [Deterministic] Match found via ${result.source} — writing output directly`);

  config.cache.set(key, result.metadata.asin);

  const ctx = toToolContext(bookSet, config);
  const writeResult = await writeOutputForBook(result.metadata, ctx);
  return writeResultToSearchResult(writeResult.terminal);
}
