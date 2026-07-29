import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, AudioFile, ResolvedMetadata } from "../src/types.js";
import type { OrchestratorConfig, ToolContext } from "../src/orchestrator.js";
import { writeOutputForBook } from "../src/orchestrator.js";
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

let cache: ReturnType<typeof createAsinCache>;
let tmpDir: string;
let outputDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-test-"));
  outputDir = path.join(tmpDir, "output");
  cache = createAsinCache(tmpDir);
});

function createDummyMp3(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  const minimalMp3 = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  fs.writeFileSync(filePath, minimalMp3);
  return filePath;
}

function makeToolContext(bookSet: BookSet, overrides: Partial<OrchestratorConfig> = {}): ToolContext {
  const config: OrchestratorConfig = {
    model: "test-model",
    apiKey: "test-key",
    apiBaseUrl: "https://api.openai.com/v1",
    hardcoverApiKey: "test-hc-key",
    outputDir,
    dryRun: false,
    cache,
    outputMode: "local",
    absUrl: "",
    absApiToken: "",
    absLibraryId: "",
    ...overrides,
  };
  return { bookSet, config, cache, localCover: null };
}

describe("writeOutputForBook — local mode", () => {
  it("writes files in dry-run mode", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
    const bookSet = mkBookSet([mkFile(sourcePath)]);

    const ctx = makeToolContext(bookSet, { dryRun: true });
    const result = await writeOutputForBook({
      title: "Test Book",
      author: "Author",
      asin: "B000000001",
    }, ctx);

    expect(result.terminal.status).toBe("written");
  });

  it("writes files in local mode", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    const sourcePath = createDummyMp3(bookDir, "ch01.mp3");
    const bookSet = mkBookSet([mkFile(sourcePath)]);

    const ctx = makeToolContext(bookSet);
    const result = await writeOutputForBook({
      title: "Test Book",
      author: "Author",
      asin: "B000000001",
    }, ctx);

    expect(result.terminal.status).toBe("written");
    if (result.terminal.status === "written") {
      expect(result.terminal.filesWritten).toBe(1);
      expect(fs.existsSync(result.terminal.outputDir)).toBe(true);
    }
  });
});

describe("writeOutputForBook — ABS upload flow", () => {
  const ABS_URL = "https://abs.example.com";
  const ABS_LIBRARY_ID = "lib-1";
  const ABS_ALBUM_PATH = path.join("Author", "Test Book");

  it("trust path: upload succeeds, returns written", async () => {
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
          return { ok: true, json: () => ({ libraryItemId: "item-1" }) };
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

        if (url.includes("/api/items/item-1") && !url.includes("/match") && !url.includes("/cover") && !url.includes("/media")) {
          return { ok: true, json: () => ({ libraryItem: { id: "item-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } }) };
        }

        return { ok: false, status: 404 };
      });

      const ctx = makeToolContext(bookSet, {
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      const result = await writeOutputForBook({
        title: "Test Book",
        author: "Author",
        asin: "B000000001",
      }, ctx);

      expect(result.terminal.status).toBe("written");
      if (result.terminal.status === "written") {
        expect(result.terminal.outputDir).toContain("abs://");
        expect(result.terminal.filesWritten).toBe(1);
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

    const fakeFetch = vi.fn(async (input: string | URL) => {
      const url = input.toString();

      if (url.includes("/api/libraries/lib-1/search")) {
        return { ok: true, json: () => ({
          book: [
            { libraryItem: { id: "existing-1", media: { metadata: { title: "Test Book", authorName: "Author" } } } },
          ],
        }) };
      }

      return { ok: false, status: 404 };
    });

    const ctx = makeToolContext(bookSet, {
      outputMode: "audiobookshelf",
      absUrl: ABS_URL,
      absApiToken: "abs-token",
      absLibraryId: ABS_LIBRARY_ID,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await writeOutputForBook({
      title: "Test Book",
      author: "Author",
      asin: "B000000001",
    }, ctx);

    expect(result.terminal.status).toBe("skipped");
    if (result.terminal.status === "skipped") {
      expect(result.terminal.reason).toContain("Duplicate ASIN");
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

        if (url.match(/\/api\/libraries\/[^/]+\/?$/) && !url.includes("/search") && !url.includes("/scan")) {
          return { ok: true, json: () => ({ id: "lib-1", folders: [{ id: "folder-1", fullPath: "/audiobooks" }] }) };
        }

        if (url.includes("/api/libraries/lib-1/search")) {
          searchCall++;
          if (searchCall <= 2) return { ok: true, json: () => ({ book: [] }) };
          return { ok: true, json: () => ({
            book: [
              { libraryItem: { id: "item-1", media: { metadata: { title: "Wrong Title", authorName: "Someone Else" } } } },
            ],
          }) };
        }

        if (url.includes("/api/libraries/lib-1/scan")) {
          return { ok: true, status: 200 };
        }

        if (url.includes("/api/upload")) {
          return { ok: true, json: () => ({ libraryItemId: "item-1" }) };
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

      const ctx = makeToolContext(bookSet, {
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      const result = await writeOutputForBook({
        title: "Test Book",
        author: "Author",
        asin: "B000000001",
      }, ctx);

      expect(result.terminal.status).toBe("flagged");
      if (result.terminal.status === "flagged") {
        expect(result.terminal.reason).toContain("ABS verify mismatch");
        expect(result.terminal.reason).toContain("Wrong Title");
        expect(result.terminal.reason).toContain("Someone Else");
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

      const ctx = makeToolContext(bookSet, {
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      const result = await writeOutputForBook({
        title: "Test Book",
        author: "Author",
        asin: "B000000001",
      }, ctx);

      expect(result.terminal.status).toBe("written");
      expect(result.terminal.outputDir).toContain("Author");
      expect(result.terminal.outputDir).toContain("Test Book");
      if (result.terminal.status === "written") {
        expect(result.terminal.fallbackReason).toBeDefined();
        expect(result.terminal.fallbackReason).toContain("401 Unauthorized");
      }
      expect(uploadCalls).toBe(1);
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
          return { ok: true, json: () => ({ libraryItemId: "item-1" }) };
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

      const ctx = makeToolContext(bookSet, {
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      const result = await writeOutputForBook({
        title: "Test Book",
        author: "Author",
        asin: "B000000001",
      }, ctx);

      expect(result.terminal.status).toBe("written");
      if (result.terminal.status === "written") {
        expect(result.terminal.outputDir).toContain("abs://");
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

      const ctx = makeToolContext(bookSet, {
        outputMode: "audiobookshelf",
        absUrl: ABS_URL,
        absApiToken: "abs-token",
        absLibraryId: ABS_LIBRARY_ID,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      const result = await writeOutputForBook({
        title: "Test Book",
        author: "Author",
        asin: "B000000001",
      }, ctx);

      expect(result.terminal.status).toBe("written");
      expect(result.terminal.outputDir).toContain("Author");
      expect(result.terminal.outputDir).toContain("Test Book");
      if (result.terminal.status === "written") {
        expect(result.terminal.fallbackReason).toBeDefined();
        expect(result.terminal.fallbackReason).toContain("Upload failed");
      }
      expect(uploadCalls).toBe(4);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });
});
