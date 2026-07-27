import type { BookIdentity, ResolvedMetadata } from "../types.js";
import { lookupAudnexusBook } from "./audnexus.js";
import { searchOpenLibraryAsin, searchOpenLibraryByIsbn } from "./open-library.js";
import { searchHardcoverAsin } from "./hardcover.js";
import { delay } from "../utils.js";

export interface ResolveMetadataOptions {
  identity: BookIdentity;
  asin: string | null;
  hardcoverApiKey: string;
  fetchFn?: typeof fetch;
}

export interface ResolveMetadataResult {
  metadata: ResolvedMetadata | null;
  source: string;
}

export interface FetchNextCandidateOptions {
  identity: BookIdentity;
  asin: string | null;
  hardcoverApiKey: string;
  skipProviders: string[];
  fetchFn?: typeof fetch;
}

async function tryAudnexusEnrichment(
  asin: string,
  identity: BookIdentity,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata | null> {
  const result = await lookupAudnexusBook(asin, { fetchFn });
  if (result) {
    return {
      title: result.title,
      author: result.authors[0]?.name || identity.author,
      asin: result.asin,
      narrator: result.narrators[0]?.name,
      coverUrl: result.image || undefined,
      durationMinutes: result.runtimeLengthMin,
    };
  }
  await delay(600);
  return null;
}

async function fetchFromAudnexus(
  asin: string,
  identity: BookIdentity,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata | null> {
  return tryAudnexusEnrichment(asin, identity, fetchFn);
}

async function fetchFromOpenLibrary(
  identity: BookIdentity,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata | null> {
  const olAsin = await searchOpenLibraryAsin(identity, fetchFn);
  if (!olAsin) return null;

  const olBook = await searchOpenLibraryByIsbn(olAsin, fetchFn);

  const enriched = await tryAudnexusEnrichment(olAsin, {
    title: olBook?.title || identity.title,
    author: olBook?.authorName[0] || identity.author,
  }, fetchFn);

  if (enriched) {
    if (olBook?.coverId && olBook.coverId > 0) {
      enriched.coverId = olBook.coverId;
    }
    return enriched;
  }

  return {
    title: olBook?.title || identity.title,
    author: olBook?.authorName[0] || identity.author,
    asin: olAsin,
    coverId: olBook?.coverId && olBook.coverId > 0 ? olBook.coverId : undefined,
  };
}

async function fetchFromHardcover(
  identity: BookIdentity,
  apiKey: string,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata | null> {
  const hcAsin = await searchHardcoverAsin(identity, apiKey, fetchFn);
  if (!hcAsin) {
    await delay(1000);
    return null;
  }

  const enriched = await tryAudnexusEnrichment(hcAsin, identity, fetchFn);
  if (enriched) return enriched;

  return {
    title: identity.title,
    author: identity.author,
    asin: hcAsin,
  };
}

export async function fetchNextCandidate(
  options: FetchNextCandidateOptions,
): Promise<ResolveMetadataResult> {
  const { identity, asin, hardcoverApiKey, skipProviders, fetchFn } = options;

  if (asin && !skipProviders.includes("audnexus")) {
    const metadata = await fetchFromAudnexus(asin, identity, fetchFn);
    if (metadata) return { metadata, source: "audnexus" };
  }

  if (!skipProviders.includes("open-library")) {
    const metadata = await fetchFromOpenLibrary(identity, fetchFn);
    if (metadata) return { metadata, source: "open-library" };
  }

  if (hardcoverApiKey && !skipProviders.includes("hardcover")) {
    const metadata = await fetchFromHardcover(identity, hardcoverApiKey, fetchFn);
    if (metadata) return { metadata, source: "hardcover" };
  }

  return { metadata: null, source: "none" };
}

export async function resolveMetadata(
  options: ResolveMetadataOptions,
): Promise<ResolveMetadataResult> {
  return fetchNextCandidate({
    identity: options.identity,
    asin: options.asin,
    hardcoverApiKey: options.hardcoverApiKey,
    skipProviders: [],
    fetchFn: options.fetchFn,
  });
}
