import { validateAsin } from "./asin.js";

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
    }
  }
`;

export async function searchHardcoverAsin(
  title: string,
  author: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const query = `${title} ${author}`;

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

    if (!searchResponse.ok) return null;

    const searchData = (await searchResponse.json()) as {
      data?: {
        search?: {
          ids?: number[];
        };
      };
    };

    const ids = searchData.data?.search?.ids;
    if (!ids || ids.length === 0) return null;

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

    if (!editionsResponse.ok) return null;

    const editionsData = (await editionsResponse.json()) as {
      data?: {
        books?: Array<{
          editions?: Array<{ asin?: string | null }>;
        }>;
      };
    };

    const books = editionsData.data?.books;
    if (!books) return null;

    for (const book of books) {
      const editions = book.editions;
      if (!editions) continue;
      for (const edition of editions) {
        if (edition.asin && validateAsin(edition.asin)) {
          return edition.asin;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
