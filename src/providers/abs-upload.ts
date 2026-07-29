import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { ToolContext, TerminalResult } from "../orchestrator.js";
import { buildBookFolderPath, writeCoverArt, copyFilesToOutput, fuzzyMatch, normalizeText } from "../utils.js";
import { assignTrackNumbers } from "../taggers/index.js";
import { AbsServerError, AbsAuthError, AbsNotFoundError, AbsRateLimitError } from "./abs-client.js";
import type { AbsClient, AbsSearchResult } from "./abs-client.js";
import { tagged } from "../logger.js";

function isRetryableError(error: unknown): boolean {
  if (error instanceof AbsServerError) return true;
  if (error instanceof AbsRateLimitError) return true;
  if (error instanceof AbsAuthError) return false;
  if (error instanceof AbsNotFoundError) return false;
  if (error instanceof TypeError) return true;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EAI_AGAIN") return true;
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
        tagged("ABS", `${name} failed: ${errorLabel(error)} — not retryable, falling back`, "red");
        throw error;
      }

      tagged("ABS", `${name} retry ${attempt + 1}/3: ${errorLabel(error)}, retrying in ${delays[attempt] / 1000}s...`, "yellow");
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
      content: `[DRY-RUN] Would fall back to local: copy ${ctx.bookSet.files.length} files to ${bookDir} (${reason})`,
      terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length, fallbackReason: reason },
    };
  }

  copyFilesToOutput(ctx.bookSet.files, bookDir);
  writeCoverArt(coverArt, bookDir);

  const coverMsg = coverArt ? "with cover art" : "without cover art";
  return {
    content: `Fell back to local output: ${ctx.bookSet.files.length} file(s) to ${bookDir} ${coverMsg}`,
    terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length, fallbackReason: reason },
  };
}

export interface AbsUploadOptions {
  ctx: ToolContext;
  fetchFn: typeof fetch;
  absClient: AbsClient;
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesSequence?: string;
  narrator?: string;
  description?: string;
  genres?: string[];
  publisher?: string;
  language?: string;
  isbn?: string;
  coverArt: Buffer | null;
}

function getAuthorFromMeta(meta: Record<string, unknown>): string {
  return String(meta.authorName || meta.author || "");
}

function getTitleFromMeta(meta: Record<string, unknown>): string {
  return String(meta.title || "");
}

function buildUpdateMediaPayload(options: {
  title: string;
  author: string;
  asin: string;
  series?: string;
  seriesSequence?: string;
  narrator?: string;
  description?: string;
  genres?: string[];
  publisher?: string;
  language?: string;
  isbn?: string;
}) {
  return {
    asin: options.asin,
    title: options.title,
    authors: [{ name: options.author }],
    isbn: options.isbn || undefined,
    narrators: options.narrator ? [options.narrator] : undefined,
    description: options.description || undefined,
    genres: options.genres,
    publisher: options.publisher || undefined,
    language: options.language || undefined,
    series: options.series
      ? [{ name: options.series, sequence: options.seriesSequence || undefined }]
      : undefined,
  };
}

export async function executeAbsUpload(options: AbsUploadOptions): Promise<{ content: string; terminal: TerminalResult }> {
  const { ctx, fetchFn, absClient, title, author, asin, series, seriesSequence, narrator, description, genres, publisher, language, isbn, coverArt } = options;
  const libraryId = ctx.config.absLibraryId;
  const fallback = (reason: string) => executeLocalFallback(ctx, author, title, series, coverArt, reason);

  let searchResult: AbsSearchResult;
  try {
    searchResult = await withRetry("search ASIN", () => absClient.searchLibrary({ libraryId, query: asin, fetchFn }));
  } catch (err) {
    tagged("ABS", `Duplicate check failed: ${errorLabel(err)} — falling back to local`, "red");
    return fallback(`Search error (${errorLabel(err)})`);
  }

  if (searchResult.book.length > 0) {
    return {
      content: `Skipped: ASIN ${asin} already exists in library "${title}"`,
      terminal: { status: "skipped", outputDir: `abs:${libraryId}`, reason: `Duplicate ASIN ${asin}: "${title}"` },
    };
  }

  try {
    searchResult = await withRetry("search title", () => absClient.searchLibrary({ libraryId, query: title, fetchFn }));
  } catch (err) {
    tagged("ABS", `Duplicate check failed: ${errorLabel(err)} — falling back to local`, "red");
    return fallback(`Search error (${errorLabel(err)})`);
  }

  const duplicate = searchResult.book.find((item) => {
    const meta = item.libraryItem?.media?.metadata || {};
    const itemAuthor = getAuthorFromMeta(meta);
    const itemTitle = getTitleFromMeta(meta);
    return fuzzyMatch(itemAuthor, author) && fuzzyMatch(itemTitle, title);
  });
  if (duplicate) {
    return {
      content: `Skipped: "${title}" by ${author} already exists in library`,
      terminal: { status: "skipped", outputDir: `abs:${libraryId}`, reason: `Duplicate title+author: "${title}" by ${author}` },
    };
  }

  const tracked = assignTrackNumbers(ctx.bookSet.files);
  const numberedFiles = tracked.map((file) => ({
    sourcePath: file.path,
    filename: `${String(file.trackNumber).padStart(2, "0")} - ${path.basename(file.path)}`,
  }));

  let folderId = libraryId;
  try {
    const libInfo = await withRetry("get library", () => absClient.getLibrary({ libraryId, fetchFn }));
    if (libInfo.folders && libInfo.folders.length > 0) {
      folderId = libInfo.folders[0].id;
    }
  } catch (err) {
    tagged("ABS", `Failed to get library info: ${errorLabel(err)} — falling back to local`, "red");
    return fallback(`Library lookup failed (${errorLabel(err)})`);
  }

  let uploadResult: { id: string; libraryItemId: string };
  try {
    uploadResult = await withRetry("upload", () => absClient.uploadFiles({
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
    tagged("ABS", `Upload failed: ${errorLabel(err)} — falling back to local`, "red");
    return fallback(`Upload failed (${errorLabel(err)})`);
  }

  try {
    await withRetry("scan", () => absClient.scanLibrary({ libraryId, fetchFn }));
  } catch {
    // scan failure is non-critical
  }

  const itemId = uploadResult.libraryItemId;

  if (!itemId) {
    tagged("ABS", "Upload did not return library item ID — falling back to local", "red");
    return fallback("Item ID not returned from upload");
  }

  try {
    await withRetry("PATCH metadata", () => absClient.updateMedia({
      itemId,
      metadata: buildUpdateMediaPayload({ title, author, asin, series, seriesSequence, narrator, description, genres, publisher, language, isbn }),
      fetchFn,
    }));
  } catch {
    tagged("ABS", `Failed to PATCH metadata for item ${itemId}`, "red");
  }

  if (coverArt) {
    const tmpCoverPath = path.join(os.tmpdir(), `abs-cover-${Date.now()}.jpg`);
    try {
      fs.writeFileSync(tmpCoverPath, coverArt);
      await withRetry("cover upload", () => absClient.uploadCover({ itemId, coverPath: tmpCoverPath, fetchFn }));
    } catch {
      tagged("ABS", `Cover upload failed for item ${itemId}`, "red");
    } finally {
      try { fs.unlinkSync(tmpCoverPath); } catch { /* ignore */ }
    }
  }

  let verifyResult: AbsSearchResult;
  try {
    verifyResult = await withRetry("verify", () => absClient.searchLibrary({ libraryId, query: asin, fetchFn }));
  } catch {
    tagged("ABS", "Verification search failed — flagging for review", "magenta");
    return {
      content: `Could not verify "${title}" after upload`,
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
        content: `Verify failed: ${detailParts.join("; ")}`,
        terminal: { status: "flagged", reason: `ABS verify mismatch for "${title}" (ASIN: ${asin}): ${detailParts.join("; ")}` },
      };
    }
  }

  return {
    content: `Uploaded to Audiobookshelf: "${title}" by ${author} (${ctx.bookSet.files.length} files)`,
    terminal: { status: "written", outputDir: `abs://${ctx.config.absUrl}/library/${libraryId}`, filesWritten: ctx.bookSet.files.length },
  };
}
