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

vi.mock("../src/providers/audible.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/audible.js")>("../src/providers/audible.js");
  return {
    ...actual,
    searchAudibleCatalog: vi.fn(),
  };
});

vi.mock("../src/providers/audnexus.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/audnexus.js")>("../src/providers/audnexus.js");
  return {
    ...actual,
    lookupAudnexusBook: vi.fn(),
  };
});

vi.mock("../src/providers/open-library.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/open-library.js")>("../src/providers/open-library.js");
  return {
    ...actual,
    searchOpenLibraryAsin: vi.fn(),
    searchOpenLibraryByIsbn: vi.fn(),
  };
});

vi.mock("../src/providers/hardcover.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/hardcover.js")>("../src/providers/hardcover.js");
  return {
    ...actual,
    searchHardcoverAsin: vi.fn(),
  };
});

vi.mock("../src/providers/lubimyczytac.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/lubimyczytac.js")>("../src/providers/lubimyczytac.js");
  return {
    ...actual,
    searchLubimyczytac: vi.fn(),
  };
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
  vi.resetAllMocks();
  mockSearchAudible.mockResolvedValue(null as never);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deterministic-search-test-"));
  outputDir = path.join(tmpDir, "output");
  cache = createAsinCache(tmpDir);
});

function createTempFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from("fake mp3 data"));
  return filePath;
}

import { deterministicSearch, resolveRouting } from "../src/deterministic-search.js";
import { searchAudibleCatalog } from "../src/providers/audible.js";
import { lookupAudnexusBook } from "../src/providers/audnexus.js";
import { searchOpenLibraryAsin, searchOpenLibraryByIsbn } from "../src/providers/open-library.js";
import { searchHardcoverAsin } from "../src/providers/hardcover.js";
import { searchLubimyczytac } from "../src/providers/lubimyczytac.js";

const mockSearchAudible = vi.mocked(searchAudibleCatalog);
const mockLookupAudnexus = vi.mocked(lookupAudnexusBook);
const mockSearchOL = vi.mocked(searchOpenLibraryAsin);
const mockSearchOLByIsbn = vi.mocked(searchOpenLibraryByIsbn);
const mockSearchHC = vi.mocked(searchHardcoverAsin);
const mockSearchLubimyczytac = vi.mocked(searchLubimyczytac);

function makeBaseConfig() {
  return {
    cache,
    hardcoverApiKey: "test-hc",
    outputDir,
    dryRun: true,
    outputMode: "local" as const,
    absUrl: "",
    absApiToken: "",
    absLibraryId: "",
    localCover: null,
  };
}

function setupBook(dir: string): BookSet {
  const bookDir = path.join(tmpDir, ...dir.split("/"));
  fs.mkdirSync(bookDir, { recursive: true });
  createTempFile(bookDir, "chapter.mp3");
  return mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);
}

describe("deterministicSearch", () => {
  it("cache hit → Audnexus enrichment → writes output", async () => {
    const bookSet = setupBook("Author/Test Book");
    cache.set("Test Book/Author", "B001TEST01");

    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST01",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Narrator Name" }],
      image: "https://example.com/cover.jpg",
      runtimeLengthMin: 600,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());
    expect(result.status).toBe("written");
    expect(mockLookupAudnexus).toHaveBeenCalledWith("B001TEST01", { fetchFn: undefined });
  });

  it("cache hit with Audnexus failure writes without enrichment", async () => {
    const bookSet = setupBook("Author/Test Book");
    cache.set("Test Book/Author", "B001TEST01");
    mockLookupAudnexus.mockResolvedValueOnce(null as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());
    expect(result.status).toBe("written");
  });

  it("OL+HC parallel search → merge results → writes output", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce("B001TEST02" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce({
      coverId: 12345,
      title: "Test Book",
      authorName: ["Author"],
    } as never);
    mockSearchHC.mockResolvedValueOnce({
      asin: "B001TEST02",
      series: "The Test Series",
      seriesSequence: "3",
    } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST02",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Narrator Name" }],
      image: "https://example.com/cover.jpg",
      runtimeLengthMin: 600,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B001TEST02");
    expect(mockSearchOL).toHaveBeenCalled();
    expect(mockSearchHC).toHaveBeenCalled();
  });

  it("OL succeeds, HC fails gracefully → writes output", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce("B001TEST03" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce({
      coverId: 0,
      title: "Test Book",
      authorName: ["Author"],
    } as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);
    mockLookupAudnexus.mockResolvedValueOnce(null as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B001TEST03");
  });

  it("HC succeeds with ASIN, OL returns nothing → writes output", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({
      asin: "B001TEST04",
      series: "Series Name",
      seriesSequence: "1",
    } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST04",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [],
      image: null,
      runtimeLengthMin: 0,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B001TEST04");
  });

  it("HC skipped when API key is not configured", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockLookupAudnexus.mockResolvedValueOnce(null as never);

    const config = makeBaseConfig();
    config.hardcoverApiKey = "";

    const result = await deterministicSearch(bookSet, "Test Book", "Author", config);

    expect(result.status).toBe("fallthrough");
    expect(mockSearchHC).not.toHaveBeenCalled();
  });

  it("both providers fail → fallthrough", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("fallthrough");
  });

  it("fuzzy match fails on Audnexus title → fallthrough", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchOL.mockResolvedValueOnce("B001TEST05" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST05",
      title: "Completely Different Book",
      authors: [{ name: "Other Author" }],
      narrators: [],
      image: null,
      runtimeLengthMin: 0,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("fallthrough");
  });

  it("fuzzy match handles substring matches", async () => {
    const bookSet = setupBook("Author/Test");

    mockSearchOL.mockResolvedValueOnce("B001TEST06" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST06",
      title: "Test Book: Extended Edition",
      authors: [{ name: "Author Name" }],
      narrators: [],
      image: null,
      runtimeLengthMin: 0,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
  });

  it("Audible returns result → uses Audible metadata, skips Audnexus", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00AUDIBLE",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Audible Narrator" }],
      series: [{ name: "Audible Series", sequence: "2" }],
      description: "A thrilling audiobook",
      genres: ["Fiction", "Adventure"],
      publisher: "Audible Originals",
      language: "english",
      coverUrl: "https://audible.com/cover.jpg",
      durationMinutes: 720,
      isbn: "9780000000001",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B00AUDIBLE");
    expect(mockLookupAudnexus).not.toHaveBeenCalled();
  });

  it("Audible returns null → falls back to OL + HC + Audnexus", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce(null as never);
    mockSearchOL.mockResolvedValueOnce("B00OLONLY" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce({ coverId: 0 } as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B00OLONLY",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [{ name: "Audnexus Narrator" }],
      image: null,
      runtimeLengthMin: 0,
      description: null,
      genres: [],
      publisherName: null,
      language: null,
      isbn: null,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B00OLONLY");
    expect(mockLookupAudnexus).toHaveBeenCalled();
  });

  it("Audible returns, HC supplements series when Audible has none", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00AUDIBLE",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({
      asin: "B00AUDIBLE",
      series: "HC Series Name",
      seriesSequence: "1",
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
    expect(cache.get("Test Book/Author")).toBe("B00AUDIBLE");
    expect(mockLookupAudnexus).not.toHaveBeenCalled();
  });

  it("Audible fuzzy match fails on title → fallthrough", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00AUDIBLE",
      title: "Different Book Title",
      authors: [{ name: "Author" }],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("fallthrough");
    if (result.status === "fallthrough") {
      expect(result.reason).toContain("Fuzzy match failed");
    }
  });

  it("fuzzy match handles punctuation differences", async () => {
    const bookSet = setupBook("Author/Test");

    mockSearchOL.mockResolvedValueOnce("B001TEST07" as never);
    mockSearchOLByIsbn.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);
    mockLookupAudnexus.mockResolvedValueOnce({
      asin: "B001TEST07",
      title: "Test, Book!",
      authors: [{ name: "Author" }],
      narrators: [],
      image: null,
      runtimeLengthMin: 0,
    } as never);

    const result = await deterministicSearch(bookSet, "Test Book", "Author", makeBaseConfig());

    expect(result.status).toBe("written");
  });
});

describe("resolveRouting", () => {
  it("maps 'es' to audible region 'es' with all providers", () => {
    const routing = resolveRouting("es");
    expect(routing.audibleRegion).toBe("es");
    expect(routing.providers).toEqual(["audible", "ol", "hc"]);
  });

  it("maps undefined to audible region 'com' with all providers", () => {
    const routing = resolveRouting(undefined);
    expect(routing.audibleRegion).toBe("com");
    expect(routing.providers).toEqual(["audible", "ol", "hc"]);
  });

  it("maps unknown language to audible region 'com' with all providers", () => {
    const routing = resolveRouting("ja");
    expect(routing.audibleRegion).toBe("com");
    expect(routing.providers).toEqual(["audible", "ol", "hc"]);
  });

  it("maps 'en' to audible region 'com' with all providers", () => {
    const routing = resolveRouting("en");
    expect(routing.audibleRegion).toBe("com");
    expect(routing.providers).toEqual(["audible", "ol", "hc"]);
  });

  it("maps 'pl' to audible region 'com' with OL, HC, and lubimyczytac providers", () => {
    const routing = resolveRouting("pl");
    expect(routing.audibleRegion).toBe("com");
    expect(routing.providers).toEqual(["ol", "hc", "lubimyczytac"]);
  });

  it("maps 'no' to audible region 'com' with all providers", () => {
    const routing = resolveRouting("no");
    expect(routing.audibleRegion).toBe("com");
    expect(routing.providers).toEqual(["audible", "ol", "hc"]);
  });
});

describe("deterministicSearch with language routing", () => {
  it("passes region 'es' to searchAudibleCatalog when language is 'es'", async () => {
    const bookSet = setupBook("Autor/Libro de Prueba");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00ESBOOK",
      title: "Libro de Prueba",
      authors: [{ name: "Autor" }],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "español",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const config = makeBaseConfig();
    config.language = "es";

    const result = await deterministicSearch(bookSet, "Libro de Prueba", "Autor", config);

    expect(result.status).toBe("written");
    expect(mockSearchAudible).toHaveBeenCalledWith(
      { title: "Libro de Prueba", author: "Autor" },
      { fetchFn: undefined, region: "es" },
    );
  });

  it("passes region 'com' to searchAudibleCatalog when language is undefined", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00DEFAULT",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "english",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const config = makeBaseConfig();

    const result = await deterministicSearch(bookSet, "Test Book", "Author", config);

    expect(result.status).toBe("written");
    expect(mockSearchAudible).toHaveBeenCalledWith(
      { title: "Test Book", author: "Author" },
      { fetchFn: undefined, region: "com" },
    );
  });

  it("passes region 'com' to searchAudibleCatalog when language is 'en'", async () => {
    const bookSet = setupBook("Author/Test Book");

    mockSearchAudible.mockResolvedValueOnce({
      asin: "B00ENBOOK",
      title: "Test Book",
      authors: [{ name: "Author" }],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "english",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const config = makeBaseConfig();
    config.language = "en";

    const result = await deterministicSearch(bookSet, "Test Book", "Author", config);

    expect(result.status).toBe("written");
    expect(mockSearchAudible).toHaveBeenCalledWith(
      { title: "Test Book", author: "Author" },
      { fetchFn: undefined, region: "com" },
    );
  });

  it("PL routing: calls lubimyczytac and skips audible, uses result as primary metadata", async () => {
    const bookSet = setupBook("Autor/Zamek");

    mockSearchLubimyczytac.mockResolvedValueOnce({
      title: "Zamek",
      authors: [{ name: "Autor" }],
      series: [{ name: "Seria Zamków", sequence: "3" }],
      description: "Opis książki",
      genres: ["fantasy", "przygodowa"],
      publisher: "Wydawnictwo Testowe",
      language: "polski",
      coverUrl: "https://example.com/cover.jpg",
      isbn: "9788300000001",
      lubimyczytacId: "123456",
    } as never);

    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const config = makeBaseConfig();
    config.language = "pl";

    const result = await deterministicSearch(bookSet, "Zamek", "Autor", config);

    expect(result.status).toBe("written");
    expect(mockSearchLubimyczytac).toHaveBeenCalledWith(
      { title: "Zamek", author: "Autor" },
      { fetchFn: undefined },
    );
    expect(mockSearchAudible).not.toHaveBeenCalled();
    expect(cache.get("Zamek/Autor")).toBe("9788300000001");
  });

  it("PL routing: falls through when lubimyczytac returns null and OL+HC fail", async () => {
    const bookSet = setupBook("Autor/Nieznana");

    mockSearchLubimyczytac.mockResolvedValueOnce(null as never);
    mockSearchOL.mockResolvedValueOnce(null as never);
    mockSearchHC.mockResolvedValueOnce({ asin: null } as never);

    const config = makeBaseConfig();
    config.language = "pl";

    const result = await deterministicSearch(bookSet, "Nieznana", "Autor", config);

    expect(result.status).toBe("fallthrough");
    expect(mockSearchLubimyczytac).toHaveBeenCalled();
    expect(mockSearchAudible).not.toHaveBeenCalled();
  });
});
