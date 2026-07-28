import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, ResolvedMetadata } from "./types.js";
import { downloadAndResizeCover } from "./providers/cover-art.js";
import { buildBookFolderPath, writeCoverArt, copyFilesToOutput, fuzzyMatch, normalizeText } from "./utils.js";
import { tagMultiFileSet, assignTrackNumbers } from "./taggers/index.js";
import type { AsinCache } from "./providers/asin.js";
import { createAbsClient, AbsServerError, AbsAuthError, AbsNotFoundError, AbsRateLimitError } from "./providers/abs-client.js";
import type { AbsClient, AbsSearchResult } from "./providers/abs-client.js";

export interface OrchestratorConfig {
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

export type OrchestrationResult =
  | { status: "written"; outputDir: string; filesWritten: number; fallbackReason?: string }
  | { status: "skipped"; outputDir: string; reason: string }
  | { status: "flagged"; reason: string };

type TerminalResult = OrchestrationResult | null;

export interface ToolContext {
  bookSet: BookSet;
  config: OrchestratorConfig;
  cache: AsinCache;
  localCover: Buffer | null;
}

function plainResult(text: string): string {
  return text;
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

export async function writeOutputForBook(
  metadata: ResolvedMetadata,
  ctx: ToolContext,
): Promise<{ content: string; terminal: OrchestrationResult }> {
  const result = await executeWriteOutput({
    title: metadata.title,
    author: metadata.author,
    asin: metadata.asin,
    series: metadata.series,
    seriesPart: metadata.seriesPart,
    narrator: metadata.narrator,
    coverUrl: metadata.coverUrl,
    coverId: metadata.coverId,
  }, ctx);
  return { content: result.content, terminal: result.terminal as OrchestrationResult };
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
