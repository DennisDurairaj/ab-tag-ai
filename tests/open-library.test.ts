import { describe, it, expect } from "vitest";
import { searchOpenLibraryByIsbn, searchOpenLibraryAsin } from "../src/providers/open-library.js";

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

describe("searchOpenLibraryAsin", () => {
  it("returns ISBN-10 when title+author search finds results", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        numFound: 1,
        docs: [
          {
            key: "/works/OL27448W",
            title: "The Hobbit",
            author_name: ["J. R. R. Tolkien"],
            isbn: ["0544003411", "9780544003415"],
            cover_i: 258027,
          },
        ],
      },
    });

    const result = await searchOpenLibraryAsin({ title: "The Hobbit", author: "Tolkien" }, mockFn);
    expect(result).toBe("0544003411");

    expect(calls[0].url).toContain("/search.json");
    expect(calls[0].url).toContain("q=The");
    expect(calls[0].url).toContain("Hobbit");
    expect(calls[0].url).toContain("Tolkien");
  });

  it("returns null when no docs found", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: { numFound: 0, docs: [] },
    });

    const result = await searchOpenLibraryAsin({ title: "Unknown Book", author: "Nobody" }, mockFn);
    expect(result).toBeNull();
  });

  it("returns null when docs have no ISBN", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        numFound: 1,
        docs: [
          {
            key: "/works/OL123W",
            title: "Some Book",
            author_name: ["Author"],
          },
        ],
      },
    });

    const result = await searchOpenLibraryAsin({ title: "Some Book", author: "Author" }, mockFn);
    expect(result).toBeNull();
  });

  it("skips ISBN-13 and returns first valid ISBN-10", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        numFound: 1,
        docs: [
          {
            key: "/works/OL123W",
            title: "Some Book",
            author_name: ["Author"],
            isbn: ["9780544003415", "0544003411"],
          },
        ],
      },
    });

    const result = await searchOpenLibraryAsin({ title: "Some Book", author: "Author" }, mockFn);
    expect(result).toBe("0544003411");
  });

  it("returns null on HTTP error", async () => {
    const { mockFn } = createMockFetch({
      status: 500,
      body: { error: "Server Error" },
    });

    const result = await searchOpenLibraryAsin({ title: "Any", author: "Any" }, mockFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };
    const result = await searchOpenLibraryAsin({ title: "Any", author: "Any" }, mockFn);
    expect(result).toBeNull();
  });

  it("searches multiple docs for a valid ISBN-10", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        numFound: 2,
        docs: [
          {
            key: "/works/OL1W",
            title: "Book One",
            author_name: ["Author A"],
            isbn: ["9780000000001"],
          },
          {
            key: "/works/OL2W",
            title: "Book Two",
            author_name: ["Author B"],
            isbn: ["B000002IX7"],
          },
        ],
      },
    });

    const result = await searchOpenLibraryAsin({ title: "Book", author: "Author" }, mockFn);
    expect(result).toBe("B000002IX7");
  });
});
