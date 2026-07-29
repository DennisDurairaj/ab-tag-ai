import path from "node:path";
import type { BookSet } from "./types.js";
import { runAgent } from "./llm-agent.js";
import { writeReviewFile } from "./utils.js";

const SYSTEM_PROMPT = `You are a path interpreter for an audiobook organizer. Your job is to determine the correct author and title from a file path structure.

Rules:
- The folder path is the ground truth for author and title. The first path segment is always the author. Remaining segments may include series name and book title.
- ID3 tags from the audio files are unreliable — artists are often narrators, and titles may be scrap filenames. Use them only as weak hints when the path is ambiguous.
- Call set_title_author when you can determine the title and author from the path.
- Call flag_for_review if the path does not reveal a clear title or author.
- Decide quickly — 1-2 iterations maximum.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "set_title_author",
      description: "Confirm the book title and author determined from the path structure.",
      parameters: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Book title from the path" },
          author: { type: "string", description: "Book author from the path (first segment)" },
        },
        required: ["title", "author"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "flag_for_review",
      description: "Flag the book for manual review. Use when the path cannot be interpreted.",
      parameters: {
        type: "object" as const,
        properties: {
          reason: { type: "string", description: "Why the path cannot be interpreted" },
        },
        required: ["reason"],
      },
    },
  },
];

export interface PathInterpreterConfig {
  model: string;
  apiKey: string;
  apiBaseUrl?: string;
  dryRun: boolean;
  outputDir: string;
  fetchFn?: typeof fetch;
}

export type PathInterpreterResult =
  | { status: "resolved"; title: string; author: string }
  | { status: "flagged"; reason: string };

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
    const tagStr = tagParts.length ? ` [${tagParts.join(", ")}]` : "";
    return `  ${path.basename(f.path)} (${f.format})${tagStr}`;
  }).join("\n");

  return `Book source directory: ${sourceDir}
Path structure: ${segments.join(" > ")}
File count: ${bookSet.files.length}

Files:
${fileList}

Determine the correct author and title from the path structure. The first segment is always the author. Call set_title_author to confirm, or flag_for_review if the path is ambiguous.`;
}

function writeFlagForReview(
  bookSet: BookSet,
  outputDir: string,
  dryRun: boolean,
  reason: string,
): void {
  const book = bookSet.books[0];
  const title = book?.title || "Unknown";
  const author = book?.author || "Unknown";
  const filePaths = bookSet.files.map((f) => f.path);
  writeReviewFile(outputDir, dryRun, title, author, filePaths, reason);
}

export function createPathInterpreter(config: PathInterpreterConfig) {
  const {
    model,
    apiBaseUrl = "https://api.openai.com/v1",
    apiKey: configApiKey,
    dryRun,
    outputDir,
    fetchFn: userFetchFn = fetch,
  } = config;
  const apiKey = configApiKey || process.env.LLM_API_KEY;

  return async function interpretPath(bookSet: BookSet): Promise<PathInterpreterResult> {
    if (!apiKey) {
      return { status: "flagged", reason: "LLM API key not configured" };
    }

    const result = await runAgent<PathInterpreterResult>({
      systemPrompt: SYSTEM_PROMPT,
      initialMessage: buildInitialMessage(bookSet),
      tools: TOOLS,
      handleToolCall: async (name, args) => {
        if (name === "set_title_author") {
          const title = String(args.title || "").trim();
          const author = String(args.author || "").trim();
          if (!title || !author) {
            return { outcome: "continue", content: "Error: title and author are required" };
          }
          return { outcome: "terminal", value: { status: "resolved", title, author } };
        }

        if (name === "flag_for_review") {
          const reason = String(args.reason || "Path could not be interpreted");
          writeFlagForReview(bookSet, outputDir, dryRun, reason);
          return { outcome: "terminal", value: { status: "flagged", reason } };
        }

        return { outcome: "continue", content: `Error: unknown tool "${name}"` };
      },
      model,
      apiKey,
      apiBaseUrl,
      fetchFn: userFetchFn,
      logLabel: "Path Interpreter",
    });

    if (result.status === "ok") {
      return result.value!;
    }

    return { status: "flagged", reason: result.reason! };
  };
}
