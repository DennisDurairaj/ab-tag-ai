import { validateAsin } from "./asin.js";
import type { BookIdentity } from "../types.js";

const HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql";

const SEARCH_QUERY = `
  query SearchBooks($query: String!) {
    search(query: $query, query_type: "Book", per_page: 5) {
      ids
    }
  }
`;

const EDITIONS_QUERY = `
  query GetEditions($ids: [Int!]!) {
    books(where: { id: { _in: $ids } }) {
      editions {
        asin
      }
      book_series {
        position
        series {
          name
        }
      }
    }
  }
`;

export interface HardcoverSearchResult {
  asin: string | null;
  series?: string;
  seriesSequence?: string;
}

function extractSeriesData(books: Array<{
  book_series?: Array<{ position?: string | number | null; series?: { name?: string | null } | null }> | null;
}> | undefined | null, index: number): { series?: string; seriesSequence?: string } {
  if (!books || index >= books.length) return {};

  const book = books[index];
  const seriesEntries = book?.book_series;
  if (seriesEntries && seriesEntries.length > 0) {
    const first = seriesEntries[0];
    if (first?.series?.name) {
      return {
        series: first.series.name,
        seriesSequence: first.position != null ? String(first.position) : undefined,
      };
    }
  }

  return {};
}

export async function searchHardcoverAsin(
  identity: BookIdentity,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<HardcoverSearchResult> {
  try {
    const query = `${identity.title} ${identity.author}`;

    const searchResponse = await fetchFn(HARDCOVER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { query },
      }),
    });

    if (!searchResponse.ok) return { asin: null };

    const searchData = (await searchResponse.json()) as {
      data?: {
        search?: {
          ids?: number[];
        };
      };
    };

    const ids = searchData.data?.search?.ids;
    if (!ids || ids.length === 0) return { asin: null };

    const editionsResponse = await fetchFn(HARDCOVER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: EDITIONS_QUERY,
        variables: { ids },
      }),
    });

    if (!editionsResponse.ok) return { asin: null };

    const editionsData = (await editionsResponse.json()) as {
      data?: {
        books?: Array<{
          editions?: Array<{ asin?: string | null }>;
          book_series?: Array<{
            position?: string | number | null;
            series?: { name?: string | null } | null;
          }> | null;
        }>;
      };
    };

    const books = editionsData.data?.books;
    if (!books) return { asin: null };

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const editions = book.editions;
      if (!editions) continue;
      for (const edition of editions) {
        if (edition.asin && validateAsin(edition.asin)) {
          const seriesData = extractSeriesData(books, i);
          return { asin: edition.asin, ...seriesData };
        }
      }
    }

    return { asin: null };
  } catch {
    return { asin: null };
  }
}
