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

vi.mock("../src/providers/audnexus.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/audnexus.js")>("../src/providers/audnexus.js");
  return {
    ...actual,
    lookupAudnexusBook: vi.fn(),
  };
});

vi.mock("../src/providers/metadata-resolver.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/metadata-resolver.js")>("../src/providers/metadata-resolver.js");
  return { ...actual, fetchNextCandidate: vi.fn() };
});

vi.mock("../src/providers/cover-art.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/cover-art.js")>("../src/providers/cover-art.js");
  return {
    ...actual,
    findLocalCoverArt: vi.fn(() => Promise.resolve(null)),
    downloadAndResizeCover: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock("../src/providers/abs-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/abs-client.js")>("../src/providers/abs-client.js");
  return {
    ...actual,
    createAbsClient: vi.fn(() => ({
      searchLibrary: vi.fn(() => Promise.resolve({ book: [] })),
      getLibrary: vi.fn(() => Promise.resolve({ folders: [{ id: "folder-1" }] })),
      uploadFiles: vi.fn(() => Promise.resolve()),
      scanLibrary: vi.fn(() => Promise.resolve()),
      updateMedia: vi.fn(() => Promise.resolve()),
      matchItem: vi.fn(() => Promise.resolve({ updated: true })),
      getItem: vi.fn(() => Promise.resolve({ libraryItem: { media: { metadata: { authorName: "Author", title: "Test Book" } } } })),
      uploadCover: vi.fn(() => Promise.resolve()),
    })),
  };
});

function mkFile(filePath: string, meta: Record<string, string> = {}): AudioFile {
  return { path: filePath, format: "mp3", existingMetadata: meta };
}

function mkBookSet(files: AudioFile[], title = "Unknown Book", author = ""): BookSet {
  return { books: [{ path: files[0].path, title, author, asin: "" }], files };
}

let tmpDir: string;
let outputDir: string;
let cache: ReturnType<typeof createAsinCache>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deterministic-search-test-"));
  outputDir = path.join(tmpDir, "output");
  cache = createAsinCache(tmpDir);
});

function createTempFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from("fake mp3 data"));
  return filePath;
}

import { deterministicSearch } from "../src/deterministic-search.js";
import { lookupAudnexusBook } from "../src/providers/audnexus.js";
import { fetchNextCandidate } from "../src/providers/metadata-resolver.js";

const mockLookupAudnexus = vi.mocked(lookupAudnexusBook);
const mockFetchNextCandidate = vi.mocked(fetchNextCandidate);

describe("deterministicSearch", () => {
  it("cache hit → Audnexus enrichment → writes output", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    cache.set("Test Book/Author", "B001TEST01");

    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST01",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Narrator Name" }],
      image: "https://example.com/cover.jpg",
      runtimeLengthMin: 600,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("written");
    expect(mockLookupAudnexus).toHaveBeenCalledWith("B001TEST01", { fetchFn: undefined });
  });

  it("cache hit with Audnexus failure writes without enrichment", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    cache.set("Test Book/Author", "B001TEST01");
    mockLookupAudnexus.mockResolvedValueOnce(null as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("written");
  });

  it("cache miss → fetchNextCandidate → fuzzy match success → writes output", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    mockFetchNextCandidate.mockResolvedValueOnce({
      metadata: {
        title: "Test Book",
        author: "Author",
        asin: "B001TEST02",
        narrator: "Narrator Name",
        coverUrl: "https://example.com/cover.jpg",
      },
      source: "open-library",
    });

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B001TEST02");
  });

  it("cache miss → fetchNextCandidate → fuzzy match fails → fallthrough", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    mockFetchNextCandidate.mockResolvedValueOnce({
      metadata: {
        title: "Completely Different Book",
        author: "Other Author",
        asin: "B001TEST03",
      },
      source: "open-library",
    });

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("fallthrough");
  });

  it("cache miss → no provider results → fallthrough", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    mockFetchNextCandidate.mockResolvedValueOnce({
      metadata: null,
      source: "none",
    });

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("fallthrough");
  });

  it("fuzzy match handles substring matches", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    mockFetchNextCandidate.mockResolvedValueOnce({
      metadata: {
        title: "Test Book: Extended Edition",
        author: "Author Name",
        asin: "B001TEST04",
      },
      source: "hardcover",
    });

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("written");
  });

  it("fuzzy match handles punctuation differences", async () => {
    const bookDir = path.join(tmpDir, "Author", "Test");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    mockFetchNextCandidate.mockResolvedValueOnce({
      metadata: {
        title: "Test, Book!",
        author: "Author",
        asin: "B001TEST05",
      },
      source: "open-library",
    });

    const result = await deterministicSearch(bookSet, "Test Book", "Author", {
      cache,
      hardcoverApiKey: "test-hc",
      outputDir,
      dryRun: true,
      outputMode: "local",
      absUrl: "",
      absApiToken: "",
      absLibraryId: "",
      localCover: null,
    });

    expect(result.status).toBe("written");
  });
});
