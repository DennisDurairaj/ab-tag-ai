# 04 — Provider Metadata Resolution

**What to build:** Query Open Library for title+author metadata (returns ASINs, series info, covers), Audnexus for ASIN-based enrichment (narrator, duration), and Hardcover for fuzzy search + series metadata. Implement the fallback chain: Audnexus first (if ASIN known), then Open Library, then Hardcover. If all fail, flag the book for manual review.

**Blocked by:** 02 — File Scanning & Metadata Detection, 03 — ASIN Acquisition

**Status:** ready-for-agent

- [ ] Open Library search endpoint integration
- [ ] Audnexus ASIN lookup endpoint integration
- [ ] Hardcover GraphQL search integration
- [ ] Provider fallback chain (Audnexus → Open Library → Hardcover)
- [ ] Flag for manual review when all providers fail