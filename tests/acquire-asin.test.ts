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
});

