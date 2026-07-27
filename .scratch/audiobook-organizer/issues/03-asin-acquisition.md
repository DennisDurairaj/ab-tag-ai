# 03 — ASIN Acquisition

**What to build:** For each book that lacks an ASIN, search Open Library editions/isbn fields first, then Hardcover editions.asin, then check filename patterns, then Audible URLs. Validate ASINs are 10-character alphanumeric before use. Cache found ASINs in `.wayfinder/cache/asin.json` to avoid re-lookup on repeated runs. Flag books for manual review when no ASIN can be acquired from any source.

**Blocked by:** 02 — File Scanning & Metadata Detection

**Status:** ready-for-agent

- [ ] Search Open Library for ASIN via editions/isbn
- [ ] Search Hardcover for ASIN via editions.asin
- [ ] Validate ASIN format (10-char alphanumeric)
- [ ] File-based JSON cache at `.wayfinder/cache/asin.json`
- [ ] Flag books with no ASIN to review/ directory