import { describe, it, expect } from "vitest";
import { searchOpenLibraryByIsbn } from "../src/providers/open-library.js";

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

describe("searchOpenLibraryByIsbn", () => {
  it("returns book metadata when ISBN search finds results", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        numFound: 1,
        start: 0,
        docs: [
          {
            key: "/works/OL27448W",
            title: "The Hobbit",
            author_name: ["J. R. R. Tolkien"],
            first_publish_year: 1954,
            cover_i: 258027,
            isbn: ["9780544003415", "0544003411"],
            publisher: ["Houghton Mifflin"],
            language: ["eng"],
            subject: ["Fantasy fiction", "Middle Earth"],
            edition_count: 120,
          },
        ],
      },
    });

    const result = await searchOpenLibraryByIsbn("9780544003415", mockFn);
    expect(result).toEqual({
      key: "/works/OL27448W",
      title: "The Hobbit",
      authorName: ["J. R. R. Tolkien"],
      firstPublishYear: 1954,
      coverId: 258027,
      isbn: ["9780544003415", "0544003411"],
      publisher: ["Houghton Mifflin"],
      language: ["eng"],
      subject: ["Fantasy fiction", "Middle Earth"],
      editionCount: 120,
    });

    expect(calls[0].url).toContain("/search.json");
    expect(calls[0].url).toContain("isbn=9780544003415");
    expect(calls[0].url).not.toContain("q=");
  });

  it("returns null when no docs found", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: { numFound: 0, start: 0, docs: [] },
    });

    const result = await searchOpenLibraryByIsbn("0000000000", mockFn);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const { mockFn } = createMockFetch({
      status: 500,
      body: { error: "Server Error" },
    });

    const result = await searchOpenLibraryByIsbn("9780544003415", mockFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };
    const result = await searchOpenLibraryByIsbn("9780544003415", mockFn);
    expect(result).toBeNull();
  });
});
