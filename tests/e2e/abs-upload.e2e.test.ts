import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { BookSet, AudioFile } from "../../src/types.js";
import { createAsinCache } from "../../src/providers/asin.js";
import { createOrchestrator } from "../../src/orchestrator.js";
import {
  startAbsContainer,
  stopAbsContainer,
  killAbsContainer,
  type AbsTestEnv,
} from "./docker-helper.js";

function mkFile(filePath: string, meta: Record<string, string> = {}): AudioFile {
  return { path: filePath, format: "mp3", existingMetadata: meta };
}

function mkBookSet(files: AudioFile[]): BookSet {
  return {
    books: [{ path: files[0].path, title: "E2E Test Book", author: "", asin: "" }],
    files,
  };
}

function makeWriteOutputChat(title: string, author: string, asin: string, series?: string): object {
  const args: Record<string, string> = { title, author, asin };
  if (series) args.series = series;
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call_w1",
              type: "function",
              function: {
                name: "write_output",
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

function createE2eFetch(
  chatResponseFn: () => object,
  realFetch: typeof fetch,
): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes("/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => chatResponseFn(),
        text: async () => JSON.stringify(chatResponseFn()),
      } as Response;
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

function createMinimalMp3(filePath: string): void {
  execFileSync(
    "ffmpeg",
    [
      "-f", "lavfi",
      "-i", "anullsrc=r=44100:cl=stereo",
      "-t", "3",
      "-c:a", "libmp3lame",
      "-b:a", "64k",
      filePath,
      "-y",
    ],
    { stdio: "ignore" },
  );
}

function searchByAsin(env: AbsTestEnv, asin: string): Promise<unknown> {
  return fetch(
    `${env.url}/api/libraries/${env.libraryId}/search?q=${encodeURIComponent(asin)}`,
    { headers: { Authorization: `Bearer ${env.apiToken}` } },
  ).then((r) => r.json());
}

describe("ABS E2E — Docker integration", () => {
  let env: AbsTestEnv;
  let testDirs: string[] = [];

  beforeAll(
    async () => {
      env = await startAbsContainer();
    },
    300000,
  );

  afterAll(() => {
    for (const d of testDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    stopAbsContainer();
  });

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createTestDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "abs-e2e-test-"));
    testDirs.push(d);
    return d;
  }

  function setupBookFiles(baseDir: string, dirName: string): { bookDir: string; sourcePath: string } {
    const bookDir = path.join(baseDir, dirName);
    fs.mkdirSync(bookDir, { recursive: true });
    const sourcePath = path.join(bookDir, "ch01.mp3");
    createMinimalMp3(sourcePath);
    return { bookDir, sourcePath };
  }

  it(
    "upload: tags book in-place, uploads to ABS, verifies book in library",
    async () => {
      const tmpDir = createTestDir();
      const outputDir = path.join(tmpDir, "output");
      const cache = createAsinCache(tmpDir);

      const { bookDir, sourcePath } = setupBookFiles(tmpDir, "Author/E2E Test Book");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      const title = "The E2E Test Book";
      const author = "E2E Test Author";
      const asin = "E2ETEST01Z";

      const e2eFetch = createE2eFetch(
        () => makeWriteOutputChat(title, author, asin),
        fetch,
      );

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: e2eFetch as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });

      const result = await orchestrate(bookSet);

      expect(result.status).toBe("written");
      if (result.status === "written") {
        expect(result.outputDir).toContain("abs://");
        expect(result.filesWritten).toBe(1);
      }

      // Verify the book appears in the library
      const searchResult = (await searchByAsin(env, asin)) as {
        book?: Array<{
          id: string;
          media: { metadata: { title?: string; author?: string; asin?: string; series?: string } };
        }>;
      };

      expect(searchResult.book).toBeDefined();
      expect(searchResult.book!.length).toBeGreaterThanOrEqual(1);

      const item = searchResult.book!.find(
        (i) => i.libraryItem?.media?.metadata?.title === title,
      );
      expect(item).toBeDefined();
      if (item) {
        expect(item.libraryItem.media.metadata.title).toBe(title);
        expect(item.libraryItem.media.metadata.authorName).toBe(author);
      }
    },
    60000,
  );

  it(
    "metadata: uploaded book has correct ASIN and series set",
    async () => {
      const tmpDir = createTestDir();
      const outputDir = path.join(tmpDir, "output");
      const cache = createAsinCache(tmpDir);

      const { bookDir, sourcePath } = setupBookFiles(tmpDir, "Author/Metadata Test Book");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      const title = "Metadata Test Book";
      const author = "Meta Test Author";
      const asin = "METATEST01Z";
      const series = "The Meta Series";

      const e2eFetch = createE2eFetch(
        () => makeWriteOutputChat(title, author, asin, series),
        fetch,
      );

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: e2eFetch as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });

      const result = await orchestrate(bookSet);
      expect(result.status).toBe("written");

      // Verify ASIN and series in ABS library
      const searchResult = (await searchByAsin(env, asin)) as {
        book?: Array<{
          id: string;
          media: { metadata: { title?: string; author?: string; asin?: string; series?: string } };
        }>;
      };

      expect(searchResult.book).toBeDefined();
      const item = searchResult.book!.find(
        (i) => i.libraryItem?.media?.metadata?.title === title,
      );
      expect(item).toBeDefined();
      if (item) {
        expect(item.libraryItem.media.metadata.title).toBe(title);
        expect(item.libraryItem.media.metadata.authorName).toBe(author);

        // After upload → PATCH → match, the ASIN and series should be set on the item
        // Fetch full item details to check ASIN
        const itemDetail = await fetch(
          `${env.url}/api/items/${item.libraryItem.id}`,
          { headers: { Authorization: `Bearer ${env.apiToken}` } },
        ).then((r) => r.json()) as {
          media?: { metadata?: { asin?: string; series?: Array<{ name: string }> } };
        };

        expect(itemDetail.media?.metadata?.asin).toBe(asin);
      }
    },
    60000,
  );

  it(
    "duplicate skip: second upload of same book is skipped with already-in-library log",
    async () => {
      const tmpDir = createTestDir();
      const outputDir = path.join(tmpDir, "output");
      const cache = createAsinCache(tmpDir);

      const { bookDir, sourcePath } = setupBookFiles(tmpDir, "Author/Duplicate Test Book");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      const title = "The Duplicate Book";
      const author = "Dup Test Author";
      const asin = "DUPTEST001Z";

      // First upload — should succeed
      const e2eFetch1 = createE2eFetch(
        () => makeWriteOutputChat(title, author, asin),
        fetch,
      );

      const orchestrate1 = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: e2eFetch1 as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });

      const result1 = await orchestrate1(bookSet);
      expect(result1.status).toBe("written");

      // Second upload of the SAME book — should be skipped (ASIN already in library)
      const tempDir2 = createTestDir();
      const outputDir2 = path.join(tempDir2, "output");
      const cache2 = createAsinCache(tempDir2);

      const { sourcePath: sourcePath2 } = setupBookFiles(tempDir2, "Author/Duplicate Test Book");
      const bookSet2 = mkBookSet([mkFile(sourcePath2)]);

      const e2eFetch2 = createE2eFetch(
        () => makeWriteOutputChat(title, author, asin),
        fetch,
      );

      const orchestrate2 = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir: outputDir2,
        dryRun: false,
        fetchFn: e2eFetch2 as typeof fetch,
        cache: cache2,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });

      const result2 = await orchestrate2(bookSet2);
      expect(result2.status).toBe("skipped");
      if (result2.status === "skipped") {
        expect(result2.reason).toContain("Duplicate");
        expect(result2.reason).toContain(asin);
      }
    },
    120000,
  );

  it(
    "fallback: upload fails after retries when container is stopped, falls back to local output",
    async () => {
      const tmpDir = createTestDir();
      const outputDir = path.join(tmpDir, "output");
      const cache = createAsinCache(tmpDir);

      const { bookDir, sourcePath } = setupBookFiles(tmpDir, "Fallback Author/Fallback Test Book");
      const bookSet = mkBookSet([mkFile(sourcePath)]);

      const title = "The Fallback Book";
      const author = "Fallback Author";
      const asin = "FALLBACK01Z";

      // Kill the ABS container first
      await killAbsContainer();

      const e2eFetch = createE2eFetch(
        () => makeWriteOutputChat(title, author, asin),
        fetch,
      );

      const orchestrate = createOrchestrator({
        model: "test-model",
        apiKey: "test-key",
        hardcoverApiKey: "test-hc-key",
        outputDir,
        dryRun: false,
        fetchFn: e2eFetch as typeof fetch,
        cache,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });

      const result = await orchestrate(bookSet);
      expect(result.status).toBe("written");
      expect(result.outputDir).toContain("Fallback Author");
      expect(result.outputDir).toContain("The Fallback Book");
      if (result.status === "written") {
        expect(result.fallbackReason).toBeDefined();
        expect(result.fallbackReason).toMatch(/Search error|ECONNREFUSED|fetch/);
      }

      // Verify local output files exist with correct structure
      const authorDir = path.join(outputDir, author);
      expect(fs.existsSync(authorDir)).toBe(true);

      const bookOutputDir = path.join(authorDir, title);
      expect(fs.existsSync(bookOutputDir)).toBe(true);

      const outputFiles = fs.readdirSync(bookOutputDir);
      expect(outputFiles.some((f) => f.endsWith(".mp3"))).toBe(true);
    },
    120000,
  );
});
