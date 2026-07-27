import { validateAsin } from "./asin.js";

export async function searchOpenLibraryAsin(
  title: string,
  author: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const query = encodeURIComponent(`${title} ${author}`);
    const url = `https://openlibrary.org/search.json?q=${query}`;
    const response = await fetchFn(url);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      docs?: Array<{ id_asin?: string[] }>;
    };

    if (!data.docs || data.docs.length === 0) return null;

    for (const doc of data.docs) {
      if (doc.id_asin && doc.id_asin.length > 0) {
        const asin = doc.id_asin[0];
        if (validateAsin(asin)) return asin;
      }
    }

    return null;
  } catch {
    return null;
  }
}
