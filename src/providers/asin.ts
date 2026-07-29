import fs from "node:fs";
import path from "node:path";
import { lookupAudnexusBook } from "./audnexus.js";

const ASIN_REGEX = /^[A-Za-z0-9]{10}$/;
const ASIN_IN_TEXT = /(?:^|[\s\[\]()_/-])([A-Za-z0-9]{10})(?=$|[\s\[\]()_./-])/g;

export function validateAsin(value: string): boolean {
  if (!value) return false;
  return ASIN_REGEX.test(value);
}

export interface VerifyAsinOptions {
  asin: string;
  fetchFn?: typeof fetch;
}

export async function verifyAsin(options: VerifyAsinOptions): Promise<boolean> {
  const { asin, fetchFn } = options;

  if (!validateAsin(asin)) return false;

  const audnexusResult = await lookupAudnexusBook(asin, { fetchFn });
  return audnexusResult !== null;
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
