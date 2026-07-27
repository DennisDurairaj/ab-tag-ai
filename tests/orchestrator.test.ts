import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, AudioFile } from "../src/types.js";
import { createAsinCache } from "../src/providers/asin.js";

vi.mock("../src/utils.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils.js")>("../src/utils.js");
  return { ...actual, delay: vi.fn(() => Promise.resolve()) };
});

function mkFile(filePath: string, meta: Record<string, string> = {}): AudioFile {
  return { path: filePath, format: "mp3", existingMetadata: meta };
}

function mkBookSet(files: AudioFile[]): BookSet {
  return { books: [{ path: files[0].path, title: "Test Book", author: "", asin: "" }], files };
}

function mockChatResponse(content: string | null, toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
  const message: Record<string, unknown> = {};
  if (content) message.content = content;
  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
  }
  return { choices: [{ message }] };
}

let cache: ReturnType<typeof createAsinCache>;
let tmpDir: string;
let outputDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
  outputDir = path.join(tmpDir, "output");
  cache = createAsinCache(tmpDir);
});

import { createOrchestrator } from "../src/orchestrator.js";

function createTempFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from("fake mp3 data"));
  return filePath;
}

describe("orchestrateBook", () => {
  it("flag path: LLM flags after search returns candidates that don't match folder path", async () => {
    const bookDir = path.join(tmpDir, "Author", "Unknown Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    let call = 0;
    const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      call++;

      if (url.includes("/chat/completions")) {
        if (call === 1) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "search_open_library", args: { title: "Unknown Book", author: "Author" } },
          ]) };
        }
        if (call === 3) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_2", name: "flag_for_review", args: { reason: "No provider returned a matching book" } },
          ]) };
        }
      }

      if (url.includes("openlibrary.org")) {
        return { ok: true, json: () => ({ numFound: 0, docs: [] }) };
      }

      return { ok: false, status: 404, json: () => ({}) };
    });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("No provider returned a matching book");
    }
  });

  it("retry path: LLM first search fails, retries with different author, then flags", async () => {
    const bookDir = path.join(tmpDir, "Peters, Elizabeth", "Vicky Bliss series", "Laughter of Dead Kings");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    let call = 0;
    const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      call++;

      if (url.includes("/chat/completions")) {
        if (call === 1) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "search_open_library", args: { title: "Laughter of Dead Kings", author: "Vicky Bliss series" } },
          ]) };
        }
        if (call === 3) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_2", name: "search_open_library", args: { title: "Laughter of Dead Kings", author: "Elizabeth Peters" } },
          ]) };
        }
        if (call === 5) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_3", name: "flag_for_review", args: { reason: "No providers returned matching results" } },
          ]) };
        }
      }

      if (url.includes("openlibrary.org")) {
        return { ok: true, json: () => ({ numFound: 0, docs: [] }) };
      }

      return { ok: false, status: 404, json: () => ({}) };
    });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("flagged");
    expect(fakeFetch).toHaveBeenCalled();
    const chatCalls = fakeFetch.mock.calls.filter(([input]) => input.toString().includes("/chat/completions"));
    expect(chatCalls.length).toBe(3);
  });

  it("terminal guard: LLM returns message with no tool calls → auto-flag", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return { ok: true, json: () => ({ choices: [{ message: { content: "I'm done!" } }] }) };
    });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("I'm done!");
    }
  });

  it("max-iteration guard: auto-flags after too many tool calls", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return { ok: true, json: () => mockChatResponse(null, [
        { id: "call_loop", name: "search_open_library", args: { title: "Book", author: "Author" } },
      ]) };
    });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("iteration");
    }
    expect(fakeFetch).toHaveBeenCalledTimes(100);
  });
});
