# 20 — Open Library editions endpoint for ASIN acquisition

**What to build:** ASIN acquisition queries Open Library's editions/isbn endpoint per SPEC line 40 and issue 03, rather than only scanning the `isbn` array of `/search.json` docs. This is a provider-correctness fix: the current `searchOpenLibraryAsin` reads `doc.isbn` from search results, which misses ASINs that live on the editions endpoint. After this ticket, ASIN acquisition via Open Library uses the editions endpoint as the primary path, with the existing `isbn`-array scan as a fallback.

**Blocked by:** 09 — Prefactor (clean `BookIdentity` usage in provider signatures)

**Status:** ready-for-agent

- [ ] Open Library editions/isbn endpoint queried for ASINs (primary path)
- [ ] Existing `isbn`-array scan retained as a fallback
- [ ] ASINs validated as 10-char alphanumeric before use (existing `validateAsin`)
- [ ] Tests cover editions-endpoint hit, editions-endpoint miss → isbn-array fallback, validation
