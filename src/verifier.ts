import path from "node:path";
import type { BookSet, ResolvedMetadata } from "./types.js";
import type { ToolContext, OrchestrationResult } from "./orchestrator.js";
import { writeOutputForBook } from "./orchestrator.js";
import type { AsinCache } from "./providers/asin.js";
import { flagForReview } from "./agent.js";
import { tagged, detail } from "./logger.js";

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

const MAX_ITERATIONS = 5;

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
    if (metadata.seriesPart) parts.push(`  Series Part: ${metadata.seriesPart}`);
    if (metadata.narrator) parts.push(`  Narrator: "${metadata.narrator}"`);
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

function writeFlagForReview(
  input: VerifierInput,
  outputDir: string,
  dryRun: boolean,
  reason: string,
): void {
  const book = input.bookSet.books[0];
  if (!book) return;
  const filePaths = input.bookSet.files.map((f) => f.path);
  flagForReview(book, filePaths, {
    input: "",
    output: outputDir,
    hardcover_api_key: "",
    dry_run: dryRun,
    llm_model: "",
    llm_api_key: "",
    llm_api_base_url: "",
    concurrency: 1,
    include: [],
    log_level: "info",
    output_mode: "local",
    abs_url: "",
    abs_api_token: "",
    abs_library_id: "",
  }, reason);
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
    seriesPart: args.seriesPart ? String(args.seriesPart) : undefined,
    narrator: args.narrator ? String(args.narrator) : undefined,
    coverUrl: args.coverUrl ? String(args.coverUrl) : undefined,
    coverId: args.coverId !== undefined ? Number(args.coverId) : undefined,
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
  const fetchFn = userFetchFn;

  return async function verifyBook(input: VerifierInput): Promise<VerifierResult> {
    if (!apiKey) {
      return { status: "flagged", reason: "LLM API key not configured" };
    }

    if (!input.metadata) {
      const reason = input.reason || "No ASIN found from any provider";
      writeFlagForReview(input, outputDir, dryRun, reason);
      return { status: "flagged", reason };
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
        fetchFn,
        cache,
        outputMode: config.outputMode,
        absUrl: config.absUrl,
        absApiToken: config.absApiToken,
        absLibraryId: config.absLibraryId,
      },
      cache,
      localCover: input.localCover,
    };

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildInitialMessage(input) },
    ];
    let lastContent = "";

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      tagged("Verifier", `Round ${iteration + 1}/${MAX_ITERATIONS}`, "cyan");

      let response: Response | undefined;
      let retryDelay = 1000;
      for (let retry = 0; retry < 3; retry++) {
        if (retry > 0) {
          tagged("Req", `Retry ${retry}/3 after ${retryDelay}ms`, "yellow");
          await new Promise((r) => setTimeout(r, retryDelay));
          retryDelay *= 2;
        }
        try {
          response = await fetchFn(`${apiBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto" }),
          });
          if (response.status !== 429) break;
        } catch (e) {
          tagged("Req", `Fetch failed: ${(e as Error)?.message?.slice(0, 80) || e}`, "red");
          response = undefined;
        }
      }

      if (!response || !response.ok) {
        writeFlagForReview(input, outputDir, dryRun, `LLM API error: ${response?.status || "unknown"}`);
        return { status: "flagged", reason: `LLM API error: ${response?.status || "unknown"}` };
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const message = data.choices?.[0]?.message;
      if (!message) {
        writeFlagForReview(input, outputDir, dryRun, "LLM returned empty response");
        return { status: "flagged", reason: "LLM returned empty response" };
      }

      if (message.content) {
        lastContent = message.content;
        detail(`[Verifier] ${message.content.slice(0, 200)}`);
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
        const { name, arguments: argsStr } = toolCall.function;
        detail(`[Tool call] ${name}(${argsStr.slice(0, 200)})`);

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(argsStr);
        } catch {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: invalid arguments" });
          continue;
        }

        if (name === "write_output") {
          const title = String(args.title || "").trim();
          const author = String(args.author || "").trim();
          const asin = String(args.asin || "").trim();
          if (!title || !author || !asin) {
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: title, author, and asin are required" });
            continue;
          }

          const { content, terminal } = await executeWriteOutputTool(args, context);
          detail(`[Tool result] ${content.slice(0, 300)}`);
          messages.push({ role: "tool", tool_call_id: toolCall.id, content });

          if (terminal) {
            return terminal;
          }
        } else if (name === "flag_for_review") {
          const reason = String(args.reason || "Could not verify provider metadata");
          writeFlagForReview(input, outputDir, dryRun, reason);
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Flagged for review: ${reason}` });
          return { status: "flagged", reason };
        } else {
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Error: unknown tool "${name}"` });
        }
      }
    }

    const prefix = lastContent ? `${lastContent.slice(0, 200)} — ` : "";
    const autoReason = `${prefix}Exceeded max iterations (${MAX_ITERATIONS}) without terminal tool call`;
    writeFlagForReview(input, outputDir, dryRun, autoReason);
    return { status: "flagged", reason: autoReason };
  };
}
