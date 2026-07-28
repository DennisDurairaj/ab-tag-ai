import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, ResolvedMetadata } from "./types.js";
import { validateAsin } from "./providers/asin.js";
import { searchHardcoverAsin } from "./providers/hardcover.js";
import { lookupAudnexusBook } from "./providers/audnexus.js";
import { findLocalCoverArt, downloadAndResizeCover } from "./providers/cover-art.js";
import { buildBookFolderPath, writeCoverArt, copyFilesToOutput, delay } from "./utils.js";
import { tagMultiFileSet, assignTrackNumbers } from "./taggers/index.js";
import type { AsinCache } from "./providers/asin.js";
import { flagForReview } from "./agent.js";
import { createAbsClient, AbsServerError, AbsAuthError, AbsNotFoundError, AbsRateLimitError } from "./providers/abs-client.js";
import type { AbsClient, AbsSearchResult } from "./providers/abs-client.js";

interface OrchestratorConfig {
  model: string;
  apiKey?: string;
  apiBaseUrl?: string;
  hardcoverApiKey: string;
  outputDir: string;
  dryRun: boolean;
  fetchFn?: typeof fetch;
  cache: AsinCache;
  outputMode: "local" | "audiobookshelf";
  absUrl: string;
  absApiToken: string;
  absLibraryId: string;
}

type OrchestrationResult =
  | { status: "written"; outputDir: string; filesWritten: number; fallbackReason?: string }
  | { status: "skipped"; outputDir: string; reason: string }
  | { status: "flagged"; reason: string };

interface ToolContext {
  bookSet: BookSet;
  config: OrchestratorConfig;
  cache: AsinCache;
  localCover: Buffer | null;
}

interface ToolCallRecord {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

const MAX_ITERATIONS = 30;

const SYSTEM_PROMPT = `You are an audiobook metadata organizer. Given a book folder, determine the correct author and title from the path structure (Author/Series/Book/ or Author/Book/). The first path segment is always the author. Search providers and either write tagged output or flag for review.

Rules:
- The folder path is ground truth for author and title. Override any conflicting data.
- ID3 tags are unreliable — artists are often narrators, titles may be filenames. Use them only as a last resort and verify before trusting.
- After finding an ASIN, try fetch_audnexus to enrich with narrator and cover art, but it is OPTIONAL. If Audnexus fails, proceed with write_output using the ASIN from search providers.
- Call write_output when you have a matching title and author with a valid ASIN, even without narrator/cover.
- Call flag_for_review only when you cannot find any ASIN from any provider, or when the provider's title/author clearly do not match the folder path.
- Decide quickly — 2-3 search attempts maximum. Do not retry with the same query.
- Do not fabricate metadata. Everything must come from a tool result.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_open_library",
      description: "Search Open Library for audiobook ASIN by title and author. Returns candidates with ASIN, title, authors, and cover ID.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Book title to search for" },
          author: { type: "string", description: "Book author to search for" },
        },
        required: ["title", "author"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_hardcover",
      description: "Search Hardcover for ASIN and series info by title and author. Hardcover has the best series/sequence data.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Book title to search for" },
          author: { type: "string", description: "Book author to search for" },
        },
        required: ["title", "author"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_audnexus",
      description: "Get detailed metadata (title, author, narrator, cover URL, duration) from Audnexus by ASIN. Audnexus has the best narrator and cover art data.",
      parameters: {
        type: "object" as const,
        properties: {
          asin: { type: "string", description: "10-character ASIN to look up" },
        },
        required: ["asin"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_local_cover",
      description: "Check if a local cover art file (JPG/PNG) exists in the book's source directory.",
      parameters: { type: "object" as const, properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_output",
      description: "Write the final output — copies audio files, tags with metadata, writes cover art. Call only when you have trusted metadata.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Verified book title" },
          author: { type: "string", description: "Verified book author" },
          asin: { type: "string", description: "Verified 10-character ASIN" },
          series: { type: "string", description: "Series name (optional)" },
          seriesPart: { type: "string", description: "Book position in series (optional)" },
          narrator: { type: "string", description: "Narrator name (optional)" },
          coverUrl: { type: "string", description: "Cover art URL from Audnexus (optional)" },
          coverId: { type: "number", description: "Open Library cover ID (optional)" },
        },
        required: ["title", "author", "asin"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "flag_for_review",
      description: "Flag this book for manual review. Call when metadata cannot be resolved or trusted.",
      parameters: {
        type: "object" as const,
        properties: {
          reason: { type: "string", description: "Why this book needs manual review" },
        },
        required: ["reason"],
      },
    },
  },
];

function buildInitialMessage(bookSet: BookSet): string {
  const firstFile = bookSet.files[0];
  const sourceDir = firstFile ? path.dirname(firstFile.path) : "unknown";
  const dirParts = sourceDir.split(path.sep);
  const segments = dirParts.slice(-4);

  const fileList = bookSet.files.map((f) => {
    const tags = f.existingMetadata;
    const tagParts: string[] = [];
    if (tags.title) tagParts.push(`title="${tags.title}"`);
    if (tags.artist) tagParts.push(`artist="${tags.artist}"`);
    if (tags.album) tagParts.push(`album="${tags.album}"`);
    if (tags.asin) tagParts.push(`asin="${tags.asin}"`);
    const tagStr = tagParts.length ? ` [${tagParts.join(", ")}]` : "";
    return `  ${path.basename(f.path)} (${f.format})${tagStr}`;
  }).join("\n");

  return `Book source directory: ${sourceDir}
Path structure: ${segments.join(" > ")}
File count: ${bookSet.files.length}

Files:
${fileList}

Determine the correct author and title from the folder path structure. Then search providers and either write the output or flag for review.`;
}

function cacheKey(title: string, author: string): string {
  return `${title}/${author}`;
}

function plainResult(text: string): string {
  return text;
}

async function executeSearchOpenLibrary(
  args: Record<string, unknown>,
  ctx: ToolContext,
  fetchFn: typeof fetch,
): Promise<string> {
  const title = String(args.title || "");
  const author = String(args.author || "");

  const key = cacheKey(title, author);
  const cached = ctx.cache.get(key);
  if (cached) {
    return plainResult(`Found cached ASIN for "${title}" by ${author}: ${cached}`);
  }

  const query = `${title} ${author}`;
  const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=key,title,author_name,isbn,cover_i&limit=5`;

  try {
    const response = await fetchFn(searchUrl);
    if (!response.ok) return plainResult(`Open Library search failed (HTTP ${response.status})`);

    const data = await response.json() as {
      numFound: number;
      docs?: Array<{ key: string; title: string; author_name?: string[]; isbn?: string[]; cover_i?: number }>;
    };

    if (!data.docs || data.docs.length === 0) {
      return plainResult(`No results found on Open Library for "${title}" by ${author}`);
    }

    for (const doc of data.docs) {
      const editionsUrl = `https://openlibrary.org${doc.key}/editions.json?limit=5`;
      try {
        const editionsResp = await fetchFn(editionsUrl);
        if (editionsResp.ok) {
          const editionsData = await editionsResp.json() as {
            entries?: Array<{ isbn_10?: string[] }>;
          };
          if (editionsData.entries) {
            for (const entry of editionsData.entries) {
              if (entry.isbn_10) {
                const found = entry.isbn_10.find(validateAsin);
                if (found) {
                  ctx.cache.set(key, found);
                  return plainResult(`Found Open Library candidate: ASIN ${found}, title "${doc.title}" by ${(doc.author_name || []).join(", ")}`);
                }
              }
            }
          }
        }
      } catch { /* continue */ }
    }

    for (const doc of data.docs) {
      if (doc.isbn) {
        const found = doc.isbn.find(validateAsin);
        if (found) {
          ctx.cache.set(key, found);
          return plainResult(`Found Open Library candidate (from ISBN): ASIN ${found}, title "${doc.title}" by ${(doc.author_name || []).join(", ")}`);
        }
      }
    }

    return plainResult(`No valid ASIN found on Open Library for "${title}" by ${author}`);
  } catch {
    return plainResult(`Open Library search request failed for "${title}" by ${author}`);
  } finally {
    await delay(1100);
  }
}

async function executeSearchHardcover(
  args: Record<string, unknown>,
  ctx: ToolContext,
  fetchFn: typeof fetch,
): Promise<string> {
  const title = String(args.title || "");
  const author = String(args.author || "");

  if (!ctx.config.hardcoverApiKey) {
    return plainResult("Hardcover search skipped — no API key configured");
  }

  const key = cacheKey(title, author);
  const cached = ctx.cache.get(key);
  if (cached) {
    return plainResult(`Found cached ASIN for "${title}" by ${author}: ${cached}`);
  }

  try {
    const result = await searchHardcoverAsin({ title, author }, ctx.config.hardcoverApiKey, fetchFn);
    if (result.asin) {
      ctx.cache.set(key, result.asin);
      const parts = [`Found Hardcover candidate: ASIN ${result.asin}`];
      if (result.series) parts.push(`series "${result.series}"`);
      if (result.seriesPart) parts.push(`part ${result.seriesPart}`);
      return plainResult(parts.join(", "));
    }

    return plainResult(`No results found on Hardcover for "${title}" by ${author}`);
  } finally {
    await delay(1000);
  }
}

async function executeFetchAudnexus(
  args: Record<string, unknown>,
  _ctx: ToolContext,
  fetchFn: typeof fetch,
): Promise<string> {
  const asin = String(args.asin || "");

  try {
    const book = await lookupAudnexusBook(asin, { fetchFn });
    if (!book) {
      return plainResult(`Audnexus lookup failed for ASIN: ${asin}`);
    }

    const parts = [`Audnexus metadata for ${asin}:`];
    parts.push(`  Title: "${book.title}"`);
    parts.push(`  Author: ${book.authors[0]?.name || "unknown"}`);
    if (book.narrators[0]?.name) parts.push(`  Narrator: ${book.narrators[0].name}`);
    if (book.image) parts.push(`  Cover URL: ${book.image}`);
    if (book.runtimeLengthMin) parts.push(`  Duration: ${book.runtimeLengthMin} min`);
    return plainResult(parts.join("\n"));
  } finally {
    await delay(600);
  }
}

async function executeFindLocalCover(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const firstFile = ctx.bookSet.files[0];
  if (!firstFile) {
    return plainResult("No files in book set — cannot find local cover");
  }

  const sourceDir = path.dirname(firstFile.path);
  const cover = await findLocalCoverArt(sourceDir);
  if (cover) {
    ctx.localCover = cover;
    return plainResult("Found local cover art in source directory");
  }

  return plainResult("No local cover art found in source directory");
}

async function executeWriteOutput(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; terminal: TerminalResult }> {
  const title = String(args.title || "");
  const author = String(args.author || "");
  const asin = String(args.asin || "");
  const series = args.series ? String(args.series) : undefined;
  const seriesPart = args.seriesPart ? String(args.seriesPart) : undefined;
  const narrator = args.narrator ? String(args.narrator) : undefined;
  const coverUrl = args.coverUrl ? String(args.coverUrl) : undefined;
  const coverId = args.coverId !== undefined ? Number(args.coverId) : undefined;

  const outputMode = ctx.config.outputMode;

  if (outputMode === "local") {
    const bookDir = buildBookFolderPath(ctx.config.outputDir, author, title, series);

    if (ctx.config.dryRun) {
      return {
        content: plainResult(`[DRY-RUN] Would write ${ctx.bookSet.files.length} files to ${bookDir}`),
        terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length },
      };
    }

    const coverArt = ctx.localCover
      ?? await downloadAndResizeCover({ coverUrl, coverId: coverId && coverId > 0 ? coverId : undefined });

    const resolved: ResolvedMetadata = {
      title,
      author,
      asin,
      series,
      seriesPart,
      narrator,
      coverUrl,
      coverId,
    };

    tagMultiFileSet(ctx.bookSet.files, resolved, coverArt ?? undefined);

    const copiedFiles = copyFilesToOutput(ctx.bookSet.files, bookDir);

    writeCoverArt(coverArt, bookDir);

    const coverMsg = coverArt ? "with cover art" : "without cover art";
    return {
      content: plainResult(`Written ${copiedFiles.length} file(s) to ${bookDir} ${coverMsg}`),
      terminal: { status: "written", outputDir: bookDir, filesWritten: copiedFiles.length },
    };
  }

  const absConfig = {
    url: ctx.config.absUrl,
    apiToken: ctx.config.absApiToken,
    libraryId: ctx.config.absLibraryId,
  };
  const absClient = createAbsClient(absConfig);

  if (ctx.config.dryRun) {
    return {
      content: plainResult(`[DRY-RUN] Would upload "${title}" by ${author} (${ctx.bookSet.files.length} files) to Audiobookshelf library ${ctx.config.absLibraryId}`),
      terminal: { status: "written", outputDir: `abs://${ctx.config.absUrl}/library/${ctx.config.absLibraryId}`, filesWritten: ctx.bookSet.files.length },
    };
  }

  const coverArt = ctx.localCover
    ?? await downloadAndResizeCover({ coverUrl, coverId: coverId && coverId > 0 ? coverId : undefined });

  const resolved: ResolvedMetadata = {
    title,
    author,
    asin,
    series,
    seriesPart,
    narrator,
    coverUrl,
    coverId,
  };

  tagMultiFileSet(ctx.bookSet.files, resolved, coverArt ?? undefined);

  return executeAbsUpload({
    ctx,
    fetchFn: ctx.config.fetchFn || fetch,
    absClient,
    title,
    author,
    asin,
    series,
    seriesPart,
    coverArt,
  });
}

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fuzzyMatch(a: string, b: string): boolean {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;
  if (normA.replace(/[^a-z0-9]/g, "") === normB.replace(/[^a-z0-9]/g, "")) return true;
  return false;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof AbsServerError) return true;
  if (error instanceof AbsRateLimitError) return true;
  if (error instanceof AbsAuthError) return false;
  if (error instanceof AbsNotFoundError) return false;
  if (error instanceof TypeError) return true;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND") return true;
  return false;
}

function errorLabel(error: unknown): string {
  if (error instanceof AbsServerError) return `Server error ${error.status}`;
  if (error instanceof AbsRateLimitError) return "429 Rate limited";
  if (error instanceof AbsAuthError) return "401 Unauthorized";
  if (error instanceof AbsNotFoundError) return "404 Not found";
  if (error instanceof TypeError) return error.message.slice(0, 80);
  const code = (error as NodeJS.ErrnoException).code;
  if (code) return code;
  if (error instanceof Error) return error.message.slice(0, 80);
  return String(error).slice(0, 80);
}

async function withRetry<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const delays = [1000, 2000, 4000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === delays.length) break;
      if (!isRetryableError(error)) {
        console.error(`  [ABS] ${name} failed: ${errorLabel(error)} — not retryable, falling back`);
        throw error;
      }

      console.error(`  [ABS] ${name} retry ${attempt + 1}/3: ${errorLabel(error)}, retrying in ${delays[attempt] / 1000}s...`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  throw lastError;
}

function executeLocalFallback(
  ctx: ToolContext,
  author: string,
  title: string,
  series: string | undefined,
  coverArt: Buffer | null,
  reason: string,
): { content: string; terminal: TerminalResult } {
  const bookDir = buildBookFolderPath(ctx.config.outputDir, author, title, series);

  if (ctx.config.dryRun) {
    return {
      content: plainResult(`[DRY-RUN] Would fall back to local: copy ${ctx.bookSet.files.length} files to ${bookDir} (${reason})`),
      terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length, fallbackReason: reason },
    };
  }

  copyFilesToOutput(ctx.bookSet.files, bookDir);
  writeCoverArt(coverArt, bookDir);

  const coverMsg = coverArt ? "with cover art" : "without cover art";
  return {
    content: plainResult(`Fell back to local output: ${ctx.bookSet.files.length} file(s) to ${bookDir} ${coverMsg}`),
    terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length, fallbackReason: reason },
  };
}

interface AbsUploadOptions {
  ctx: ToolContext;
  fetchFn: typeof fetch;
  absClient: AbsClient;
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesPart?: string;
  coverArt: Buffer | null;
}

function getAuthorFromMeta(meta: Record<string, unknown>): string {
  return String(meta.authorName || meta.author || "");
}

function getTitleFromMeta(meta: Record<string, unknown>): string {
  return String(meta.title || "");
}

async function executeAbsUpload(options: AbsUploadOptions): Promise<{ content: string; terminal: TerminalResult }> {
  const { ctx, fetchFn, absClient, title, author, asin, series, seriesPart, coverArt } = options;
  const libraryId = ctx.config.absLibraryId;
  const fallback = (reason: string) => executeLocalFallback(ctx, author, title, series, coverArt, reason);

  let searchResult: AbsSearchResult;
  try {
    searchResult = await withRetry("search ASIN", () => absClient.searchLibrary({ libraryId, query: asin, fetchFn }));
  } catch (err) {
    console.error(`  [ABS] Duplicate check failed: ${errorLabel(err)} — falling back to local`);
    return fallback(`Search error (${errorLabel(err)})`);
  }

  if (searchResult.book.length > 0) {
    return {
      content: plainResult(`Skipped: ASIN ${asin} already exists in library "${title}"`),
      terminal: { status: "skipped", outputDir: `abs:${libraryId}`, reason: `Duplicate ASIN ${asin}: "${title}"` },
    };
  }

  try {
    searchResult = await withRetry("search title", () => absClient.searchLibrary({ libraryId, query: title, fetchFn }));
  } catch (err) {
    console.error(`  [ABS] Duplicate check failed: ${errorLabel(err)} — falling back to local`);
    return fallback(`Search error (${errorLabel(err)})`);
  }

  const duplicate = searchResult.book.find((item) => {
    const meta = item.libraryItem?.media?.metadata || {};
    const itemAuthor = getAuthorFromMeta(meta);
    const itemTitle = getTitleFromMeta(meta);
    return normalizeText(itemAuthor) === normalizeText(author) && fuzzyMatch(itemTitle, title);
  });
  if (duplicate) {
    return {
      content: plainResult(`Skipped: "${title}" by ${author} already exists in library`),
      terminal: { status: "skipped", outputDir: `abs:${libraryId}`, reason: `Duplicate title+author: "${title}" by ${author}` },
    };
  }

  const tracked = assignTrackNumbers(ctx.bookSet.files);
  const numberedFiles = tracked.map((file) => ({
    sourcePath: file.path,
    filename: `${String(file.trackNumber).padStart(2, "0")} - ${path.basename(file.path)}`,
  }));

  // Look up the library's folder ID for upload
  let folderId = libraryId;
  try {
    const libInfo = await withRetry("get library", () => absClient.getLibrary({ libraryId, fetchFn }));
    if (libInfo.folders && libInfo.folders.length > 0) {
      folderId = libInfo.folders[0].id;
    }
  } catch (err) {
    console.error(`  [ABS] Failed to get library info: ${errorLabel(err)} — falling back to local`);
    return fallback(`Library lookup failed (${errorLabel(err)})`);
  }

  try {
    await withRetry("upload", () => absClient.uploadFiles({
      libraryId,
      folderId,
      title,
      author,
      series,
      files: numberedFiles.map((f) => f.sourcePath),
      fileNames: numberedFiles.map((f) => f.filename),
      fetchFn,
    }));
  } catch (err) {
    console.error(`  [ABS] Upload failed: ${errorLabel(err)} — falling back to local`);
    return fallback(`Upload failed (${errorLabel(err)})`);
  }

  // Trigger library scan so uploaded files are indexed
  try {
    await withRetry("scan", () => absClient.scanLibrary({ libraryId, fetchFn }));
  } catch {
    // scan failure is non-critical — the library watcher may pick up files anyway
  }

  // Poll until the uploaded item appears in search results by title+author
  const pollDelays = [2000, 3000, 4000, 5000, 6000];
  const pollStart = Date.now();
  let itemId = "";

  for (const delay of pollDelays) {
    const elapsed = Date.now() - pollStart;
    if (elapsed > 25000) break;

    await new Promise((r) => setTimeout(r, delay));

    try {
      const pollResult = await withRetry("poll", () => absClient.searchLibrary({ libraryId, query: title, fetchFn }));
      if (pollResult.book.length === 0) {
        console.error(`  [ABS] Poll: no books found for "${title}" (delay ${delay}ms)`);
      }
      const match = pollResult.book.find((item) => {
        const meta = item.libraryItem?.media?.metadata || {};
        const itemTitle = getTitleFromMeta(meta);
        const itemAuthor = getAuthorFromMeta(meta);
        return fuzzyMatch(itemTitle, title) && normalizeText(itemAuthor) === normalizeText(author);
      });
      if (match) {
        itemId = match.libraryItem.id;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!itemId) {
    console.error(`  [ABS] Could not discover item ID after upload — falling back to local`);
    return fallback("Item ID not discovered after upload");
  }

  try {
    await withRetry("PATCH metadata", () => absClient.updateMedia({
      itemId,
      metadata: {
        asin,
        series: series ? [{ name: series, sequence: seriesPart || undefined }] : undefined,
      },
      fetchFn,
    }));
  } catch {
    console.error(`  [ABS] Failed to PATCH metadata for item ${itemId}`);
  }

  let providerMatched = false;
  try {
    const matchPayload = {
      provider: "audible",
      asin,
      title,
      author,
      series,
      seriesPart,
      overrideCover: false,
      overrideDetails: true,
    };
    const matchResult = await withRetry("provider match", () => absClient.matchItem({ itemId, payload: matchPayload, fetchFn }));
    providerMatched = matchResult.updated;

    if (providerMatched) {
      try {
        const item = await withRetry("verify match", () => absClient.getItem({ itemId, fetchFn }));
        const matchedMeta = item.libraryItem?.media?.metadata || {};
        const matchedAuthor = getAuthorFromMeta(matchedMeta);
        const matchedTitle = getTitleFromMeta(matchedMeta);

        const authorOk = normalizeText(matchedAuthor) === normalizeText(author);
        const titleOk = fuzzyMatch(matchedTitle, title);

        if (!authorOk || !titleOk) {
          console.error(
            `  [ABS] Match returned wrong metadata: author="${matchedAuthor}" title="${matchedTitle}" — reverting`,
          );
          await withRetry("revert match", () =>
            absClient.updateMedia({
              itemId,
              metadata: { asin, series: series ? [{ name: series, sequence: seriesPart || undefined }] : undefined },
              fetchFn,
            }),
          );
          providerMatched = false;
        }
      } catch {
        console.error(`  [ABS] Failed to verify/revert match result for item ${itemId}`);
      }
    }
  } catch {
    console.error(`  [ABS] Provider match failed for item ${itemId}`);
  }

  if (coverArt) {
    const tmpCoverPath = path.join(os.tmpdir(), `abs-cover-${Date.now()}.jpg`);
    try {
      fs.writeFileSync(tmpCoverPath, coverArt);
      await withRetry("cover upload", () => absClient.uploadCover({ itemId, coverPath: tmpCoverPath, fetchFn }));
    } catch {
      console.error(`  [ABS] Cover upload failed for item ${itemId}`);
    } finally {
      try { fs.unlinkSync(tmpCoverPath); } catch { /* ignore */ }
    }
  }

  let verifyResult: AbsSearchResult;
  try {
    verifyResult = await withRetry("verify", () => absClient.searchLibrary({ libraryId, query: asin, fetchFn }));
  } catch {
    console.error(`  [ABS] Verification search failed — flagging for review`);
    return {
      content: plainResult(`Could not verify "${title}" after upload`),
      terminal: { status: "flagged", reason: `ABS verify search failed for "${title}" (ASIN: ${asin})` },
    };
  }

  const verifyItem = verifyResult.book.find((item) => item.libraryItem.id === itemId);
  if (verifyItem) {
    const verifyMeta = verifyItem.libraryItem?.media?.metadata || {};
    const absAuthor = getAuthorFromMeta(verifyMeta);
    const absTitle = getTitleFromMeta(verifyMeta);

    const authorOk = normalizeText(absAuthor) === normalizeText(author);
    const titleOk = fuzzyMatch(absTitle, title);

    if (!authorOk || !titleOk) {
      const detailParts: string[] = [];
      if (!authorOk) detailParts.push(`author mismatch: expected "${author}", got "${absAuthor}"`);
      if (!titleOk) detailParts.push(`title mismatch: expected "${title}", got "${absTitle}"`);
      return {
        content: plainResult(`Verify failed: ${detailParts.join("; ")}`),
        terminal: { status: "flagged", reason: `ABS verify mismatch for "${title}" (ASIN: ${asin}): ${detailParts.join("; ")}` },
      };
    }
  }

  const matchNote = providerMatched ? " (matched to provider)" : "";
  return {
    content: plainResult(`Uploaded to Audiobookshelf: "${title}" by ${author} (${ctx.bookSet.files.length} files)${matchNote}`),
    terminal: { status: "written", outputDir: `abs://${ctx.config.absUrl}/library/${libraryId}`, filesWritten: ctx.bookSet.files.length },
  };
}

function executeFlagForReview(
  args: Record<string, unknown>,
  ctx: ToolContext,
): { content: string; terminal: TerminalResult } {
  const reason = String(args.reason || "Metadata could not be resolved");
  const book = ctx.bookSet.books[0];
  const filePaths = ctx.bookSet.files.map((f) => f.path);

  if (book) {
    flagForReview(book, filePaths, {
      input: "",
      output: ctx.config.outputDir,
      hardcover_api_key: ctx.config.hardcoverApiKey,
      dry_run: ctx.config.dryRun,
      llm_model: ctx.config.model,
      llm_api_key: ctx.config.apiKey || "",
      llm_api_base_url: ctx.config.apiBaseUrl || "",
      concurrency: 1,
      include: [],
      log_level: "info",
      output_mode: "local",
      abs_url: "",
      abs_api_token: "",
      abs_library_id: "",
    }, reason);
  }

  return {
    content: plainResult(`Flagged for review: ${reason}`),
    terminal: { status: "flagged", reason },
  };
}

type TerminalResult = OrchestrationResult | null;

async function executeToolCall(
  toolCall: ToolCallRecord,
  ctx: ToolContext,
  fetchFn: typeof fetch,
): Promise<{ content: string; terminal: TerminalResult }> {
  const name = toolCall.function.name;
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { content: plainResult("Error: invalid arguments"), terminal: null };
  }

  switch (name) {
    case "search_open_library":
      return { content: await executeSearchOpenLibrary(args, ctx, fetchFn), terminal: null };
    case "search_hardcover":
      return { content: await executeSearchHardcover(args, ctx, fetchFn), terminal: null };
    case "fetch_audnexus":
      return { content: await executeFetchAudnexus(args, ctx, fetchFn), terminal: null };
    case "find_local_cover":
      return { content: await executeFindLocalCover(args, ctx), terminal: null };
    case "write_output": {
      const result = await executeWriteOutput(args, ctx);
      return result;
    }
    case "flag_for_review": {
      const result = executeFlagForReview(args, ctx);
      return result;
    }
    default:
      return { content: plainResult(`Error: unknown tool "${name}"`), terminal: null };
  }
}

export function createOrchestrator(config: OrchestratorConfig) {
  const {
    model,
    apiBaseUrl = "https://api.openai.com/v1",
    fetchFn: userFetchFn = fetch,
    cache,
  } = config;
  const apiKey = config.apiKey || process.env.LLM_API_KEY;
  const fetchFn = userFetchFn;

  return async function orchestrateBook(bookSet: BookSet): Promise<OrchestrationResult> {
    if (!apiKey) {
      return { status: "flagged", reason: "LLM API key not configured" };
    }

    const context: ToolContext = {
      bookSet,
      config,
      cache,
      localCover: null,
    };

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildInitialMessage(bookSet) },
    ];
    let lastContent = "";

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      console.error(`  [Round ${iteration + 1}/${MAX_ITERATIONS}]`);

      let response: Response | undefined;
      let retryDelay = 1000;
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) {
          console.error(`  [Retry ${retry}/3 after ${retryDelay}ms]`);
          await new Promise((r) => setTimeout(r, retryDelay));
          retryDelay *= 2;
        }
        response = await fetchFn(`${apiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools: TOOLS,
            tool_choice: "auto",
          }),
        });
        if (response.status !== 429) break;
      }

      if (!response || !response.ok) {
        return { status: "flagged", reason: `LLM API error: ${response?.status || "unknown"}` };
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: ToolCallRecord[];
          };
        }>;
      };

      const message = data.choices?.[0]?.message;
      if (!message) {
        return { status: "flagged", reason: "LLM returned empty response" };
      }

      if (message.content) {
        lastContent = message.content;
        console.error(`  [LLM reason] ${message.content.slice(0, 200)}`);
      }

      messages.push(message);

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return {
          status: "flagged",
          reason: lastContent || "LLM finished without calling write_output or flag_for_review",
        };
      }

      for (const toolCall of toolCalls) {
        console.error(`  [Tool call] ${toolCall.function.name}(${toolCall.function.arguments.slice(0, 200)})`);
        const { content, terminal } = await executeToolCall(toolCall, context, fetchFn);
        console.error(`  [Tool result] ${content.slice(0, 300)}`);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content });

        if (terminal) {
          return terminal;
        }
      }
    }

    const prefix = lastContent ? `${lastContent.slice(0, 200)} — ` : "";
    return { status: "flagged", reason: `${prefix}Exceeded max iterations (${MAX_ITERATIONS}) without terminal tool call` };
  };
}
