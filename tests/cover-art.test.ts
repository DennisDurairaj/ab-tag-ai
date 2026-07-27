import { describe, it, expect } from "vitest";
import { downloadAndResizeCover } from "../src/providers/cover-art.js";

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
