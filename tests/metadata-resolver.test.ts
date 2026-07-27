import { describe, it, expect } from "vitest";
import { resolveMetadata, fetchNextCandidate } from "../src/providers/metadata-resolver.js";

interface MockCall {
  url: string;
  init?: RequestInit;
}

function createMockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: MockCall[] = [];
  let callIndex = 0;

  const mockFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const response = responses[callIndex++];
    return new Response(JSON.stringify(response.body), { status: response.status });
  };

  return { mockFn, calls };
}

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

describe("resolveMetadata", () => {
  it("uses Audnexus when ASIN is known and returns full metadata", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await resolveMetadata({
      identity: { title: "Project Hail Mary", author: "Andy Weir" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("audnexus");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata?.title).toBe("Project Hail Mary");
    expect(result.metadata?.author).toBe("Andy Weir");
    expect(result.metadata?.asin).toBe("B08G9PRS1K");
    expect(result.metadata?.narrator).toBe("Ray Porter");
    expect(result.metadata?.coverUrl).toBe("https://m.media-amazon.com/cover.jpg");
    expect(result.metadata?.durationMinutes).toBe(970);
  });

  it("falls back to Open Library then enriches with Audnexus", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [
            {
              key: "/works/OL123W",
              title: "The Hobbit",
              author_name: ["J. R. R. Tolkien"],
              isbn: ["0544003411"],
              cover_i: 258027,
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [
            {
              key: "/works/OL123W",
              title: "The Hobbit",
              author_name: ["J. R. R. Tolkien"],
              isbn: ["0544003411"],
              cover_i: 258027,
            },
          ],
        },
      },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await resolveMetadata({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: null,
      hardcoverApiKey: "",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("open-library");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata?.title).toBe("Project Hail Mary");
    expect(result.metadata?.asin).toBe("B08G9PRS1K");
    expect(result.metadata?.narrator).toBe("Ray Porter");
    expect(result.metadata?.coverId).toBe(258027);

    expect(calls[0].url).toContain("openlibrary.org");
    expect(calls[1].url).toContain("openlibrary.org");
    expect(calls[2].url).toContain("audnex.us");
  });

  it("falls back to Hardcover then enriches with Audnexus", async () => {
    const { mockFn, calls } = createMockFetch([
      { status: 200, body: { numFound: 0, docs: [] } },
      {
        status: 200,
        body: { data: { search: { ids: [123] } } },
      },
      {
        status: 200,
        body: { data: { books: [{ editions: [{ asin: "B000002IX7" }], book_series: [] }] } },
      },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await resolveMetadata({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: null,
      hardcoverApiKey: "test-key",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("hardcover");
    expect(result.metadata?.asin).toBe("B08G9PRS1K");
    expect(result.metadata?.narrator).toBe("Ray Porter");

    const searchBody = JSON.parse(calls[1].init?.body as string);
    expect(searchBody.query).toContain("search(");
  });

  it("uses Open Library metadata when Audnexus enrichment fails", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [
            {
              key: "/works/OL123W",
              title: "The Hobbit",
              author_name: ["J. R. R. Tolkien"],
              isbn: ["0544003411"],
              cover_i: 258027,
            },
          ],
        },
      },
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [
            {
              key: "/works/OL123W",
              title: "The Hobbit",
              author_name: ["J. R. R. Tolkien"],
              isbn: ["0544003411"],
              cover_i: 258027,
            },
          ],
        },
      },
      { status: 404, body: { error: "Not found" } },
    ]);

    const result = await resolveMetadata({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: null,
      hardcoverApiKey: "",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("open-library");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata?.title).toBe("The Hobbit");
    expect(result.metadata?.asin).toBe("0544003411");
    expect(result.metadata?.coverId).toBe(258027);
    expect(result.metadata?.narrator).toBeUndefined();
  });

  it("returns null when all providers fail", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: { numFound: 0, docs: [] } },
    ]);

    const result = await resolveMetadata({
      identity: { title: "Unknown", author: "Nobody" },
      asin: null,
      hardcoverApiKey: "",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("none");
    expect(result.metadata).toBeNull();
  });

  it("populates series and seriesPart from Hardcover when available", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: { numFound: 0, docs: [] } },
      {
        status: 200,
        body: { data: { search: { ids: [123] } } },
      },
      {
        status: 200,
        body: {
          data: {
            books: [{
              editions: [{ asin: "B000002IX7" }],
              book_series: [{
                position: "1",
                series: { name: "Harry Potter" },
              }],
            }],
          },
        },
      },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await resolveMetadata({
      identity: { title: "Harry Potter", author: "Rowling" },
      asin: null,
      hardcoverApiKey: "test-key",
      fetchFn: mockFn,
    });

    expect(result.source).toBe("hardcover");
    expect(result.metadata?.title).toBe("Project Hail Mary");
    expect(result.metadata?.asin).toBe("B08G9PRS1K");
    expect(result.metadata?.series).toBe("Harry Potter");
    expect(result.metadata?.seriesPart).toBe("1");
  });

  it("does not search Hardcover when no API key", async () => {
    let hardcoverCalled = false;
    const { mockFn } = createMockFetch([
      { status: 200, body: { numFound: 0, docs: [] } },
    ]);

    const originalFetch = mockFn;
    const wrappedFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("hardcover")) {
        hardcoverCalled = true;
      }
      return originalFetch(url, init);
    };

    await resolveMetadata({
      identity: { title: "Unknown", author: "Nobody" },
      asin: null,
      hardcoverApiKey: "",
      fetchFn: wrappedFetch,
    });

    expect(hardcoverCalled).toBe(false);
  });
});

describe("fetchNextCandidate", () => {
  it("returns Audnexus candidate first when ASIN is known", async () => {
    const { mockFn, calls } = createMockFetch([
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await fetchNextCandidate({
      identity: { title: "Project Hail Mary", author: "Andy Weir" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "",
      skipProviders: [],
      fetchFn: mockFn,
    });

    expect(result.source).toBe("audnexus");
    expect(result.metadata?.title).toBe("Project Hail Mary");
    expect(calls[0].url).toContain("audnex.us");
  });

  it("falls through to Open Library when Audnexus fails on known ASIN", async () => {
    const { mockFn, calls } = createMockFetch([
      { status: 404, body: { error: "Not found" } },
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [{ key: "/works/OL1W", title: "The Hobbit", author_name: ["Tolkien"], isbn: ["0544003411"], cover_i: 258027 }],
        },
      },
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [{ key: "/works/OL1W", title: "The Hobbit", author_name: ["J.R.R. Tolkien"], isbn: ["0544003411"], cover_i: 258027 }],
        },
      },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await fetchNextCandidate({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "",
      skipProviders: [],
      fetchFn: mockFn,
    });

    expect(result.source).toBe("open-library");
    expect(result.metadata).not.toBeNull();
    expect(calls[0].url).toContain("audnex.us");
    expect(calls[1].url).toContain("openlibrary.org");
  });

  it("skips Audnexus when in skipProviders and tries Open Library", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [{ key: "/works/OL1W", title: "The Hobbit", author_name: ["Tolkien"], isbn: ["0544003411"], cover_i: 258027 }],
        },
      },
      {
        status: 200,
        body: {
          numFound: 1,
          docs: [{ key: "/works/OL1W", title: "The Hobbit", author_name: ["J.R.R. Tolkien"], isbn: ["0544003411"], cover_i: 258027 }],
        },
      },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await fetchNextCandidate({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "",
      skipProviders: ["audnexus"],
      fetchFn: mockFn,
    });

    expect(result.source).toBe("open-library");
    expect(calls[0].url).not.toContain("audnex.us");
    expect(calls[0].url).toContain("openlibrary.org");
  });

  it("skips Audnexus and Open Library, tries Hardcover", async () => {
    const { mockFn, calls } = createMockFetch([
      { status: 200, body: { data: { search: { ids: [123] } } } },
      { status: 200, body: { data: { books: [{ editions: [{ asin: "B000002IX7" }] }] } } },
      { status: 200, body: AUDNEXUS_RESPONSE },
    ]);

    const result = await fetchNextCandidate({
      identity: { title: "The Hobbit", author: "Tolkien" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "test-key",
      skipProviders: ["audnexus", "open-library"],
      fetchFn: mockFn,
    });

    expect(result.source).toBe("hardcover");
    expect(result.metadata?.asin).toBe("B08G9PRS1K");
    expect(calls[0].url).toContain("hardcover");
  });

  it("returns null when all providers are skipped", async () => {
    const result = await fetchNextCandidate({
      identity: { title: "Any", author: "Any" },
      asin: "B08G9PRS1K",
      hardcoverApiKey: "test-key",
      skipProviders: ["audnexus", "open-library", "hardcover"],
    });

    expect(result.metadata).toBeNull();
    expect(result.source).toBe("none");
  });

  it("returns null when all providers fail", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: { numFound: 0, docs: [] } },
    ]);

    const result = await fetchNextCandidate({
      identity: { title: "Unknown", author: "Nobody" },
      asin: null,
      hardcoverApiKey: "",
      skipProviders: [],
      fetchFn: mockFn,
    });

    expect(result.metadata).toBeNull();
    expect(result.source).toBe("none");
  });
});
