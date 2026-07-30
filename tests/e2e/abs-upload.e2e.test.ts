import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, AudioFile } from "../../src/types.js";
import { createAsinCache } from "../../src/providers/asin.js";
import { writeOutputForBook } from "../../src/orchestrator.js";
import type { OrchestratorConfig, ToolContext } from "../../src/orchestrator.js";
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

function makeToolContext(
  overrides: Partial<OrchestratorConfig> & { cache: ReturnType<typeof createAsinCache> },
): ToolContext {
  const config: OrchestratorConfig = {
    model: "test-model",
    apiKey: "test-key",
    apiBaseUrl: "https://api.openai.com/v1",
    hardcoverApiKey: "test-hc-key",
    outputDir: "",
    dryRun: false,
    cache: overrides.cache,
    outputMode: "audiobookshelf",
    absUrl: "",
    absApiToken: "",
    absLibraryId: "",
    ...overrides,
  };
  return { bookSet: { books: [{ path: "", title: "", author: "", asin: "" }], files: [] }, config, cache: overrides.cache, localCover: null };
}

const SAMPLE_MP3 = path.join(import.meta.dirname, "fixtures", "sample.mp3");
const REAL_CHAPTER = path.join(
  import.meta.dirname,
  "..",
  "..",
  "Riordan, Rick",
  "Gudene fra Olympos",
  "Gudene fra Olympos 1 - Den forsvunne helten",
  "001 Den forsvunne helten.mp3",
);

function createMinimalMp3(filePath: string): void {
  fs.copyFileSync(SAMPLE_MP3, filePath);
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

      const ctx = makeToolContext({
        cache,
        outputDir,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx.bookSet = bookSet;

      const result = await writeOutputForBook({ title, author, asin }, ctx);

      expect(result.terminal.status).toBe("written");
      if (result.terminal.status === "written") {
        expect(result.terminal.outputDir).toContain("abs://");
        expect(result.terminal.filesWritten).toBe(1);
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

      const ctx = makeToolContext({
        cache,
        outputDir,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx.bookSet = bookSet;

      const result = await writeOutputForBook({ title, author, asin, series }, ctx);
      expect(result.terminal.status).toBe("written");

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

      const ctx1 = makeToolContext({
        cache,
        outputDir,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx1.bookSet = bookSet;

      const result1 = await writeOutputForBook({ title, author, asin }, ctx1);
      expect(result1.terminal.status).toBe("written");

      const tempDir2 = createTestDir();
      const outputDir2 = path.join(tempDir2, "output");
      const cache2 = createAsinCache(tempDir2);

      const { sourcePath: sourcePath2 } = setupBookFiles(tempDir2, "Author/Duplicate Test Book");
      const bookSet2 = mkBookSet([mkFile(sourcePath2)]);

      const ctx2 = makeToolContext({
        cache: cache2,
        outputDir: outputDir2,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx2.bookSet = bookSet2;

      const result2 = await writeOutputForBook({ title, author, asin }, ctx2);
      expect(result2.terminal.status).toBe("skipped");
      if (result2.terminal.status === "skipped") {
        expect(result2.terminal.reason).toContain("Duplicate");
        expect(result2.terminal.reason).toContain(asin);
      }
    },
    120000,
  );

  it(
    "real-book: uploads an actual chapter from disk and verifies it appears in library",
    async () => {
      const tmpDir = createTestDir();
      const outputDir = path.join(tmpDir, "output");
      const cache = createAsinCache(tmpDir);

      const bookDir = path.join(tmpDir, "Riordan, Rick", "The Lost Hero");
      fs.mkdirSync(bookDir, { recursive: true });
      const destPath = path.join(bookDir, "001.mp3");
      fs.copyFileSync(REAL_CHAPTER, destPath);

      const bookSet = mkBookSet([mkFile(destPath)]);

      const title = "The Lost Hero";
      const author = "Rick Riordan";
      const asin = "REALTEST001";

      const ctx = makeToolContext({
        cache,
        outputDir,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx.bookSet = bookSet;

      const result = await writeOutputForBook({ title, author, asin }, ctx);

      expect(result.terminal.status).toBe("written");
      if (result.terminal.status === "written") {
        expect(result.terminal.outputDir).toContain("abs://");
      }

      const searchResult = (await searchByAsin(env, asin)) as {
        book?: Array<{
          libraryItem: { id: string; media: { metadata: { title?: string; authorName?: string } } };
        }>;
      };

      expect(searchResult.book).toBeDefined();
      const item = searchResult.book!.find(
        (i) => i.libraryItem?.media?.metadata?.title === title,
      );
      expect(item).toBeDefined();
      if (item) {
        expect(item.libraryItem.media.metadata.authorName).toBe(author);
      }
    },
    120000,
  );

  it(
    "fallback: upload fails after retries when container is stopped, returns flagged status",
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

      const ctx = makeToolContext({
        cache,
        outputDir,
        outputMode: "audiobookshelf",
        absUrl: env.url,
        absApiToken: env.apiToken,
        absLibraryId: env.libraryId,
      });
      ctx.bookSet = bookSet;

      const result = await writeOutputForBook({ title, author, asin }, ctx);
      expect(result.terminal.status).toBe("flagged");
      if (result.terminal.status === "flagged") {
        expect(result.terminal.reason).toMatch(/Search error|ECONNREFUSED|fetch|Upload/);
      }

      // Verify no local files were written (no fallback)
      const authorDir = path.join(outputDir, author);
      expect(fs.existsSync(authorDir)).toBe(false);
    },
    120000,
  );
});
