# 004 — Language-Based Provider Routing

<!-- STATUS: implemented -->

## Problem Statement

`ab-tag-ai` assumes all books are English. Providers search `api.audible.com` and Open Library's English catalog. For non-English books — Polish, Spanish, Norwegian — these providers return sparse or zero metadata, leaving books unflagged without rich tags (narrator, description, publisher, cover, series sequence).

Additionally, the pipeline has no way to distinguish between a genuinely unmatched English book and a non-English book that needs different providers. Both cases fall through the same path and hit the same providers.

## Solution

Let the LLM path interpreter detect the book's language, and route to language-appropriate providers. Two targeted changes:

1. **The LLM path interpreter gains an optional `language` field** on `set_title_author`. Returns an ISO 639-1 code (`"en"`, `"pl"`, `"es"`, `"no"`). The existing `fuzzyMatch` gate continues to guard against hallucinated languages.

2. **`parallelSearchAndMerge` routes providers by language** via a hardcoded map. Each entry selects which provider(s) to search and with what region-specific config. Unknown or `"en"` languages use the current pipeline unchanged.

### Routing table

| Language | Providers | Region config |
|----------|-----------|---------------|
| `"en"` | Audible + OL + HC | audible.com (default) |
| `"es"` | Audible + OL + HC | audible.es |
| `"pl"` | OL + HC (today); Lubimyczytac (future #2) | — |
| `"no"` | OL + HC | — |
| unknown | Audible + OL + HC | audible.com (default) |

### Provider-specific region

`searchAudibleCatalog` gains an optional `region` option (e.g. `"es"`), replacing `"com"` in the URL: `https://api.audible.{region}/1.0/catalog/products`. Default: `"com"`.

### Scraper architecture (future)

The Lubimyczytac scraper in a later ticket will be a `src/providers/lubimyczytac.ts` provider following the same interface pattern: takes `BookIdentity`, returns structured metadata or `null`. Internally uses cheerio for HTML parsing. The routing table dispatches to it like any other provider.

## User Stories

1. As a user with a Spanish-language library, I want books to be matched against `audible.es` so that narrators, covers, and publisher metadata are correctly resolved.
2. As a user with a mix of Polish and English books, I want Polish books routed to language-appropriate providers without manual per-book configuration.
3. As a user, I want books whose language the LLM cannot detect to fall back to the current English pipeline (no regression).
4. As a user processing 100-book multilingual batches, I want the LLM detection to add no extra LLM calls — language folds into the existing `set_title_author` call.

## Implementation Decisions

### Language field

The `set_title_author` tool gains one optional property:

```
language: { type: "string", description: "ISO 639-1 language code (optional). Detect from the book title and path structure. Use 'en' for English, 'pl' for Polish, 'es' for Spanish, 'no' for Norwegian." }
```

The `PathInterpreterResult` type gains `language?: string`. Downstream, `BookIdentity` does NOT gain language — the `BookIdentity` type stays unchanged (it's the minimal search input). Language flows alongside it as a separate parameter.

### DeterministicSearchConfig

`DeterministicSearchConfig` gains `language?: string`, threaded from the path interpreter result through `deterministicSearch()` into `parallelSearchAndMerge()`.

### parallelSearchAndMerge changes

Accepts `language?: string`. Before the parallel provider calls, resolves a routing config:

```ts
const routing = resolveRouting(language); // returns { providers: [...], audibleRegion: "es" | "com" }
```

The `Promise.all` only includes providers in the routing set. `searchAudibleCatalog` receives the region.

### resolveRouting function

Hardcoded in `deterministic-search.ts`. Returns:

```ts
interface RoutingConfig {
  providers: ("audible" | "ol" | "hc")[];
  audibleRegion: string;
}
```

- `"es"` → `{ providers: ["audible", "ol", "hc"], audibleRegion: "es" }`
- Default → `{ providers: ["audible", "ol", "hc"], audibleRegion: "com" }`

Polish (`"pl"`) currently maps to default since the Lubimyczytac scraper isn't built yet. The routing table is designed to be extended.

### Title filter interaction

The `titleMatches` filter in `searchAudibleCatalog` correctly handles non-English titles:
- Spanish "La casa de los espíritus" queried against `api.audible.es` → matches, returns Spanish metadata
- Polish "Śmierć mówi w moim imieniu" queried against `api.audible.com` → returns 0 results (as today), falls through to OL+HC
- The filter's bracket-stripping logic prevents cross-language false matches (e.g., English subtitle in a Spanish edition title)

### Backward compatibility

- Books with `language: "en"` or no language field behave identically to today.
- The path interpreter's LLM prompt gains no new context — it infers language from the same path it already parses.
- No new config fields in `config.yaml`. The routing is entirely automatic.

## Testing Decisions

### What to test

- **Path interpreter**: language field present in `set_title_author` response flows through to `PathInterpreterResult`.
- **`resolveRouting`**: unit test each language code → correct provider set and region.
- **`parallelSearchAndMerge`**: when `language === "es"`, `searchAudibleCatalog` is called with `{ region: "es" }`. When `language === "en"`, called with default `"com"`.
- **`searchAudibleCatalog`**: with `{ region: "es" }`, URL contains `api.audible.es`. Default (`undefined`) → `api.audible.com`.
- **Backward compat**: existing `parallelSearchAndMerge` behavior unchanged when language is undefined.
- **Title filter + Spanish**: mock audible.es response with a Spanish book, verify titleMatches passes and metadata returned.

### Testing seams (reused)

- `fetchFn` injection on `searchAudibleCatalog` — region changes the URL, verified via mock call capture.
- `vi.mock` on provider modules in deterministic-search tests.
- LLM tool call mocking in path-interpreter tests.

## Out of Scope

- Lubimyczytac scraper provider (separate spec/ticket)
- Bokbasen provider for Norwegian (no public API, requires contract)
- Goodreads scraping (aggressive anti-bot; not worth the complexity)
- Provider config file — routing is hardcoded, not config-driven
- Language auto-detection outside the LLM (regex heuristics, etc.)
- Google Books as a supplementary provider
