import { describe, it, expect } from "vitest";
import { searchAudibleCatalog } from "../src/providers/audible.js";

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

describe("searchAudibleCatalog", () => {
  it("returns structured result when catalog search succeeds", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        products: [
          {
            asin: "B08G9PRS1K",
            title: "Project Hail Mary",
            authors: [{ name: "Andy Weir" }],
            narrators: [{ name: "Ray Porter" }],
            series: [
              { asin: "B00SERIES", title: "Hail Mary Series", sequence: "1" },
            ],
            publisher_name: "Audible Studios",
            description: "When the Sun is threatened...",
            genres: [{ name: "Science Fiction" }, { name: "Adventure" }],
            language: "english",
            product_images: { "500": "https://m.media-amazon.com/images/I/cover.jpg" },
            runtime_length_min: 970,
            isbn: "9781603935470",
          },
        ],
      },
    });

    const result = await searchAudibleCatalog(
      { title: "Project Hail Mary", author: "Andy Weir" },
      { fetchFn: mockFn },
    );

    expect(result).toEqual({
      asin: "B08G9PRS1K",
      title: "Project Hail Mary",
      authors: [{ name: "Andy Weir" }],
      narrators: [{ name: "Ray Porter" }],
      series: [{ name: "Hail Mary Series", sequence: "1" }],
      description: "When the Sun is threatened...",
      genres: ["Science Fiction", "Adventure"],
      publisher: "Audible Studios",
      language: "english",
      coverUrl: "https://m.media-amazon.com/images/I/cover.jpg",
      durationMinutes: 970,
      isbn: "9781603935470",
    });

    const url = calls[0].url;
    expect(url).toContain("api.audible.com/1.0/catalog/products");
    expect(url).toContain("title=Project+Hail+Mary");
    expect(url).toContain("author=Andy+Weir");
    expect(url).toContain("response_groups=product_desc%2Ccontributors%2Cseries%2Cmedia");
    expect(url).toContain("num_results=10");
    expect(url).toContain("products_sort_by=Relevance");
  });

  it("returns null on HTTP error", async () => {
    const { mockFn } = createMockFetch({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await searchAudibleCatalog(
      { title: "Test", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null on 404", async () => {
    const { mockFn } = createMockFetch({
      status: 404,
      body: { error: "Not found" },
    });

    const result = await searchAudibleCatalog(
      { title: "Nonexistent", author: "Nobody" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const mockFn = async () => {
      throw new Error("Network failure");
    };

    const result = await searchAudibleCatalog(
      { title: "Test", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null when products array is empty", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: { products: [] },
    });

    const result = await searchAudibleCatalog(
      { title: "Nonexistent", author: "Nobody" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("handles missing optional fields gracefully", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        products: [
          {
            asin: "B00MINIMAL",
            title: "Minimal Book",
          },
        ],
      },
    });

    const result = await searchAudibleCatalog(
      { title: "Minimal Book", author: "" },
      { fetchFn: mockFn },
    );

    expect(result).toEqual({
      asin: "B00MINIMAL",
      title: "Minimal Book",
      authors: [],
      narrators: [],
      series: [],
      description: "",
      genres: [],
      publisher: "",
      language: "",
      coverUrl: "",
      durationMinutes: 0,
      isbn: "",
    });
  });

  it("picks the first product whose title matches the search", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        products: [
          { asin: "B00FIRST", title: "Test Book: First Edition" },
          { asin: "B00SECOND", title: "Test Book: Second Edition" },
        ],
      },
    });

    const result = await searchAudibleCatalog(
      { title: "Test Book", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result?.asin).toBe("B00FIRST");
    expect(result?.title).toBe("Test Book: First Edition");
  });

  it("filters out products whose title does not match the search", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        products: [
          { asin: "B00WRONG", title: "Unrelated Book" },
          { asin: "B00RIGHT", title: "Test Book" },
        ],
      },
    });

    const result = await searchAudibleCatalog(
      { title: "Test Book", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result?.asin).toBe("B00RIGHT");
  });

  it("returns null when no products match the title filter", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        products: [
          { asin: "B00WRONG", title: "Unrelated Book" },
          { asin: "B00WRONG2", title: "Another Different Book" },
        ],
      },
    });

    const result = await searchAudibleCatalog(
      { title: "Test Book", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("uses audible.es URL when region is 'es'", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        products: [
          { asin: "B00ESBOOK", title: "Libro de Prueba" },
        ],
      },
    });

    await searchAudibleCatalog(
      { title: "Libro de Prueba", author: "Autor" },
      { fetchFn: mockFn, region: "es" },
    );

    const url = calls[0].url;
    expect(url).toContain("api.audible.es/1.0/catalog/products");
    expect(url).not.toContain("api.audible.com");
  });

  it("defaults to audible.com when no region is provided", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: {
        products: [
          { asin: "B00DEFAULT", title: "Test Book" },
        ],
      },
    });

    await searchAudibleCatalog(
      { title: "Test Book", author: "Author" },
      { fetchFn: mockFn },
    );

    const url = calls[0].url;
    expect(url).toContain("api.audible.com/1.0/catalog/products");
  });
});
