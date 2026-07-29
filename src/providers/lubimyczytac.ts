import type { BookIdentity } from "../types.js";
import * as cheerio from "cheerio";

const BASE_URL = "https://lubimyczytac.pl";
const SEARCH_URL = `${BASE_URL}/szukaj/audiobooki`;

export interface LubimyczytacSearchResult {
  title: string;
  authors: Array<{ name: string }>;
  series: Array<{ name: string; sequence: string }>;
  description: string;
  genres: string[];
  publisher: string;
  language: string;
  coverUrl: string;
  isbn: string;
  lubimyczytacId: string;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractBookIdFromUrl(url: string): string | null {
  const match = url.match(/\/ksiazka\/(\d+)/);
  return match ? match[1] : null;
}

function extractSeries(text: string): { name: string; sequence: string } | null {
  const match = text.match(/^(.+?)\s*\(tom\s+(\d+)/i);
  if (match) {
    return { name: match[1].trim(), sequence: match[2] };
  }
  return null;
}

interface SearchHit {
  title: string;
  author: string;
  url: string;
  bookId: string | null;
}

function parseSearchResults(html: string): SearchHit[] {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];

  $(".result-tile--book").each((_i, el) => {
    const $el = $(el);
    const titleEl = $el.find(".result-tile__title a");
    const title = titleEl.text().trim();
    const url = titleEl.attr("href") || "";
    const author = $el.find(".result-tile__subtitle a").text().trim();
    const bookId = extractBookIdFromUrl(url);

    if (title && url) {
      hits.push({
        title,
        author,
        url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
        bookId,
      });
    }
  });

  return hits;
}

interface DetailData {
  title: string;
  author: string;
  series: { name: string; sequence: string } | null;
  description: string;
  genres: string[];
  publisher: string;
  language: string;
  coverUrl: string;
  isbn: string;
}

function parseDetailPage(html: string): DetailData | null {
  const $ = cheerio.load(html);

  let title = "";
  let author = "";
  let series: { name: string; sequence: string } | null = null;
  let description = "";
  let genres: string[] = [];
  let publisher = "";
  let language = "";
  let coverUrl = "";
  let isbn = "";

  const jsonScripts = $('script[type="application/ld+json"]');
  jsonScripts.each((_i, el) => {
    const text = $(el).html();
    if (!text || !text.includes('"Book"')) return;

    const jsonStart = text.indexOf("{");
    if (jsonStart < 0) return;

    let jsonStr = text.slice(jsonStart);
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceEnd > 0) {
      jsonStr = jsonStr.slice(0, braceEnd + 1);
    }

    try {
      const data = JSON.parse(jsonStr);
      title = normalizeString(data.name);
      author = normalizeString(data.author?.name);
      isbn = normalizeString(data.isbn);
      language = normalizeString(data.inLanguage);
      coverUrl = normalizeString(data.image);

      if (data.isPartOfSeries) {
        series = {
          name: normalizeString(data.isPartOfSeries.name),
          sequence: normalizeString(String(data.isPartOfSeries.position)),
        };
      }
    } catch {
      // Swallow JSON parse errors from malformed script blocks
    }
  });

  if (!title) {
    title = $(".book__title").first().text().trim();
  }

  if (!description) {
    const descEl = $("#book-description");
    if (descEl.length) {
      description = descEl.text().trim().replace(/\s+/g, " ");
    }
    if (!description) {
      description = $('meta[property="og:description"]').attr("content") || "";
    }
  }

  if (!publisher) {
    const pubDd = $('dt:contains("Wydawnictwo:")').next("dd");
    if (pubDd.length) {
      publisher = pubDd.first().text().trim();
    }
    if (!publisher) {
      publisher = $('.book__txt:contains("Wydawnictwo:")').find("a").first().text().trim();
    }
  }

  if (genres.length === 0) {
    const genreText = $(".book__category.d-sm-block.d-none").first().text().trim();
    if (genreText) {
      genres = genreText.split(",").map((g) => g.trim()).filter(Boolean);
    }
  }

  if (!language) {
    const langDd = $('dt:contains("Język:")').next("dd");
    if (langDd.length) {
      language = langDd.first().text().trim();
    }
  }

  if (!series) {
    const seriesEl = $('.d-none.d-sm-block.mt-1:contains("Cykl") a');
    if (seriesEl.length) {
      const seriesText = seriesEl.first().text().trim();
      if (seriesText) {
        series = extractSeries(seriesText);
      }
    }
  }

  if (!coverUrl) {
    coverUrl = $('meta[property="og:image"]').attr("content") || "";
  }

  if (!isbn) {
    isbn = $('meta[property="books:isbn"]').attr("content") || "";
  }

  return {
    title,
    author,
    series,
    description,
    genres,
    publisher,
    language,
    coverUrl,
    isbn,
  };
}

async function retryFetch(fetchFn: typeof fetch, url: string, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchFn(url);
      if (response.status === 429 && attempt < maxRetries) {
        const delayMs = 5000 + Math.floor(Math.random() * 5000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return response;
    } catch {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function searchLubimyczytac(
  identity: BookIdentity,
  options: { fetchFn?: typeof fetch } = {},
): Promise<LubimyczytacSearchResult | null> {
  const { fetchFn = fetch } = options;

  try {
    const params = new URLSearchParams({ phrase: identity.title });
    if (identity.author) {
      params.set("author", identity.author);
    }
    const searchUrl = `${SEARCH_URL}?${params.toString()}`;

    const searchResponse = await retryFetch(fetchFn, searchUrl);
    if (!searchResponse || !searchResponse.ok) return null;

    const searchHtml = await searchResponse.text();
    const hits = parseSearchResults(searchHtml);
    if (hits.length === 0) return null;

    const best = hits[0];
    const detailResponse = await retryFetch(fetchFn, best.url);
    if (!detailResponse || !detailResponse.ok) return null;

    const detailHtml = await detailResponse.text();
    const detail = parseDetailPage(detailHtml);
    if (!detail || !detail.title) return null;

    const result: LubimyczytacSearchResult = {
      title: detail.title,
      authors: [{ name: detail.author || best.author }],
      series: detail.series
        ? [{ name: detail.series.name, sequence: detail.series.sequence }]
        : [],
      description: detail.description,
      genres: detail.genres,
      publisher: detail.publisher,
      language: detail.language,
      coverUrl: detail.coverUrl,
      isbn: detail.isbn,
      lubimyczytacId: best.bookId || "",
    };

    return result;
  } catch {
    return null;
  }
}
