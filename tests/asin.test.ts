import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { validateAsin, extractAsinFromFilename, extractAsinFromAudibleUrl, createAsinCache, verifyAsin, type AsinCache } from "../src/providers/asin.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asin-cache-test-"));
}

describe("validateAsin", () => {
  it("returns true for a valid 10-character uppercase ASIN", () => {
    expect(validateAsin("B000002IX7")).toBe(true);
  });

  it("returns true for a valid 10-character mixed-case ASIN", () => {
    expect(validateAsin("B00B8LxTKW")).toBe(true);
  });

  it("returns false for a string shorter than 10 characters", () => {
    expect(validateAsin("B000002IX")).toBe(false);
  });

  it("returns false for a string longer than 10 characters", () => {
    expect(validateAsin("B000002IX7X")).toBe(false);
  });

  it("returns false for a string with special characters", () => {
    expect(validateAsin("B00B8L-TKW")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(validateAsin("")).toBe(false);
  });

  it("returns false for nullish or undefined", () => {
    expect(validateAsin(null as unknown as string)).toBe(false);
    expect(validateAsin(undefined as unknown as string)).toBe(false);
  });
});

describe("extractAsinFromFilename", () => {
  it("extracts ASIN when filename contains a standalone ASIN pattern", () => {
    expect(extractAsinFromFilename("B000002IX7.mp3")).toBe("B000002IX7");
  });

  it("extracts ASIN when filename contains ASIN with brackets", () => {
    expect(extractAsinFromFilename("[B00B8LXTKW] The Title.mp3")).toBe("B00B8LXTKW");
  });

  it("extracts ASIN when filename contains ASIN with parentheses", () => {
    expect(extractAsinFromFilename("Title (B00C4G9T3K).mp3")).toBe("B00C4G9T3K");
  });

  it("extracts ASIN from filename with hyphens and spaces", () => {
    expect(extractAsinFromFilename("Author - Title - B01D5H8M2N.mp3")).toBe("B01D5H8M2N");
  });

  it("returns null for filename without ASIN pattern", () => {
    expect(extractAsinFromFilename("The Great Book.mp3")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractAsinFromFilename("")).toBeNull();
  });

  it("returns the last valid ASIN match when multiple patterns exist", () => {
    const result = extractAsinFromFilename("B000002IX7 and B00B8LXTKW.mp3");
    expect(result).toBe("B00B8LXTKW");
  });
});

describe("extractAsinFromAudibleUrl", () => {
  it("extracts ASIN from audible.com/pd URL", () => {
    expect(extractAsinFromAudibleUrl("https://www.audible.com/pd/The-Hobbit/B000002IX7")).toBe("B000002IX7");
  });

  it("extracts ASIN from audible.com/audiobook URL", () => {
    expect(extractAsinFromAudibleUrl("https://www.audible.com/audiobook/The-Hobbit/B00B8LXTKW")).toBe("B00B8LXTKW");
  });

  it("returns null for non-Audible URLs", () => {
    expect(extractAsinFromAudibleUrl("https://example.com/book/12345")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractAsinFromAudibleUrl("")).toBeNull();
  });

  it("returns null when the ASIN part is not 10 chars", () => {
    expect(extractAsinFromAudibleUrl("https://www.audible.com/pd/Book/SHORT")).toBeNull();
  });
});

describe("AsinCache", () => {
  it("returns empty map when cache file does not exist", () => {
    const tmpDir = makeTmpDir();
    const cache = createAsinCache(tmpDir);
    expect(cache.get("any-key")).toBeUndefined();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores and retrieves cached ASINs", () => {
    const tmpDir = makeTmpDir();
    const cache = createAsinCache(tmpDir);
    cache.set("book1", "B000002IX7");
    expect(cache.get("book1")).toBe("B000002IX7");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists cache to disk and reloads it", () => {
    const tmpDir = makeTmpDir();
    const cache1 = createAsinCache(tmpDir);
    cache1.set("book1", "B000002IX7");
    cache1.save();

    const cache2 = createAsinCache(tmpDir);
    expect(cache2.get("book1")).toBe("B000002IX7");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("overwrites existing values for the same key", () => {
    const tmpDir = makeTmpDir();
    const cache = createAsinCache(tmpDir);
    cache.set("book1", "B000002IX7");
    cache.set("book1", "B00B8LXTKW");
    expect(cache.get("book1")).toBe("B00B8LXTKW");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles multiple entries", () => {
    const tmpDir = makeTmpDir();
    const cache = createAsinCache(tmpDir);
    cache.set("book1", "B000002IX7");
    cache.set("book2", "B00B8LXTKW");
    expect(cache.get("book1")).toBe("B000002IX7");
    expect(cache.get("book2")).toBe("B00B8LXTKW");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("verifyAsin", () => {
  const AUDNEXUS_RESPONSE = {
    asin: "B08G9PRS1K",
    title: "Project Hail Mary",
    authors: [{ asin: "B00G0WYW92", name: "Andy Weir" }],
    narrators: [{ name: "Ray Porter" }],
    publisherName: "Audible Studios",
    releaseDate: "2021-05-04T00:00:00.000Z",
    runtimeLengthMin: 970,
    description: "Test",
    summary: "Test",
    image: "https://m.media-amazon.com/cover.jpg",
    rating: "4.9",
    genres: [],
    language: "english",
    isbn: "9781603935470",
    copyright: 2021,
    formatType: "unabridged",
    literatureType: "fiction",
    isAdult: false,
  };

  function createMockFetch(response: { status: number; body: unknown }) {
    const mockFn = async (url: string, init?: RequestInit) => {
      return new Response(JSON.stringify(response.body), { status: response.status });
    };
    return { mockFn };
  }

  it("returns true when Audnexus lookup succeeds", async () => {
    const { mockFn } = createMockFetch({ status: 200, body: AUDNEXUS_RESPONSE });
    const result = await verifyAsin({ asin: "B08G9PRS1K", fetchFn: mockFn });
    expect(result).toBe(true);
  });

  it("returns false when Audnexus lookup fails", async () => {
    const { mockFn } = createMockFetch({ status: 404, body: { error: "Not found" } });
    const result = await verifyAsin({ asin: "B08G9PRS1K", fetchFn: mockFn });
    expect(result).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    const mockFn = async () => { throw new Error("Network failure"); };
    const result = await verifyAsin({ asin: "B08G9PRS1K", fetchFn: mockFn });
    expect(result).toBe(false);
  });

  it("returns false for invalid ASIN format", async () => {
    const result = await verifyAsin({ asin: "INVALID" });
    expect(result).toBe(false);
  });
});
