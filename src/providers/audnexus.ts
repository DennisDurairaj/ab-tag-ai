const AUDNEXUS_API_URL = "https://api.audnex.us";

export interface AudnexusBook {
  asin: string;
  title: string;
  authors: Array<{ asin: string; name: string }>;
  narrators: Array<{ name: string }>;
  publisherName: string;
  releaseDate: string;
  runtimeLengthMin: number;
  description: string;
  summary: string;
  image: string;
  rating: string;
  genres: Array<{ asin: string; name: string; type: string }>;
  language: string;
  isbn: string;
  copyright: number;
  formatType: string;
  literatureType: string;
  isAdult: boolean;
}

export interface LookupAudnexusOptions {
  region?: string;
  fetchFn?: typeof fetch;
}

export async function lookupAudnexusBook(
  asin: string,
  options: LookupAudnexusOptions = {},
): Promise<AudnexusBook | null> {
  const { region = "us", fetchFn = fetch } = options;
  try {
    const url = `${AUDNEXUS_API_URL}/books/${encodeURIComponent(asin)}?region=${encodeURIComponent(region)}`;
    const response = await fetchFn(url);

    if (!response.ok) return null;

    const data = (await response.json()) as AudnexusBook;
    return data;
  } catch {
    return null;
  }
}
