import { describe, it, expect } from "vitest";
import { acquireAsin } from "../src/providers/asin.js";
import type { AsinCache } from "../src/providers/asin.js";

function createMockCache(data: Record<string, string> = {}): AsinCache {
  const store = { ...data };
  return {
    get(key: string) { return store[key]; },
    set(key: string, asin: string) { store[key] = asin; },
    save() {},
  };
}

const never = async () => null;

describe("acquireAsin", () => {
  it("returns cached ASIN when available", async () => {
    const cache = createMockCache({ "The Hobbit/Tolkien": "B000002IX7" });
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "cache" });
  });

  it("extracts ASIN from filename when not in cache", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "filename" });
  });

  it("caches ASIN found from filename", async () => {
    let savedKey = "";
    let savedAsin = "";
    const cache: AsinCache = {
      get() { return undefined; },
      set(key: string, asin: string) { savedKey = key; savedAsin = asin; },
      save() {},
    };
    await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(savedKey).toBe("The Hobbit/Tolkien");
    expect(savedAsin).toBe("B000002IX7");
  });

  it("searches Audnexus first when nothing in cache", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: async () => "AUDNEXUS001",
      searchOpenLibrary: async () => "OPENLIB002",
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "AUDNEXUS001", source: "audnexus" });
  });

  it("falls back to Open Library when Audnexus returns nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: never,
      searchOpenLibrary: async () => "B000002IX7",
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "open-library" });
  });

  it("falls back to Hardcover when Audnexus and Open Library return nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: async () => "B00B8LXTKW",
    });
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "hardcover" });
  });

  it("returns null when all sources fail", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "Unknown", author: "Nobody" },
      filePaths: ["/books/unknown.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: null, source: "none" });
  });

  it("tries Audnexus before filename patterns", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: async () => "AUDNEXUS001",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "AUDNEXUS001", source: "audnexus" });
  });

  it("falls back to filename when all providers return nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "filename" });
  });

  it("checks multiple file paths for ASIN in filename", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/ch01.mp3", "/books/ch02.mp3", "/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "",
      searchAudnexus: never,
      searchOpenLibrary: never,
      searchHardcover: never,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "filename" });
  });
});
