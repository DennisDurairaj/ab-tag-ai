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

describe("orchestrateBook — ABS upload flow", () => {
  const ABS_URL = "https://abs.example.com";
  const ABS_LIBRARY_ID = "lib-1";
  const ABS_ALBUM_PATH = path.join("Author", "Test Book");

  function createDummyMp3(dir: string, name: string): string {
    const filePath = path.join(dir, name);
    const minimalMp3 = Buffer.from([
      0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    fs.writeFileSync(filePath, minimalMp3);
    return filePath;
  }

  it("trust path: LLM writes to ABS, upload succeeds, returns written", async () => {
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
      fs.mkdirSync(bookDir, { recursive: true });
      const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      let searchCallCount = 0;
      const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.includes("/chat/completions")) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
          ]) };
        }

        // getLibrary: GET /api/libraries/{id} (not search, not scan)
        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }

        if (url.includes("/api/libraries/lib-1/search")) {
          searchCallCount++;
          if (searchCallCount <= 2) return { ok: true, json: () => ({ book: [] }) };
          return { ok: true, json: () => ({
            book: [
              { libraryItem: { id: "item-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } },
            ],
          }) };
        }

        if (url.includes("/api/libraries/lib-1/scan")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/upload")) {
          return { ok: true, json: () => ({}) };
        }

        if (url.includes("/api/items/item-1/cover")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/items/item-1/media")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/items/item-1/match")) {
          return { ok: true, json: () => ({ updated: true }) };
        }

        return { ok: false, status: 404 };
      });

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: fakeFetch as unknown as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
      });

      const result = await orchestrate(bookSet);
      expect(result.status).toBe("written");
      if (result.status === "written") {
        expect(result.outputDir).toContain("abs://");
        expect(result.filesWritten).toBe(1);
      }
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  it("duplicate skip path: ABS search finds ASIN match, returns skipped", async () => {
    const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
    fs.mkdirSync(bookDir, { recursive: true });
    const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
    const bookSet = mkBookSet([mkFile(sourcePath)]);

    let call = 0;
    const fakeFetch = vi.fn(async (input: string | URL) => {
      const url = input.toString();
      call++;

      if (url.includes("/chat/completions")) {
        return { ok: true, json: () => mockChatResponse(null, [
          { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
        ]) };
      }

      if (url.includes("/api/libraries/lib-1/search")) {
        return { ok: true, json: () => ({
          book: [
{ libraryItem: { id: "existing-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } },
          ],
        }) };
      }

      return { ok: false, status: 404 };
    });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
      outputMode: "audiobookshelf",
      absUrl: ABS_URL,
      absApiToken: "abs-token",
      absLibraryId: ABS_LIBRARY_ID,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("Duplicate ASIN");
    }
  });

  it("verify-mismatch flag path: upload succeeds but verify finds wrong metadata", async () => {
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
      fs.mkdirSync(bookDir, { recursive: true });
      const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      let searchCall = 0;
      const fakeFetch = vi.fn(async (input: string | URL) => {
        const url = input.toString();

        if (url.includes("/chat/completions")) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
          ]) };
        }

        // getLibrary mock
        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }

        if (url.includes("/api/libraries/lib-1/search")) {
          searchCall++;
          // Duplicate checks (ASIN then title): return empty
          if (searchCall <= 2) return { ok: true, json: () => ({ book: [] }) };
          // Poll (search by title): return correct match
          if (searchCall === 3) {
            return { ok: true, json: () => ({
              book: [
                { libraryItem: { id: "item-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } },
              ],
            }) };
          }
          // Verify (search by ASIN): return wrong metadata
          return { ok: true, json: () => ({
            book: [
{ libraryItem: { id: "item-1", media: { metadata: { title: "Wrong Title", authorName: "Wrong Author" } } } },
            ],
          }) };
        }

        if (url.includes("/api/libraries/lib-1/scan")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/upload")) {
          return { ok: true, json: () => ({}) };
        }

        if (url.includes("/api/items/item-1/cover")) {
          return { ok: false, status: 500 };
        }

        if (url.includes("/api/items/item-1/media")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/items/item-1/match")) {
          return { ok: true, json: () => ({ updated: true }) };
        }

        return { ok: false, status: 404 };
      });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
      outputMode: "audiobookshelf",
      absUrl: ABS_URL,
      absApiToken: "abs-token",
      absLibraryId: ABS_LIBRARY_ID,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("ABS verify mismatch");
      expect(result.reason).toContain("Wrong Title");
      expect(result.reason).toContain("Wrong Author");
    }
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  it("non-retryable immediate fallback: upload gets 401, falls back to local", async () => {
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
      fs.mkdirSync(bookDir, { recursive: true });
      const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
      const bookSet = mkBookSet([mkFile(sourcePath)]);
      let searchCallCount = 0;
      let uploadCalls = 0;
      const fakeFetch = vi.fn(async (input: string | URL) => {
        const url = input.toString();
        if (url.includes("/chat/completions")) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
          ]) };
        }
        // getLibrary mock
        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }
        if (url.includes("/api/libraries/lib-1/search")) {
          searchCallCount++;
          return { ok: true, json: () => ({ book: [] }) };
        }
        if (url.includes("/api/upload")) {
          uploadCalls++;
          return { ok: false, status: 401, text: async () => "Unauthorized" };
        }
        return { ok: false, status: 404 };
      });

    const orchestrate = createOrchestrator({
      model: "test-model",
      apiKey: "test-key",
      hardcoverApiKey: "test-hc-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
      cache,
      outputMode: "audiobookshelf",
      absUrl: ABS_URL,
      absApiToken: "abs-token",
      absLibraryId: ABS_LIBRARY_ID,
    });

    const result = await orchestrate(bookSet);
    expect(result.status).toBe("written");
    expect(result.outputDir).toContain("Author");
    expect(result.outputDir).toContain("Test Book");
    if (result.status === "written") {
      expect(result.fallbackReason).toBeDefined();
      expect(result.fallbackReason).toContain("401 Unauthorized");
    }
    expect(uploadCalls).toBe(1); // no retries for non-retryable
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  it("retry+success path: upload fails twice with 500, succeeds on retry 3", async () => {
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
      fs.mkdirSync(bookDir, { recursive: true });
      const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      let searchCallCount = 0;
      let uploadCalls = 0;
      const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url.includes("/chat/completions")) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
          ]) };
        }

        // getLibrary mock
        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }

        if (url.includes("/api/libraries/lib-1/search")) {
          searchCallCount++;
          if (searchCallCount <= 2) return { ok: true, json: () => ({ book: [] }) };
          return { ok: true, json: () => ({
            book: [
              { libraryItem: { id: "item-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } },
            ],
          }) };
        }

        if (url.includes("/api/libraries/lib-1/scan")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/upload")) {
          uploadCalls++;
          if (uploadCalls < 3) {
            return { ok: false, status: 500, text: async () => "Server error" };
          }
          return { ok: true, json: () => ({}) };
        }

        if (url.includes("/api/items/item-1/cover")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/items/item-1/media")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/items/item-1/match")) {
          return { ok: true, json: () => ({ updated: true }) };
        }

        return { ok: false, status: 404 };
      });

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: fakeFetch as unknown as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
      });

      const result = await orchestrate(bookSet);
      expect(result.status).toBe("written");
      if (result.status === "written") {
        expect(result.outputDir).toContain("abs://");
      }
      expect(uploadCalls).toBeGreaterThanOrEqual(3);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  it("retry+exhaust+fallback path: upload fails all 4 attempts, falls back to local", async () => {
    const origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }) as typeof setTimeout;
    try {
      const bookDir = path.join(tmpDir, ABS_ALBUM_PATH);
      fs.mkdirSync(bookDir, { recursive: true });
      const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      let searchCallCount = 0;
      let uploadCalls = 0;
      const fakeFetch = vi.fn(async (input: string | URL) => {
        const url = input.toString();

        if (url.includes("/chat/completions")) {
          return { ok: true, json: () => mockChatResponse(null, [
            { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author", asin: "B000000001" } },
          ]) };
        }

        // getLibrary mock
        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }

        if (url.includes("/api/libraries/lib-1/search")) {
          searchCallCount++;
          return { ok: true, json: () => ({ book: [] }) };
        }

        if (url.includes("/api/upload")) {
          uploadCalls++;
          return { ok: false, status: 500, text: async () => "Server error" };
        }

        return { ok: false, status: 404 };
      });

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: fakeFetch as unknown as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
      });

      const result = await orchestrate(bookSet);
      expect(result.status).toBe("written");
      expect(result.outputDir).toContain("Author");
      expect(result.outputDir).toContain("Test Book");
      if (result.status === "written") {
        expect(result.fallbackReason).toBeDefined();
        expect(result.fallbackReason).toContain("Upload failed");
      }
      expect(uploadCalls).toBe(4);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });
});

