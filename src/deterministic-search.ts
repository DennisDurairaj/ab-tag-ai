import type { BookSet, ResolvedMetadata, BookIdentity } from "./types.js";
import type { AsinCache } from "./providers/asin.js";
import { lookupAudnexusBook } from "./providers/audnexus.js";
import { searchOpenLibraryAsin, searchOpenLibraryByIsbn } from "./providers/open-library.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";
import { searchAudibleCatalog } from "./providers/audible.js";
import type { OrchestratorConfig, ToolContext, OrchestrationResult } from "./orchestrator.js";
import { writeOutputForBook } from "./orchestrator.js";
import { fuzzyMatch, delay } from "./utils.js";
import { tagged } from "./logger.js";

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
  language?: string;
  fetchFn?: typeof fetch;
}

export type DeterministicSearchResult =
  | { status: "written"; outputDir: string; filesWritten: number; fallbackReason?: string }
  | { status: "skipped"; outputDir: string; reason: string }
  | { status: "fallthrough"; metadata: ResolvedMetadata | null; title: string; author: string; reason: string };

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
      description: result.description || undefined,
      genres: result.genres?.map((g) => g.name) || undefined,
      publisher: result.publisherName || undefined,
      language: result.language || undefined,
      isbn: result.isbn || undefined,
    };
  }
  await delay(600);
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

function writeResultToSearchResult(
  result: OrchestrationResult,
  fallthroughMeta?: { metadata: ResolvedMetadata; title: string; author: string; reason: string },
): DeterministicSearchResult {
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
  if (fallthroughMeta) {
    return { status: "fallthrough", ...fallthroughMeta };
  }
  return { status: "fallthrough", metadata: null, title: "", author: "", reason: "Output flagged" };
}

async function fetchOlCoverId(olAsin: string | null, fetchFn?: typeof fetch): Promise<number | undefined> {
  if (!olAsin) return undefined;
  const olBook = await searchOpenLibraryByIsbn(olAsin, fetchFn);
  if (olBook?.coverId && olBook.coverId > 0) {
    return olBook.coverId;
  }
  return undefined;
}

const SENTINEL_HC = { asin: null, series: undefined, seriesSequence: undefined } as const;

export interface RoutingConfig {
  providers: ("audible" | "ol" | "hc")[];
  audibleRegion: string;
}

export function resolveRouting(language?: string): RoutingConfig {
  switch (language) {
    case "es":
      return { providers: ["audible", "ol", "hc"], audibleRegion: "es" };
    default:
      return { providers: ["audible", "ol", "hc"], audibleRegion: "com" };
  }
}

async function parallelSearchAndMerge(
  identity: BookIdentity,
  hardcoverApiKey: string,
  resolvedAuthor: string,
  fetchFn?: typeof fetch,
  language?: string,
): Promise<ResolvedMetadata | null> {
  const routing = resolveRouting(language);
  const includeAudible = routing.providers.includes("audible");
  const includeOL = routing.providers.includes("ol");
  const includeHC = routing.providers.includes("hc");

  const [audibleResult, olAsin, hcResult] = await Promise.all([
    includeAudible
      ? searchAudibleCatalog(identity, { fetchFn, region: routing.audibleRegion })
      : Promise.resolve(null),
    includeOL ? searchOpenLibraryAsin(identity, fetchFn) : Promise.resolve(null),
    includeHC && hardcoverApiKey
      ? searchHardcoverAsin(identity, hardcoverApiKey, fetchFn)
      : Promise.resolve(SENTINEL_HC),
  ]);

  if (hardcoverApiKey) {
    await delay(1000);
  }

  let asin: string | null = null;
  let series: string | undefined;
  let seriesSequence: string | undefined;

  if (audibleResult) {
    asin = audibleResult.asin;

    if (audibleResult.series.length > 0) {
      series = audibleResult.series[0].name;
      seriesSequence = audibleResult.series[0].sequence;
    }

    const meta: ResolvedMetadata = {
      title: audibleResult.title,
      author: audibleResult.authors[0]?.name || identity.author,
      asin: audibleResult.asin,
      narrator: audibleResult.narrators[0]?.name,
      coverUrl: audibleResult.coverUrl || undefined,
      durationMinutes: audibleResult.durationMinutes || undefined,
      description: audibleResult.description || undefined,
      genres: audibleResult.genres.length > 0 ? audibleResult.genres : undefined,
      publisher: audibleResult.publisher || undefined,
      language: audibleResult.language || undefined,
      isbn: audibleResult.isbn || undefined,
    };

    const coverId = await fetchOlCoverId(olAsin, fetchFn);

    if (hcResult.series) {
      if (!series) series = hcResult.series;
      if (!seriesSequence) seriesSequence = hcResult.seriesSequence;
    }

    if (series) meta.series = series;
    if (seriesSequence) meta.seriesSequence = seriesSequence;
    if (coverId) meta.coverId = coverId;

    return meta;
  }

  if (olAsin) {
    asin = olAsin;
  }

  if (hcResult.asin) {
    if (!asin) asin = hcResult.asin;
    if (hcResult.series) series = hcResult.series;
    if (hcResult.seriesSequence) seriesSequence = hcResult.seriesSequence;
  }

  if (!asin) return null;

  const enriched = await tryAudnexusEnrichment(asin, resolvedAuthor, fetchFn);
  const metadata: ResolvedMetadata = enriched ?? {
    title: identity.title,
    author: identity.author,
    asin,
  };

  const coverId = await fetchOlCoverId(olAsin, fetchFn);

  if (series) metadata.series = series;
  if (seriesSequence) metadata.seriesSequence = seriesSequence;
  if (coverId) metadata.coverId = coverId;

  return metadata;
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
    tagged("Deterministic", `Cache hit: ASIN ${cachedAsin} for "${resolvedTitle}"`, "green");

    const enriched = await tryAudnexusEnrichment(cachedAsin, resolvedAuthor, fetchFn);
    const metadata: ResolvedMetadata = enriched ?? {
      title: resolvedTitle,
      author: resolvedAuthor,
      asin: cachedAsin,
    };

    const ctx = toToolContext(bookSet, config);
    const result = await writeOutputForBook(metadata, ctx);
    return writeResultToSearchResult(result.terminal, {
      metadata, title: resolvedTitle, author: resolvedAuthor,
      reason: "Cache hit write_output returned flagged",
    });
  }

  tagged("Deterministic", `Cache miss — searching Audible + OL + HC in parallel for "${resolvedTitle}" by ${resolvedAuthor}`, "cyan");

  const metadata = await parallelSearchAndMerge(
    { title: resolvedTitle, author: resolvedAuthor },
    config.hardcoverApiKey,
    resolvedAuthor,
    fetchFn,
    config.language,
  );

  if (!metadata) {
    tagged("Deterministic", "No ASIN from providers — falling through to verifier", "yellow");
    return { status: "fallthrough", metadata: null, title: resolvedTitle, author: resolvedAuthor, reason: "No ASIN found from any provider" };
  }

  const titleMatch = fuzzyMatch(resolvedTitle, metadata.title);
  const authorMatch = fuzzyMatch(resolvedAuthor, metadata.author);

  if (!titleMatch || !authorMatch) {
    const parts: string[] = [];
    if (!titleMatch) parts.push(`title mismatch: "${resolvedTitle}" vs "${metadata.title}"`);
    if (!authorMatch) parts.push(`author mismatch: "${resolvedAuthor}" vs "${metadata.author}"`);
    const reason = `Fuzzy match failed (${parts.join("; ")})`;
    tagged("Deterministic", `${reason} — falling through to verifier`, "yellow");
    return { status: "fallthrough", metadata, title: resolvedTitle, author: resolvedAuthor, reason };
  }

  tagged("Deterministic", "Match found — writing output directly", "green");

  config.cache.set(key, metadata.asin);

  const ctx = toToolContext(bookSet, config);
  const writeResult = await writeOutputForBook(metadata, ctx);
  return writeResultToSearchResult(writeResult.terminal, {
    metadata, title: resolvedTitle, author: resolvedAuthor,
    reason: "Match write_output returned flagged",
  });
}
