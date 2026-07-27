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

async function enrichWithAudnexus(
  asin: string,
  identity: BookIdentity,
  fetchFn?: typeof fetch,
): Promise<ResolvedMetadata> {
  const audnexusResult = await lookupAudnexusBook(asin, { fetchFn });
  if (audnexusResult) {
    return {
      title: audnexusResult.title,
      author: audnexusResult.authors[0]?.name || identity.author,
      asin: audnexusResult.asin,
      narrator: audnexusResult.narrators[0]?.name,
      coverUrl: audnexusResult.image || undefined,
      durationMinutes: audnexusResult.runtimeLengthMin,
    };
  }
  await delay(600);
  return {
    title: identity.title,
    author: identity.author,
    asin,
  };
}

export async function resolveMetadata(
  options: ResolveMetadataOptions,
): Promise<ResolveMetadataResult> {
  const { identity, asin, hardcoverApiKey, fetchFn } = options;

  if (asin) {
    const metadata = await enrichWithAudnexus(asin, identity, fetchFn);
    return { metadata, source: "audnexus" };
  }

  const olAsin = await searchOpenLibraryAsin(identity.title, identity.author, fetchFn);
  if (olAsin) {
    const olBook = await searchOpenLibraryByIsbn(olAsin, fetchFn);
    const metadata = await enrichWithAudnexus(olAsin, {
      title: olBook?.title || identity.title,
      author: olBook?.authorName[0] || identity.author,
    }, fetchFn);
    if (olBook?.coverId && olBook.coverId > 0) {
      metadata.coverId = olBook.coverId;
    }
    return { metadata, source: "open-library" };
  }

  if (hardcoverApiKey) {
    const hcAsin = await searchHardcoverAsin(identity.title, identity.author, hardcoverApiKey, fetchFn);
    if (hcAsin) {
      const metadata = await enrichWithAudnexus(hcAsin, identity, fetchFn);
      return { metadata, source: "hardcover" };
    }
    await delay(1000);
  }

  return { metadata: null, source: "none" };
}
