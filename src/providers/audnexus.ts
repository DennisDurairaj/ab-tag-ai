import { validateAsin } from "./asin.js";

const AUDNEXUS_API_URL = "https://api.audnex.us/books/search";

export async function searchAudnexusAsin(
  title: string,
  author: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const url = `${AUDNEXUS_API_URL}?author=${encodeURIComponent(author)}&title=${encodeURIComponent(title)}`;
    const response = await fetchFn(url);

    if (!response.ok) return null;

    const data = (await response.json()) as Array<{ asin?: string }>;

    if (!data || data.length === 0) return null;

    for (const book of data) {
      if (book.asin && validateAsin(book.asin)) {
        return book.asin;
      }
    }

    return null;
  } catch {
    return null;
  }
}
