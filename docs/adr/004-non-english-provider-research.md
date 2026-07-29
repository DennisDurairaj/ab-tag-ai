# ADR 004: Non-English Provider Coverage — Polish & Norwegian

> Date: 2026-07-29
> Status: research

## Open Library

- **Polish**: `post` search for "Śmierć mówi w moim imieniu" returned 2 results (both Polish). OL has Polish-language editions (e.g., Stanisław Lem, Andrzej Sapkowski works appear). Coverage: **moderate** — Polish editions exist for major authors but catalog depth is unpredictable.
- **Norwegian**: `post` search for "Lyntyven" (Norwegian translation of "The Lightning Thief") returned **0 results**. Searches for "norsk", "norwegian", Rick Riordan with `language=nor` all returned 0 results. Coverage: **very sparse** — OL's Norwegian-language catalog is thin; even high-profile translations are missing.

## Hardcover API

GraphQL API at `api.hardcover.app/v1/graphql` (already integrated in the project). **Paid**, requires `HARDCOVER_API_KEY`. No public developer docs page found (`/docs/api` and `/for-developers` return 404). Coverage for non-English editions is unknown without an active API key to query, but the `search()` and `editions{asin}` fields are language-agnostic in theory.

## Audible Regional TLDs

`api.audible.pl` and `api.audible.no` are **unreachable** (return `000` status, confirmed prior). No alternative regional API endpoints are known. Non-English audiobooks sometimes appear on `audible.com` with their own ASINs (e.g., foreign-language productions of US-published works), but native Polish/Norwegian productions rarely do.

## Audnexus

Currently **returning 404 on all endpoints** including root (`api.audnex.us/`). This appears to be a service outage. When operational, Audnexus only indexes the US Audible catalog by ASIN — non-English ASINs from audible.pl/no would not resolve even if the service were up. The project's `lookupAudnexusBook()` supports a `region` parameter (default `"us"`), but other regions currently fail.

## Regional Streaming Platforms (No Public APIs)

| Platform | Region | Catalog | API | Audiobook metadata |
|----------|--------|---------|-----|-------------------|
| **Storytel** | PL, NO | 500k+ (PL) / 900k+ (NO) titles | None public | Narrator, duration in-app but no API |
| **Legimi** | PL | Ebooks + audiobooks, subscription | None public | No API documented |
| **Empik Go** | PL | 240k+ titles, subscription | None public | No API documented |
| **Fabel** | NO | Streaming-only, exclusive content | None public | Narrator credited on site, no API |

All are subscription-based streaming services with no documented public API. None can serve as a metadata provider without reverse-engineering.

## National Library APIs

- **Poland (Biblioteka Narodowa)**: `data.bn.org.pl/api` returns **404**. No public REST API found.
- **Norway (Nasjonalbiblioteket)**: `api.nb.no` displays a Swagger UI at the root, but API paths (`/v1/catalog/search`) return **404** — likely requires authentication or IP whitelisting. Not a viable public metadata source.

## Implications

1. **Polish books**: Open Library has workable coverage. Hardcover may supplement for ASIN/series if the API key is active.
2. **Norwegian books**: No free provider has meaningful coverage. OL returns near-zero results for Norwegian-language titles. Hardcover is untested but the only plausible option.
3. **Audnexus is not the bottleneck**: even operational, it only indexes the US catalog. Non-English enrichment (narrator, duration) is fundamentally unsourced.
4. **All regional platforms are walled gardens** — no public APIs exist for Storytel, Legimi, Empik Go, or Fabel.
5. **Google Books** (noted in `docs/research/audiobook-tagging-ecosystem.md`) has an audiobook filter (`epub.isAvailable`) and supports language filtering via `langRestrict`. Worth investigating as a supplementary provider for non-English titles if OL/HC coverage proves insufficient.
