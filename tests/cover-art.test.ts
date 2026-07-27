import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { downloadAndResizeCover } from "../src/providers/cover-art.js";
import { writeCoverArt } from "../src/utils.js";

const VALID_JPEG_BASE64 = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABkAGQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnQCOaRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/2Q==";

function createMockFetch(response: { status: number; body: Buffer | string }) {
  return async (url: string) => {
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": "image/jpeg" },
    });
  };
}

function createMockImageBuffer(): Buffer {
  return Buffer.from(VALID_JPEG_BASE64, "base64");
}

describe("downloadAndResizeCover", () => {
  it("returns null when no coverUrl or coverId provided", async () => {
    const result = await downloadAndResizeCover({});
    expect(result).toBeNull();
  });

  it("returns null when coverId is 0", async () => {
    const result = await downloadAndResizeCover({ coverId: 0 });
    expect(result).toBeNull();
  });

  it("downloads from coverUrl when provided", async () => {
    const mockBuffer = createMockImageBuffer();
    const mockFetch = createMockFetch({ status: 200, body: mockBuffer });

    const result = await downloadAndResizeCover({
      coverUrl: "https://example.com/cover.jpg",
      fetchFn: mockFetch,
    });

    expect(result).not.toBeNull();
  });

  it("builds Open Library cover URL from coverId", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => {
      capturedUrl = url;
      return new Response(createMockImageBuffer(), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    };

    await downloadAndResizeCover({
      coverId: 258027,
      fetchFn: mockFetch,
    });

    expect(capturedUrl).toBe("https://covers.openlibrary.org/b/id/258027-L.jpg");
  });

  it("prefers coverUrl over coverId when both provided", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string) => {
      capturedUrl = url;
      return new Response(createMockImageBuffer(), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      });
    };

    await downloadAndResizeCover({
      coverUrl: "https://custom.example.com/art.jpg",
      coverId: 258027,
      fetchFn: mockFetch,
    });

    expect(capturedUrl).toBe("https://custom.example.com/art.jpg");
  });

  it("returns null on HTTP error", async () => {
    const mockFetch = createMockFetch({ status: 404, body: "Not found" });

    const result = await downloadAndResizeCover({
      coverUrl: "https://example.com/missing.jpg",
      fetchFn: mockFetch,
    });

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFetch = async () => {
      throw new Error("Network failure");
    };

    const result = await downloadAndResizeCover({
      coverUrl: "https://example.com/cover.jpg",
      fetchFn: mockFetch,
    });

    expect(result).toBeNull();
  });

  it("returns null when content-type is not an image", async () => {
    const mockFetch = async () => {
      return new Response("not an image", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };

    const result = await downloadAndResizeCover({
      coverUrl: "https://example.com/cover.jpg",
      fetchFn: mockFetch,
    });

    expect(result).toBeNull();
  });

  it("accepts image/png content-type", async () => {
    const mockBuffer = createMockImageBuffer();
    const mockFetch = async () => {
      return new Response(mockBuffer, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    };

    const result = await downloadAndResizeCover({
      coverUrl: "https://example.com/cover.png",
      fetchFn: mockFetch,
    });

    expect(result).not.toBeNull();
  });
});

describe("writeCoverArt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cover-art-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when coverArt buffer is null", () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    const result = writeCoverArt(null, bookDir);
    expect(result).toBeNull();
  });

  it("returns null when coverArt buffer is undefined", () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    const result = writeCoverArt(undefined, bookDir);
    expect(result).toBeNull();
  });

  it("writes cover.jpg to book directory", () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    const buffer = Buffer.from("fake image data");

    const result = writeCoverArt(buffer, bookDir);

    expect(result).toBe(path.join(bookDir, "cover.jpg"));
    expect(fs.existsSync(result!)).toBe(true);
  });

  it("creates book directory if it does not exist", () => {
    const bookDir = path.join(tmpDir, "Author", "Series", "Book");
    const buffer = Buffer.from("fake image data");

    const result = writeCoverArt(buffer, bookDir);

    expect(result).not.toBeNull();
    expect(fs.existsSync(bookDir)).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "cover.jpg"))).toBe(true);
  });

  it("overwrites existing cover.jpg", () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    fs.writeFileSync(path.join(bookDir, "cover.jpg"), "old data");

    const buffer = Buffer.from("new image data");
    const result = writeCoverArt(buffer, bookDir);

    expect(result).not.toBeNull();
    const contents = fs.readFileSync(path.join(bookDir, "cover.jpg"));
    expect(contents.equals(buffer)).toBe(true);
  });
});
