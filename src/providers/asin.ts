import fs from "node:fs";
import path from "node:path";
import type { BookIdentity } from "../types.js";

const ASIN_REGEX = /^[A-Za-z0-9]{10}$/;
const ASIN_IN_TEXT = /(?:^|[\s\[\]()_/-])([A-Za-z0-9]{10})(?=$|[\s\[\]()_./-])/g;

export function validateAsin(value: string): boolean {
  if (!value) return false;
  return ASIN_REGEX.test(value);
}

export function extractAsinFromFilename(filename: string): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(ASIN_IN_TEXT.source, "g");
  while ((match = regex.exec(base)) !== null) {
    matches.push(match[1]);
  }
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

const AUDIBLE_URL_ASIN = /audible\.com\/(?:pd|audiobook)\/[^/]+\/([A-Za-z0-9]{10})/i;

export function extractAsinFromAudibleUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(AUDIBLE_URL_ASIN);
  if (match && validateAsin(match[1])) {
    return match[1];
  }
  return null;
}

export interface AsinCache {
  get(key: string): string | undefined;
  set(key: string, asin: string): void;
  save(): void;
}

const CACHE_FILENAME = "asin.json";

function cacheFilePath(cacheDir: string): string {
  return path.join(cacheDir, CACHE_FILENAME);
}

function loadCacheFromDisk(cacheDir: string): Record<string, string> {
  const filePath = cacheFilePath(cacheDir);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveCacheToDisk(cacheDir: string, data: Record<string, string>): void {
  const filePath = cacheFilePath(cacheDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function createAsinCache(cacheDir: string): AsinCache {
  const data: Record<string, string> = loadCacheFromDisk(cacheDir);

  return {
    get(key: string): string | undefined {
      return data[key];
    },
    set(key: string, asin: string): void {
      data[key] = asin;
    },
    save(): void {
      saveCacheToDisk(cacheDir, data);
    },
  };
}

function cacheKey(identity: BookIdentity): string {
  return `${identity.title}/${identity.author}`;
}

function cachedResult(cache: AsinCache, key: string, asin: string, source: string): AsinResult {
  cache.set(key, asin);
  return { asin, source };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AcquireAsinOptions {
  identity: BookIdentity;
  filePaths: string[];
  cache: AsinCache;
  hardcoverApiKey: string;
  searchAudnexus: (title: string, author: string) => Promise<string | null>;
  searchOpenLibrary: (title: string, author: string) => Promise<string | null>;
  searchHardcover: (title: string, author: string, apiKey: string) => Promise<string | null>;
  providerDelay?: number;
}

export interface AsinResult {
  asin: string | null;
  source: string;
}

export async function acquireAsin(options: AcquireAsinOptions): Promise<AsinResult> {
  const { identity, filePaths, cache, hardcoverApiKey, searchAudnexus, searchOpenLibrary, searchHardcover, providerDelay = 100 } = options;
  const key = cacheKey(identity);

  const cached = cache.get(key);
  if (cached) {
    return { asin: cached, source: "cache" };
  }

  const fromAudnexus = await searchAudnexus(identity.title, identity.author);
  if (fromAudnexus) {
    return cachedResult(cache, key, fromAudnexus, "audnexus");
  }
  await delay(providerDelay);

  const fromOpenLibrary = await searchOpenLibrary(identity.title, identity.author);
  if (fromOpenLibrary) {
    return cachedResult(cache, key, fromOpenLibrary, "open-library");
  }
  await delay(providerDelay);

  if (hardcoverApiKey) {
    const fromHardcover = await searchHardcover(identity.title, identity.author, hardcoverApiKey);
    if (fromHardcover) {
      return cachedResult(cache, key, fromHardcover, "hardcover");
    }
    await delay(providerDelay);
  }

  for (const filePath of filePaths) {
    const fromFilename = extractAsinFromFilename(filePath);
    if (fromFilename) {
      return cachedResult(cache, key, fromFilename, "filename");
    }
  }

  for (const filePath of filePaths) {
    const fromUrl = extractAsinFromAudibleUrl(filePath);
    if (fromUrl) {
      return cachedResult(cache, key, fromUrl, "audible-url");
    }
  }

  return { asin: null, source: "none" };
}
