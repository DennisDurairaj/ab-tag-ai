import { describe, it, expect } from "vitest";
import { searchOpenLibraryAsin } from "../src/providers/open-library.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("searchOpenLibraryAsin", () => {
  it("returns ASIN when search results contain id_asin", async () => {
    const fetchFn = mockFetch(200, {
      docs: [{ id_asin: ["B000002IX7"] }],
    });
    const result = await searchOpenLibraryAsin("The Hobbit", "Tolkien", fetchFn);
    expect(result).toBe("B000002IX7");
  });

  it("returns first ASIN when multiple results exist", async () => {
    const fetchFn = mockFetch(200, {
      docs: [
        { id_asin: ["B000002IX7"] },
        { id_asin: ["B00B8LXTKW"] },
      ],
    });
    const result = await searchOpenLibraryAsin("The Hobbit", "Tolkien", fetchFn);
    expect(result).toBe("B000002IX7");
  });

  it("returns null when no docs match", async () => {
    const fetchFn = mockFetch(200, { docs: [] });
    const result = await searchOpenLibraryAsin("Unknown Book", "Nobody", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null when docs have no id_asin", async () => {
    const fetchFn = mockFetch(200, {
      docs: [{ isbn: ["1234567890"] }],
    });
    const result = await searchOpenLibraryAsin("Some Book", "Some Author", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const fetchFn = mockFetch(500, { error: "Server Error" });
    const result = await searchOpenLibraryAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchFn = async () => { throw new Error("Network failure"); };
    const result = await searchOpenLibraryAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });

  it("validates ASIN before returning", async () => {
    const fetchFn = mockFetch(200, {
      docs: [{ id_asin: ["invalid-asin-12"] }],
    });
    const result = await searchOpenLibraryAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });
});
