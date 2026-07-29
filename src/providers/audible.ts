import type { BookIdentity } from "../types.js";

function audibleCatalogUrl(region: string): string {
  return `https://api.audible.${region}/1.0/catalog/products`;
}

export interface AudibleProduct {
  asin: string;
  title: string;
  authors?: Array<{ name: string }>;
  narrators?: Array<{ name: string }>;
  series?: Array<{ asin?: string; title: string; sequence: string }>;
  publisher_name?: string;
  description?: string;
  genres?: Array<{ name: string }>;
  language?: string;
  product_images?: { "500"?: string };
  runtime_length_min?: number;
  isbn?: string;
}

export interface AudibleCatalogResponse {
  products: AudibleProduct[];
}

export interface AudibleSearchResult {
  asin: string;
  title: string;
  authors: Array<{ name: string }>;
  narrators: Array<{ name: string }>;
  series: Array<{ name: string; sequence: string }>;
  description: string;
  genres: string[];
  publisher: string;
  language: string;
  coverUrl: string;
  durationMinutes: number;
  isbn: string;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function titleMatches(targetTitle: string, productTitle: string): boolean {
  const clear = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = clear(targetTitle);
  const product = clear(productTitle);
  if (product.startsWith(target)) return true;
  const plain = clear(productTitle.replace(/\s*[\[(][^\])]*[\])]\s*$/, ""));
  return plain.includes(target);
}

export async function searchAudibleCatalog(
  identity: BookIdentity,
  options: { fetchFn?: typeof fetch; region?: string } = {},
): Promise<AudibleSearchResult | null> {
  const { fetchFn = fetch, region = "com" } = options;

  try {
    const params = new URLSearchParams({
      title: identity.title,
      author: identity.author,
      num_results: "10",
      products_sort_by: "Relevance",
      response_groups: "product_desc,contributors,series,media",
    });

    const url = `${audibleCatalogUrl(region)}?${params.toString()}`;
    const response = await fetchFn(url);

    if (!response.ok) return null;

    const data = (await response.json()) as AudibleCatalogResponse;
    if (!data.products || data.products.length === 0) return null;

    const matchingProducts = data.products.filter((p) => titleMatches(identity.title, p.title));
    if (matchingProducts.length === 0) return null;

    const product = matchingProducts[0];

    return {
      asin: product.asin,
      title: normalizeString(product.title),
      authors: product.authors?.map((a) => ({ name: normalizeString(a.name) })).filter((a) => a.name) ?? [],
      narrators: product.narrators?.map((n) => ({ name: normalizeString(n.name) })).filter((n) => n.name) ?? [],
      series: product.series?.map((s) => ({
        name: normalizeString(s.title),
        sequence: normalizeString(s.sequence),
      })) ?? [],
      description: normalizeString(product.description),
      genres: product.genres?.map((g) => normalizeString(g.name)).filter(Boolean) ?? [],
      publisher: normalizeString(product.publisher_name),
      language: normalizeString(product.language),
      coverUrl: normalizeString(product.product_images?.["500"]),
      durationMinutes: typeof product.runtime_length_min === "number" ? product.runtime_length_min : 0,
      isbn: normalizeString(product.isbn),
    };
  } catch {
    return null;
  }
}
