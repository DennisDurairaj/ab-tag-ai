import { describe, it, expect } from "vitest";
import { searchHardcoverAsin } from "../src/providers/hardcover.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("searchHardcoverAsin", () => {
  it("returns ASIN when search results contain editions with asin", async () => {
    const fetchFn = mockFetch(200, {
      data: {
        search: {
          edges: [
            {
              node: {
                editions: [
                  { asin: "B000002IX7" },
                ],
              },
            },
          ],
        },
      },
    });
    const result = await searchHardcoverAsin("The Hobbit", "Tolkien", "test-key", fetchFn);
    expect(result).toBe("B000002IX7");
  });

  it("returns first valid ASIN across multiple editions", async () => {
    const fetchFn = mockFetch(200, {
      data: {
        search: {
          edges: [
            {
              node: {
                title: "The Hobbit",
                editions: [
                  { asin: "INVALID" },
                  { asin: "B00B8LXTKW" },
                ],
              },
            },
          ],
        },
      },
    });
    const result = await searchHardcoverAsin("The Hobbit", "Tolkien", "test-key", fetchFn);
    expect(result).toBe("B00B8LXTKW");
  });

  it("returns null when no search results", async () => {
    const fetchFn = mockFetch(200, {
      data: {
        search: {
          edges: [],
        },
      },
    });
    const result = await searchHardcoverAsin("Unknown", "Nobody", "test-key", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null when editions have no asin", async () => {
    const fetchFn = mockFetch(200, {
      data: {
        search: {
          edges: [
            {
              node: {
                editions: [{ isbn: "1234567890" }],
              },
            },
          ],
        },
      },
    });
    const result = await searchHardcoverAsin("Some Book", "Author", "test-key", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const fetchFn = mockFetch(500, { error: "Server Error" });
    const result = await searchHardcoverAsin("Any", "Any", "test-key", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchFn = async () => { throw new Error("Network failure"); };
    const result = await searchHardcoverAsin("Any", "Any", "test-key", fetchFn);
    expect(result).toBeNull();
  });

  it("includes the API key as a Bearer token", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchFn = async (url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ data: { search: { edges: [] } } }), { status: 200 });
    };
    await searchHardcoverAsin("Any", "Any", "secret-key-123", fetchFn);
    const headers = capturedHeaders as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    const authHeader = (headers as Record<string, string>)["authorization"] || (headers as Record<string, string>)["Authorization"];
    expect(authHeader).toBe("Bearer secret-key-123");
  });
});
