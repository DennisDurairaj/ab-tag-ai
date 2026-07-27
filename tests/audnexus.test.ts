import { describe, it, expect } from "vitest";
import { lookupAudnexusBook } from "../src/providers/audnexus.js";

interface MockCall {
  url: string;
  init?: RequestInit;
}

function createMockFetch(response: { status: number; body: unknown }) {
  const calls: MockCall[] = [];

  const mockFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  };

  return { mockFn, calls };
}

describe("lookupAudnexusBook", () => {
  it("returns book metadata when ASIN lookup succeeds", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        asin: "B08G9PRS1K",
        title: "Project Hail Mary",
        authors: [{ asin: "B00G0WYW92", name: "Andy Weir" }],
        narrators: [{ name: "Ray Porter" }],
        publisherName: "Audible Studios",
        releaseDate: "2021-05-04T00:00:00.000Z",
        runtimeLengthMin: 970,
        description: "When the Sun is threatened...",
        summary: "<p>Full summary</p>",
        image: "https://m.media-amazon.com/...",
        rating: "4.9",
        genres: [{ asin: "g1", name: "Sci-Fi", type: "genre" }],
        language: "english",
        isbn: "9781603935470",
        copyright: 2021,
        formatType: "unabridged",
        literatureType: "fiction",
        isAdult: false,
      },
    });

    const result = await lookupAudnexusBook("B08G9PRS1K", { fetchFn: mockFn });
    expect(result).toEqual({
      asin: "B08G9PRS1K",
      title: "Project Hail Mary",
      authors: [{ asin: "B00G0WYW92", name: "Andy Weir" }],
      narrators: [{ name: "Ray Porter" }],
      publisherName: "Audible Studios",
      releaseDate: "2021-05-04T00:00:00.000Z",
      runtimeLengthMin: 970,
      description: "When the Sun is threatened...",
      summary: "<p>Full summary</p>",
      image: "https://m.media-amazon.com/...",
      rating: "4.9",
      genres: [{ asin: "g1", name: "Sci-Fi", type: "genre" }],
      language: "english",
      isbn: "9781603935470",
      copyright: 2021,
      formatType: "unabridged",
      literatureType: "fiction",
      isAdult: false,
    });

    expect(calls[0].url).toBe(
      "https://api.audnex.us/books/B08G9PRS1K?region=us",
    );
    expect(calls[0].url).not.toContain("/books/search");
  });

  it("returns null on 404", async () => {
    const { mockFn } = createMockFetch({
      status: 404,
      body: {
        error: { code: "NOT_FOUND", message: "Book not found" },
      },
    });

    const result = await lookupAudnexusBook("B000000000", { fetchFn: mockFn });
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const { mockFn } = createMockFetch({
      status: 500,
      body: {
        error: { code: "SERVER_ERROR", message: "Internal error" },
      },
    });

    const result = await lookupAudnexusBook("B08G9PRS1K", { fetchFn: mockFn });
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };
    const result = await lookupAudnexusBook("B08G9PRS1K", { fetchFn: mockFn });
    expect(result).toBeNull();
  });

  it("uses default region us when not specified", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { asin: "B08G9PRS1K", title: "Test" },
    });

    await lookupAudnexusBook("B08G9PRS1K", { fetchFn: mockFn });
    expect(calls[0].url).toContain("region=us");
  });

  it("uses custom region when specified", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { asin: "B08G9PRS1K", title: "Test" },
    });

    await lookupAudnexusBook("B08G9PRS1K", { fetchFn: mockFn, region: "uk" });
    expect(calls[0].url).toContain("region=uk");
  });
});
