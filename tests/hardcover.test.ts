import { describe, it, expect } from "vitest";
import { searchHardcoverAsin } from "../src/providers/hardcover.js";
import type { BookIdentity } from "../src/types.js";

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

describe("searchHardcoverAsin", () => {
  it("returns ASIN from editions after search finds book IDs", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: {
          data: {
            search: {
              ids: [328491, 123456],
            },
          },
        },
      },
      {
        status: 200,
        body: {
          data: {
            books: [
              {
                editions: [{ asin: "B000002IX7" }],
                book_series: [],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "The Hobbit", author: "Tolkien" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBe("B000002IX7");
    expect(result.series).toBeUndefined();

    const searchBody = JSON.parse(calls[0].init?.body as string);
    expect(searchBody.query).toContain("search(");
    expect(searchBody.query).toContain("query:");
    expect(searchBody.query).toContain("query_type");
    expect(searchBody.query).not.toContain("edges");
    expect(searchBody.query).not.toContain("node");

    const editionsBody = JSON.parse(calls[1].init?.body as string);
    expect(editionsBody.query).toContain("books(");
    expect(editionsBody.query).toContain("editions");
    expect(editionsBody.query).toContain("asin");
    expect(editionsBody.variables.ids).toEqual([328491, 123456]);
  });

  it("returns first valid ASIN across multiple books and editions", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [1, 2] } } },
      },
      {
        status: 200,
        body: {
          data: {
            books: [
              {
                editions: [{ asin: "INVALID" }, { asin: "B00B8LXTKW" }],
                book_series: [],
              },
              {
                editions: [{ asin: "B000002IX7" }],
                book_series: [],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "The Hobbit", author: "Tolkien" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBe("B00B8LXTKW");
  });

  it("returns null when search finds no book IDs", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [] } } },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "Unknown", author: "Nobody" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBeNull();
    expect(result.series).toBeUndefined();
  });

  it("returns null when editions have no valid ASIN", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [123] } } },
      },
      {
        status: 200,
        body: {
          data: {
            books: [
              {
                editions: [{ asin: null }, { asin: "INVALID" }],
                book_series: [],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "Some Book", author: "Author" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBeNull();
  });

  it("returns null on search HTTP error", async () => {
    const { mockFn } = createMockFetch([
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await searchHardcoverAsin({ title: "Any", author: "Any" }, "test-key", mockFn);
    expect(result.asin).toBeNull();
  });

  it("returns null on editions HTTP error", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: { data: { search: { ids: [123] } } } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await searchHardcoverAsin({ title: "Any", author: "Any" }, "test-key", mockFn);
    expect(result.asin).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };
    const result = await searchHardcoverAsin({ title: "Any", author: "Any" }, "test-key", mockFn);
    expect(result.asin).toBeNull();
  });

  it("includes the API key as a Bearer token", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [] } } },
      },
    ]);

    await searchHardcoverAsin({ title: "Any", author: "Any" }, "secret-key-123", mockFn);
    const headers = calls[0].init?.headers as Record<string, string>;
    const authHeader =
      headers["authorization"] || headers["Authorization"];
    expect(authHeader).toBe("Bearer secret-key-123");
  });

  it("searches with combined title and author as query", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [] } } },
      },
    ]);

    await searchHardcoverAsin(
      { title: "The Hobbit", author: "J.R.R. Tolkien" },
      "test-key",
      mockFn,
    );
    const searchBody = JSON.parse(calls[0].init?.body as string);
    expect(searchBody.variables.query).toBe("The Hobbit J.R.R. Tolkien");
  });

  it("returns series name and position from book_series when available", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [328491] } } },
      },
      {
        status: 200,
        body: {
          data: {
            books: [
              {
                editions: [{ asin: "B000002IX7" }],
                book_series: [
                  {
                    position: "1",
                    series: { name: "Harry Potter" },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "Harry Potter", author: "Rowling" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBe("B000002IX7");
    expect(result.series).toBe("Harry Potter");
    expect(result.seriesSequence).toBe("1");
  });

  it("returns first book's series when multiple books match", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [1, 2] } } },
      },
      {
        status: 200,
        body: {
          data: {
            books: [
              {
                editions: [{ asin: null }],
                book_series: [],
              },
              {
                editions: [{ asin: "B000002IX7" }],
                book_series: [
                  {
                    position: "3",
                    series: { name: "The Dark Tower" },
                  },
                ],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      { title: "The Waste Lands", author: "King" },
      "test-key",
      mockFn,
    );
    expect(result.asin).toBe("B000002IX7");
    expect(result.series).toBe("The Dark Tower");
    expect(result.seriesSequence).toBe("3");
  });
});
