import path from "node:path";
import fs from "node:fs";
import type { BookSet } from "./types.js";
import { tagged, dryRun as dryRunMsg, detail } from "./logger.js";

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

const MAX_ITERATIONS = 5;

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

  if (dryRun) {
    const safeName = title.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "unknown";
    const reviewPath = path.join(outputDir, "review", `${safeName}.json`);
    dryRunMsg(`  [DRY-RUN] Would write review to ${reviewPath}: ${reason}`);
    return;
  }

  const reviewDir = path.join(outputDir, "review");
  fs.mkdirSync(reviewDir, { recursive: true });
  const safeName = title.replace(/[^a-z0-9]/gi, "_").slice(0, 50) || "unknown";
  const reviewPath = path.join(reviewDir, `${safeName}.json`);
  const reviewData = {
    title,
    author,
    files: filePaths,
    reason,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2), "utf-8");
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
  const fetchFn = userFetchFn;

  return async function interpretPath(bookSet: BookSet): Promise<PathInterpreterResult> {
    if (!apiKey) {
      return { status: "flagged", reason: "LLM API key not configured" };
    }

    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildInitialMessage(bookSet) },
    ];
    let lastContent = "";

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      tagged("Path Interpreter", `Round ${iteration + 1}/${MAX_ITERATIONS}`, "cyan");

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
        return { status: "flagged", reason: "LLM returned empty response" };
      }

      if (message.content) {
        lastContent = message.content;
        detail(`[Path Interpreter] ${message.content.slice(0, 200)}`);
      }

      messages.push(message);

      const toolCalls = message.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return { status: "flagged", reason: lastContent || "LLM finished without calling set_title_author or flag_for_review" };
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

        if (name === "set_title_author") {
          const title = String(args.title || "").trim();
          const author = String(args.author || "").trim();
          if (!title || !author) {
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: title and author are required" });
            continue;
          }
          return { status: "resolved", title, author };
        }

        if (name === "flag_for_review") {
          const reason = String(args.reason || "Path could not be interpreted");
          writeFlagForReview(bookSet, outputDir, dryRun, reason);
          return { status: "flagged", reason };
        }

        messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Error: unknown tool "${name}"` });
      }
    }

    const prefix = lastContent ? `${lastContent.slice(0, 200)} — ` : "";
    return { status: "flagged", reason: `${prefix}Exceeded max iterations (${MAX_ITERATIONS}) without terminal tool call` };
  };
}
