import type { BookSet, ResolvedMetadata } from "./types.js";
import { downloadAndResizeCover } from "./providers/cover-art.js";
import { buildBookFolderPath, writeCoverArt, copyFilesToOutput } from "./utils.js";
import { tagMultiFileSet } from "./taggers/index.js";
import type { AsinCache } from "./providers/asin.js";
import { createAbsClient } from "./providers/abs-client.js";
import { executeAbsUpload } from "./providers/abs-upload.js";

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

export type TerminalResult = OrchestrationResult | null;

export interface ToolContext {
  bookSet: BookSet;
  config: OrchestratorConfig;
  cache: AsinCache;
  localCover: Buffer | null;
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

  if (ctx.config.outputMode === "local") {
    const bookDir = buildBookFolderPath(ctx.config.outputDir, author, title, series);

    if (ctx.config.dryRun) {
      return {
        content: `[DRY-RUN] Would write ${ctx.bookSet.files.length} files to ${bookDir}`,
        terminal: { status: "written", outputDir: bookDir, filesWritten: ctx.bookSet.files.length },
      };
    }

    const copiedFiles = copyFilesToOutput(ctx.bookSet.files, bookDir);
    writeCoverArt(coverArt, bookDir);

    const coverMsg = coverArt ? "with cover art" : "without cover art";
    return {
      content: `Written ${copiedFiles.length} file(s) to ${bookDir} ${coverMsg}`,
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
      content: `[DRY-RUN] Would upload "${title}" by ${author} (${ctx.bookSet.files.length} files) to Audiobookshelf library ${ctx.config.absLibraryId}`,
      terminal: { status: "written", outputDir: `abs://${ctx.config.absUrl}/library/${ctx.config.absLibraryId}`, filesWritten: ctx.bookSet.files.length },
    };
  }

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
