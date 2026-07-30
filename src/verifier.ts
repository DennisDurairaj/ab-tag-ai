import path from "node:path";
import type { BookSet, ResolvedMetadata } from "./types.js";
import type { ToolContext, OrchestrationResult } from "./orchestrator.js";
import { writeOutputForBook } from "./orchestrator.js";
import type { AsinCache } from "./providers/asin.js";
import { runAgent } from "./llm-agent.js";

const SYSTEM_PROMPT = `You are a metadata verifier for an audiobook organizer. The title and author have been inferred from the folder path, and provider searches (Open Library, Hardcover, Audnexus) have returned results that did not pass automated fuzzy matching. Your job is to review the provider results against the inferred identity and decide whether the match is close enough, or whether to flag for manual review.

Rules:
- The inferred title and author are the ground truth — evaluate provider results against them.
- A small difference (e.g. subtitle, series suffix, middle initial) is acceptable if the core title/author clearly match.
- If the provider data is clearly wrong (different book, different genre), flag for review.
- Call write_output if you trust the match, even with minor differences.
- Call flag_for_review if the match is not credible or too ambiguous.
- Decide in 1-2 iterations.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_output",
      description: "Write the final output — copies audio files, tags with metadata, writes cover art. Call when you trust that the provider metadata matches the inferred book identity.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Verified book title" },
          author: { type: "string", description: "Verified book author" },
          asin: { type: "string", description: "Verified 10-character ASIN" },
          series: { type: "string", description: "Series name (optional)" },
          seriesSequence: { type: "string", description: "Book position in series (optional)" },
          narrator: { type: "string", description: "Narrator name (optional)" },
          coverUrl: { type: "string", description: "Cover art URL from Audnexus (optional)" },
          coverId: { type: "number", description: "Open Library cover ID (optional)" },
          description: { type: "string", description: "Book description (optional)" },
          genres: { type: "array", items: { type: "string" }, description: "Genre list (optional)" },
          publisher: { type: "string", description: "Publisher name (optional)" },
          language: { type: "string", description: "Book language (optional)" },
          isbn: { type: "string", description: "ISBN identifier (optional)" },
        },
        required: ["title", "author", "asin"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "flag_for_review",
      description: "Flag this book for manual review. Call when the provider metadata does not credibly match the inferred title and author, or when no ASIN was found.",
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

export interface VerifierConfig {
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

export type VerifierInput = {
  bookSet: BookSet;
  inferredTitle: string;
  inferredAuthor: string;
  metadata: ResolvedMetadata | null;
  reason: string;
  localCover: Buffer | null;
};

export type VerifierResult = OrchestrationResult;

function buildInitialMessage(input: VerifierInput): string {
  const { bookSet, inferredTitle, inferredAuthor, metadata, reason } = input;
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
    const tagStr = tagParts.length ? ` [${tagParts.join(", ")}]` : "";
    return `  ${path.basename(f.path)} (${f.format})${tagStr}`;
  }).join("\n");

  let providerSection = "";
  if (metadata) {
    const parts: string[] = [];
    parts.push(`  ASIN: ${metadata.asin}`);
    parts.push(`  Title: "${metadata.title}"`);
    parts.push(`  Author: "${metadata.author}"`);
    if (metadata.series) parts.push(`  Series: "${metadata.series}"`);
    if (metadata.seriesSequence) parts.push(`  Series Sequence: ${metadata.seriesSequence}`);
    if (metadata.narrator) parts.push(`  Narrator: "${metadata.narrator}"`);
    if (metadata.description) parts.push(`  Description: "${metadata.description.slice(0, 200)}"`);
    if (metadata.genres) parts.push(`  Genres: ${metadata.genres.join(", ")}`);
    if (metadata.publisher) parts.push(`  Publisher: "${metadata.publisher}"`);
    if (metadata.language) parts.push(`  Language: "${metadata.language}"`);
    if (metadata.isbn) parts.push(`  ISBN: ${metadata.isbn}`);
    if (metadata.coverId) parts.push(`  Cover ID: ${metadata.coverId}`);
    if (metadata.coverUrl) parts.push(`  Cover URL: ${metadata.coverUrl}`);
    providerSection = `Provider Results (merged OL + HC + Audnexus):\n${parts.join("\n")}`;
  } else {
    providerSection = "Provider Results: No results found from any provider (no ASIN).";
  }

  return `Book source directory: ${sourceDir}
Path structure: ${segments.join(" > ")}
File count: ${bookSet.files.length}

Files:
${fileList}

Inferred Identity:
  Title: "${inferredTitle}"
  Author: "${inferredAuthor}"

${providerSection}

Match Failure Reason: ${reason}

Review the provider results against the inferred identity. If the match is credible (minor differences are acceptable), call write_output. Otherwise call flag_for_review.`;
}

async function executeWriteOutputTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: string; terminal: OrchestrationResult }> {
  const metadata: ResolvedMetadata = {
    title: String(args.title || ""),
    author: String(args.author || ""),
    asin: String(args.asin || ""),
    series: args.series ? String(args.series) : undefined,
    seriesSequence: args.seriesSequence ? String(args.seriesSequence) : undefined,
    narrator: args.narrator ? String(args.narrator) : undefined,
    coverUrl: args.coverUrl ? String(args.coverUrl) : undefined,
    coverId: args.coverId !== undefined ? Number(args.coverId) : undefined,
    description: args.description ? String(args.description) : undefined,
    genres: Array.isArray(args.genres) ? args.genres.map((g: unknown) => String(g)) : undefined,
    publisher: args.publisher ? String(args.publisher) : undefined,
    language: args.language ? String(args.language) : undefined,
    isbn: args.isbn ? String(args.isbn) : undefined,
    durationMinutes: args.durationMinutes !== undefined ? Number(args.durationMinutes) : undefined,
  };

  return writeOutputForBook(metadata, ctx);
}

export function createVerifier(config: VerifierConfig) {
  const {
    model,
    apiBaseUrl = "https://api.openai.com/v1",
    apiKey: configApiKey,
    dryRun,
    outputDir,
    fetchFn: userFetchFn = fetch,
    cache,
  } = config;
  const apiKey = configApiKey || process.env.LLM_API_KEY;

  return async function verifyBook(input: VerifierInput): Promise<VerifierResult> {
    if (!apiKey) {
      return { status: "flagged", reason: "LLM API key not configured" };
    }

    const context: ToolContext = {
      bookSet: input.bookSet,
      config: {
        model,
        apiKey: configApiKey,
        apiBaseUrl,
        hardcoverApiKey: config.hardcoverApiKey,
        outputDir,
        dryRun,
        fetchFn: userFetchFn,
        cache,
        outputMode: config.outputMode,
        absUrl: config.absUrl,
        absApiToken: config.absApiToken,
        absLibraryId: config.absLibraryId,
      },
      cache,
      localCover: input.localCover,
    };

    const result = await runAgent<VerifierResult>({
      systemPrompt: SYSTEM_PROMPT,
      initialMessage: buildInitialMessage(input),
      tools: TOOLS,
      handleToolCall: async (name, args) => {
        if (name === "write_output") {
          const title = String(args.title || "").trim();
          const author = String(args.author || "").trim();
          const asin = String(args.asin || "").trim();
          if (!title || !author || !asin) {
            return { outcome: "continue", content: "Error: title, author, and asin are required" };
          }

          const toolOutput = await executeWriteOutputTool(args, context);
          if (toolOutput.terminal) {
            return { outcome: "terminal", value: toolOutput.terminal };
          }
          return { outcome: "continue", content: toolOutput.content };
        }

        if (name === "flag_for_review") {
          const reason = String(args.reason || "Could not verify provider metadata");
          return { outcome: "terminal", value: { status: "flagged", reason } };
        }

        return { outcome: "continue", content: `Error: unknown tool "${name}"` };
      },
      model,
      apiKey,
      apiBaseUrl,
      fetchFn: userFetchFn,
      logLabel: "Verifier",
    });

    if (result.status === "ok") {
      return result.value!;
    }

    return { status: "flagged", reason: result.reason! };
  };
}
