import { describe, it, expect } from "vitest";
import { searchHardcoverAsin } from "../src/providers/hardcover.js";

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
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      "The Hobbit",
      "Tolkien",
      "test-key",
      mockFn,
    );
    expect(result).toBe("B000002IX7");

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
              },
              {
                editions: [{ asin: "B000002IX7" }],
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      "The Hobbit",
      "Tolkien",
      "test-key",
      mockFn,
    );
    expect(result).toBe("B00B8LXTKW");
  });

  it("returns null when search finds no book IDs", async () => {
    const { mockFn } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [] } } },
      },
    ]);

    const result = await searchHardcoverAsin(
      "Unknown",
      "Nobody",
      "test-key",
      mockFn,
    );
    expect(result).toBeNull();
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
              },
            ],
          },
        },
      },
    ]);

    const result = await searchHardcoverAsin(
      "Some Book",
      "Author",
      "test-key",
      mockFn,
    );
    expect(result).toBeNull();
  });

  it("returns null on search HTTP error", async () => {
    const { mockFn } = createMockFetch([
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await searchHardcoverAsin("Any", "Any", "test-key", mockFn);
    expect(result).toBeNull();
  });

  it("returns null on editions HTTP error", async () => {
    const { mockFn } = createMockFetch([
      { status: 200, body: { data: { search: { ids: [123] } } } },
      { status: 500, body: { error: "Server Error" } },
    ]);

    const result = await searchHardcoverAsin("Any", "Any", "test-key", mockFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };
    const result = await searchHardcoverAsin("Any", "Any", "test-key", mockFn);
    expect(result).toBeNull();
  });

  it("includes the API key as a Bearer token", async () => {
    const { mockFn, calls } = createMockFetch([
      {
        status: 200,
        body: { data: { search: { ids: [] } } },
      },
    ]);

    await searchHardcoverAsin("Any", "Any", "secret-key-123", mockFn);
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
      "The Hobbit",
      "J.R.R. Tolkien",
      "test-key",
      mockFn,
    );
    const searchBody = JSON.parse(calls[0].init?.body as string);
    expect(searchBody.variables.query).toBe("The Hobbit J.R.R. Tolkien");
  });
});
