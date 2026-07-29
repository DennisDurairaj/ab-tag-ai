import { describe, it, expect, vi } from "vitest";
import { searchLubimyczytac } from "../src/providers/lubimyczytac.js";
import fs from "node:fs";
import path from "node:path";

const FIXTURES = path.join(__dirname, "fixtures", "lubimyczytac");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf-8");
}

interface MockCall {
  url: string;
  init?: RequestInit;
}

function createMockFetch(responses: Array<{ status: number; body: string }>) {
  const calls: MockCall[] = [];
  let callIndex = 0;

  const mockFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const response = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return new Response(response.body, { status: response.status });
  };

  return { mockFn, calls };
}

describe("searchLubimyczytac", () => {
  it("returns structured result from search + detail pages", async () => {
    const searchHtml = readFixture("search.html");
    const detailHtml = readFixture("detail.html");

    const { mockFn, calls } = createMockFetch([
      { status: 200, body: searchHtml },
      { status: 200, body: detailHtml },
    ]);

    const result = await searchLubimyczytac(
      { title: "Jej chłopak", author: "Freida McFadden" },
      { fetchFn: mockFn },
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Dungeon Crawler Carl");
    expect(result!.authors).toEqual([{ name: "Matt Dinniman" }]);
    expect(result!.isbn).toBe("9788383821917");
    expect(result!.language).toBe("polski");
    expect(result!.publisher).toBe("Czarna Owca");
    expect(result!.series).toEqual([{ name: "Dungeon Crawler Carl", sequence: "1" }]);
    expect(result!.genres).toEqual(["fantasy", "science fiction"]);
    expect(result!.coverUrl).toContain("lubimyczytac.pl");
    expect(result!.description.length).toBeGreaterThan(0);
    expect(result!.lubimyczytacId).toBe("5167172");

    expect(calls.length).toBe(2);
    expect(calls[0].url).toContain("lubimyczytac.pl/szukaj/audiobooki");
    expect(calls[0].url).toContain("phrase=Jej+ch%C5%82opak");
    expect(calls[0].url).toContain("author=Freida+McFadden");
    expect(calls[1].url).toContain("lubimyczytac.pl/ksiazka/5167172/jej-chlopak");
  });

  it("returns null on search HTTP error", async () => {
    const { mockFn } = createMockFetch([
      { status: 500, body: "Error" },
    ]);

    const result = await searchLubimyczytac(
      { title: "Test", author: "Author" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null on search 429 with exhausted retries", async () => {
    vi.useFakeTimers();

    const responses = Array.from({ length: 4 }, () => ({
      status: 429,
      body: "Too Many Requests",
    }));

    const { mockFn } = createMockFetch(responses);

    const promise = searchLubimyczytac(
      { title: "Test", author: "Author" },
      { fetchFn: mockFn },
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("returns null when search page contains no results", async () => {
    const emptySearchHtml = "<!DOCTYPE html><html><head></head><body><div class='search-results'>No results found</div></body></html>";

    const { mockFn } = createMockFetch([
      { status: 200, body: emptySearchHtml },
    ]);

    const result = await searchLubimyczytac(
      { title: "Nonexistent", author: "Nobody" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null when detail page fetch fails", async () => {
    const searchHtml = readFixture("search.html");

    const { mockFn } = createMockFetch([
      { status: 200, body: searchHtml },
      { status: 404, body: "Not Found" },
    ]);

    const result = await searchLubimyczytac(
      { title: "Dungeon Crawler Carl", author: "Matt Dinniman" },
      { fetchFn: mockFn },
    );

    expect(result).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.useFakeTimers();

    const mockFn = async () => {
      throw new Error("Network failure");
    };

    const promise = searchLubimyczytac(
      { title: "Test", author: "Author" },
      { fetchFn: mockFn },
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("handles missing optional fields gracefully", async () => {
    const minimalDetailHtml = `<!DOCTYPE html><html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Book","name":"Minimalna Książka"}</script>
</head><body><h1 class="book__title">Minimalna Książka</h1></body></html>`;

    const minimalSearchHtml = `<!DOCTYPE html><html><body>
<div class="result-tile result-tile--book">
<div class="result-tile__wrapper">
<span class="result-tile__title"><a href="https://lubimyczytac.pl/ksiazka/999999/minimalna-ksiazka">Minimalna Książka</a></span>
<p class="result-tile__subtitle"><a href="#">Autor Testowy</a></p>
</div></div></body></html>`;

    const { mockFn } = createMockFetch([
      { status: 200, body: minimalSearchHtml },
      { status: 200, body: minimalDetailHtml },
    ]);

    const result = await searchLubimyczytac(
      { title: "Minimalna Książka", author: "" },
      { fetchFn: mockFn },
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Minimalna Książka");
    expect(result!.authors).toEqual([{ name: "Autor Testowy" }]);
    expect(result!.series).toEqual([]);
    expect(result!.publisher).toBe("");
    expect(result!.isbn).toBe("");
    expect(result!.lubimyczytacId).toBe("999999");
  });
});
