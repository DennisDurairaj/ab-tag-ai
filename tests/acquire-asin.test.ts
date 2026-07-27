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

describe("acquireAsin", () => {
  it("returns cached ASIN when available", async () => {
    const cache = createMockCache({ "The Hobbit/Tolkien": "B000002IX7" });
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "cache" });
  });

  it("caches result when ASIN is found via Open Library", async () => {
    let savedKey = "";
    let savedAsin = "";
    const cache: AsinCache = {
      get() { return undefined; },
      set(key: string, asin: string) { savedKey = key; savedAsin = asin; },
      save() {},
    };
    await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      searchOpenLibrary: async () => "B000002IX7",
      searchHardcover: async () => null,
    });
    expect(savedKey).toBe("The Hobbit/Tolkien");
    expect(savedAsin).toBe("B000002IX7");
  });

  it("searches Open Library first when nothing in cache", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "",
      searchOpenLibrary: async () => "B000002IX7",
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "open-library" });
  });

  it("falls back to Hardcover when Open Library returns nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => "B00B8LXTKW",
    });
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "hardcover" });
  });

  it("falls back to filename when providers return nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "filename" });
  });

  it("tries filename patterns before Audible URLs", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B000002IX7.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
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
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "filename" });
  });

  it("returns null when all sources fail", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "Unknown", author: "Nobody" },
      filePaths: ["/books/unknown.mp3"],
      cache,
      hardcoverApiKey: "test-key",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: null, source: "none" });
  });

  it("does not search Hardcover when no API key", async () => {
    let hardcoverCalled = false;
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/the-hobbit.mp3"],
      cache,
      hardcoverApiKey: "",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => { hardcoverCalled = true; return null; },
    });
    expect(hardcoverCalled).toBe(false);
    expect(result).toEqual({ asin: null, source: "none" });
  });

  it("returns existing ASIN when verification succeeds", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: async () => null,
      verifyAsinFn: async () => true,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "existing-verified" });
  });

  it("skips to Open Library when existing ASIN verification fails", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: async () => null,
      verifyAsinFn: async () => false,
    });
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "open-library" });
  });

  it("skips verification when existing ASIN is invalid format", async () => {
    let verifyCalled = false;
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "INVALID",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: async () => null,
      verifyAsinFn: async () => { verifyCalled = true; return false; },
    });
    expect(verifyCalled).toBe(false);
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "open-library" });
  });

  it("skips verification when existing ASIN is empty", async () => {
    let verifyCalled = false;
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: async () => null,
      verifyAsinFn: async () => { verifyCalled = true; return false; },
    });
    expect(verifyCalled).toBe(false);
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "open-library" });
  });

  it("skips verification when verifyAsinFn is not provided", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => "B00B8LXTKW",
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: "B000002IX7", source: "existing-verified" });
  });

  it("cached ASIN takes priority over existing ASIN verification", async () => {
    const cache = createMockCache({ "The Hobbit/Tolkien": "B00CACHED" });
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: [],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
      verifyAsinFn: async () => false,
    });
    expect(result).toEqual({ asin: "B00CACHED", source: "cache" });
  });

  it("falls back to filename when existing ASIN verification fails and providers return nothing", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/B00B8LXTKW.mp3"],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
      verifyAsinFn: async () => false,
    });
    expect(result).toEqual({ asin: "B00B8LXTKW", source: "filename" });
  });

  it("falls back to Audible URL when providers and filename patterns fail", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "The Hobbit", author: "Tolkien" },
      filePaths: ["/books/readme.txt"],
      cache,
      hardcoverApiKey: "",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
    });
    expect(result).toEqual({ asin: null, source: "none" });
  });

  it("returns null when existing ASIN verification fails and all sources fail", async () => {
    const cache = createMockCache();
    const result = await acquireAsin({
      identity: { title: "Unknown Book", author: "Nobody" },
      filePaths: ["/books/unknown.mp3"],
      cache,
      hardcoverApiKey: "",
      existingAsin: "B000002IX7",
      searchOpenLibrary: async () => null,
      searchHardcover: async () => null,
      verifyAsinFn: async () => false,
    });
    expect(result).toEqual({ asin: null, source: "none" });
  });
});

