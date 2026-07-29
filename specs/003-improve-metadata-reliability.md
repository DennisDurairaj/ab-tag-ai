# 003 — Improve Metadata Reliability

<!-- STATUS: proposed -->
<!-- ISSUE: https://github.com/DennisDurairaj/ab-tag-ai/issues/1 -->
<!-- SUPERSEDES: 001-abs-upload — PATCH payload strategy, match ordering, provider set -->

## Problem Statement

`ab-tag-ai` uploads tagged books to Audiobookshelf but leaves incomplete or incorrect metadata. The upload sets only the ASIN and series on the ABS item, then triggers ABS's provider match to fill the rest — but the match API returns 404 due to a race condition with the async scan, and the error is caught silently. Users find themselves manually re-matching books in the ABS web UI after upload, erasing the tool's automation benefit.

Additionally, the provider search relies on Open Library and Hardcover for ASIN discovery, then Audnexus for enrichment. Open Library is unreliable for series data, and Hardcover's fuzzy search requires a paid API key. The richest metadata source — Audible's catalog API — is never searched directly.

## Solution

Fix the ABS metadata flow and add Audible as a primary search provider. Five targeted changes to the existing pipeline:

1. **Add the Audible catalog search as a metadata provider** — query `api.audible.{tld}/1.0/catalog/products` with `response_groups=product_desc,contributors,series,media`. Returns title, authors, narrators, series+sequence, publisher, description, cover, and duration in a single call. No auth required.

2. **Expand the PATCH payload** on ABS items from `{ asin, series }` to the full resolved metadata: title, authors, asin, isbn, narrators, description, genres, publisher, language, and series (with `sequence` field for correct ordering in ABS).

3. **Set series sequence explicitly** — series name from the LLM path interpreter or provider search; sequence from Audible's `series.sequence`, Hardcover's `book_series.position`, or path numbering. ABS displays books in sequence order when the field is populated.

4. **Re-order the ABS upload flow** — PATCH all resolved metadata first, then call match with `overrideDetails: false` as a gap-fill safety net. PATCH-first ensures the item's `.media` row exists, eliminating the 404 race condition on the match call.

5. **Remove the buggy ASIN-only match flow** — the current step that calls match with only ASIN as the primary metadata source is replaced by the expanded PATCH + match-after-PATCH flow.

## User Stories

1. As a user, I want uploaded books to show correct title, author, narrator, and series in Audiobookshelf without manual re-matching, so that the tool actually saves me time.
2. As a user, I want books in a series to appear in correct sequence order in Audiobookshelf without me numbering them manually.
3. As a user, I want the tool to search Audible directly for metadata, so that it finds narrator names, descriptions, and durations that Open Library and Hardcover don't provide.
4. As a user, I want the ABS match to fill gaps in metadata (e.g., genres from Google Books) without overwriting the pipeline's resolved fields.
5. As a user, I want the upload to succeed reliably without silent 404 failures that leave books partially tagged.
6. As a user with the Hardcover API key configured, I want Hardcover to remain available as a fuzzy-search fallback when Audible's exact-match search returns no results.
7. As a user without the Hardcover API key, I want the tool to still function with Audible + Open Library only.
8. As a user processing 100-book batches, I want the pipeline to flag books it cannot confidently resolve rather than writing incorrect metadata to ABS.
9. As a user, I want the ASIN cache to short-circuit search for previously processed books, regardless of which provider originally resolved the ASIN.
10. As a user, I want the existing review queue (`output/review/`) to continue working for flagged books.

## Implementation Decisions

### Audible catalog provider

A new provider that searches Audible's public catalog API:

- Search endpoint: `https://api.audible.{tld}/1.0/catalog/products?title={title}&author={author}&num_results=10&products_sort_by=Relevance&response_groups=product_desc,contributors,series,media`
- Returns products with ASIN, title, authors, narrators, series (with sequence), publisher, description, cover images (up to 500px), duration, language, genres, rating, abridged status
- Default region: `us` (`.com`). Configurable to other regions via lookup.
- Search has zero fuzzy tolerance — misspellings return zero results. The existing fuzzy-match gate that compares provider results against the path interpreter's output handles this: if Audible returns nothing, OL and HC provide fallback results.
- Function signature follows the existing provider pattern: takes `BookIdentity` and optional `fetchFn`, returns a result object or null.
- Rate limits: undocumented but observed at ~1-2 requests/second. The existing sequential book processing with 500ms staggered starts should stay under this.
- Without `response_groups`, the catalog endpoint returns only the ASIN — the `response_groups` parameter is required for rich metadata.

### AbsMediaUpdatePayload expansion

The `AbsMediaUpdatePayload` type gains optional fields for all writable ABS metadata. The PATCH `/api/items/:id/media` endpoint accepts these fields per the ABS source:

| Field | Type | In PATCH |
|-------|------|----------|
| title | string | Yes |
| subtitle | string | Not currently resolved |
| authors | `[{name}]` | Yes |
| narrators | `string[]` | Yes |
| description | string | Yes |
| publisher | string | Yes |
| publishedYear | string | Not currently resolved |
| genres | `string[]` | Yes |
| language | string | Yes |
| asin | string | Yes |
| isbn | string | Yes |
| series | `[{name, sequence}]` | Yes |

The `ResolvedMetadata` type gains `description`, `genres`, `publisher`, `language`, and `isbn` fields. The Audible provider populates these directly. Audnexus enrichment already provides `description`, `genres`, `publisherName`, and `language` — these are now wired through to the PATCH payload.

### ABS upload flow reordering

Current flow:
```
upload → scan → poll → PATCH (asin+series) → match (primary) → cover
```

New flow:
```
upload → scan → poll → PATCH (full metadata) → match (safety net) → cover
```

The match call after PATCH uses `overrideDetails: false` so it only fills fields left empty. The match call also uses the ASIN already set on the item via PATCH, providing the strongest possible match signal to ABS's built-in providers.

The PATCH-first ordering fixes the race condition: after `PATCH /media` writes data, the item's `Book` row exists. The subsequent `POST /match` middleware check for `req.libraryItem?.media` passes reliably.

### Series sequence

The ABS PATCH payload uses `"series": [{"name": "Stormlight Archive", "sequence": "3"}]`. The `sequence` field must be a string (ABS normalizes it internally). Sequence is resolved from:

1. Audible provider: `series.sequence` from the catalog response
2. Hardcover: `book_series.position` from the editions query
3. Path numbering: when the book folder has a number prefix (e.g., `01 - Book Title`), the LLM path interpreter can extract it. This requires the path interpreter to return an optional `seriesSequence` field.

The `seriesPart` field on `ResolvedMetadata` is renamed to `seriesSequence` for clarity and consistency with the ABS API.

### Provider search ordering

Parallel search now includes three providers: Audible, Open Library, and Hardcover. Audible is attempted first in the result merge since it provides the richest metadata:

1. If Audible returns a result → use Audible's ASIN, authors, narrators, series, description, etc.
2. Hardcover enrichments (series position if Audible missed it, fuzzy fallback ASIN if Audible returned nothing)
3. Open Library ISBN cross-reference and cover ID

The existing Audnexus enrichment call becomes a fallback when the ASIN comes from cache or filename (not from the Audible search).

## Testing Decisions

### What makes a good test

Tests verify external behavior through injected seams, never internal implementation. The primary seam is `fetchFn` — all HTTP calls accept an optional mock fetch. Provider functions are mocked at the module level via `vitest.mock` when testing the search orchestrator.

### Existing test seams (reused, not modified)

- `fetchFn` injection on all provider functions and ABS client methods
- `vitest.mock` on provider modules in deterministic search tests
- In-memory `AsinCache` with `.get()` / `.set()` / `.clear()`
- Temp directories for local output tests

### What to test

- **Audible provider** (`tests/audible.test.ts`): Unit tests against mock catalog responses. Verify result extraction (ASIN, title, authors, narrators, series, description, cover URL). Verify empty-string normalisation. Verify null return on HTTP errors.
- **Expanded ABS updateMedia** (`tests/abs-client.test.ts`): Verify the PATCH payload includes all resolved fields when provided. Verify the request body format matches ABS expectations.
- **ABS upload flow ordering** (`tests/memory-upload.test.ts`): Verify `updateMedia` is called before `matchItem`. Verify `matchItem` is called with `overrideDetails: false`. Verify `matchItem` is called with ASIN from the resolved metadata.
- **Deterministic search with Audible** (`tests/deterministic-search.test.ts`): Extend existing tests to cover the three-provider merge (Audible + OL + HC). Verify Audible result is preferred when title/author fuzzy-match passes. Verify fallback to OL+HC when Audible returns null.

### Prior art

- `tests/audnexus.test.ts` — unit tests for a single-call provider with mock fetch
- `tests/deterministic-search.test.ts` — orchestration tests with mocked providers
- `tests/abs-client.test.ts` — ABS API client tests with mock fetch
- `tests/memory-upload.test.ts` — end-to-end ABS upload flow tests

## Out of Scope

- Google Books or iTunes as new search providers
- Automatic subtitle or publishedYear resolution
- Chapter metadata (chapter titles, timestamps)
- Custom ABS metadata provider (separate HTTP service wrapping multi-provider search for ABS UI matching)
- Pre-tagging files with ID3 tags as the primary metadata channel (ID3 tags remain a secondary integrity check; PATCH /media is the authoritative channel)
- Non-English Audible region configuration beyond the default `us` region
- Changes to the verifier LLM fallback logic (the verifier sees richer metadata from Audible but operates identically)

## Further Notes

The Audible catalog API is a public, undocumented endpoint used by ABS itself. It may change without notice. The `response_groups` parameter was discovered by reading ABS's `server/providers/Audible.js` — it's not documented in any public API reference. If Audible changes or rate-limits this endpoint, the provider search falls back to OL + HC + Audnexus as before.

The wayfinder map `.wayfinder/maps/reliable-tagging-pipeline.md` and its 7 tickets contain the full decision record for this spec.
