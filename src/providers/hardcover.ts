import { validateAsin } from "./asin.js";

const HARDCOVER_API_URL = "https://api.hardcover.app/v1/graphql";

const SEARCH_QUERY = `
query SearchBooks($query: String!) {
  search(q: $query) {
    edges {
      node {
        editions {
          asin
        }
      }
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
    const response = await fetchFn(HARDCOVER_API_URL, {
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

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: {
        search?: {
          edges?: Array<{
            node?: {
              editions?: Array<{ asin?: string | null }>;
            };
          }>;
        };
      };
    };

    if (!data.data?.search?.edges) return null;

    for (const edge of data.data.search.edges) {
      const editions = edge.node?.editions;
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
