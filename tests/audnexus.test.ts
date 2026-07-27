import { describe, it, expect } from "vitest";
import { searchAudnexusAsin } from "../src/providers/audnexus.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("searchAudnexusAsin", () => {
  it("returns ASIN when search results contain asin", async () => {
    const fetchFn = mockFetch(200, [{ asin: "B000002IX7" }]);
    const result = await searchAudnexusAsin("The Hobbit", "Tolkien", fetchFn);
    expect(result).toBe("B000002IX7");
  });

  it("returns first ASIN when multiple results exist", async () => {
    const fetchFn = mockFetch(200, [
      { asin: "B000002IX7" },
      { asin: "B00B8LXTKW" },
    ]);
    const result = await searchAudnexusAsin("The Hobbit", "Tolkien", fetchFn);
    expect(result).toBe("B000002IX7");
  });

  it("returns null when no results", async () => {
    const fetchFn = mockFetch(200, []);
    const result = await searchAudnexusAsin("Unknown", "Nobody", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const fetchFn = mockFetch(500, { error: "Server Error" });
    const result = await searchAudnexusAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const fetchFn = async () => { throw new Error("Network failure"); };
    const result = await searchAudnexusAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });

  it("validates ASIN before returning", async () => {
    const fetchFn = mockFetch(200, [{ asin: "invalid" }]);
    const result = await searchAudnexusAsin("Any", "Any", fetchFn);
    expect(result).toBeNull();
  });
});
