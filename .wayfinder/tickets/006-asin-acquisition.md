## Question

How should the agent acquire ASINs for books that don't have them? Since Audnexus requires ASIN but has no book search endpoint, the agent needs ASINs to do anything. Where should it get them, in what priority order, and how should it handle cases where no ASIN can be found?

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Source priority**: Open Library (editions/isbn) → Hardcover (editions.asin) → filename patterns → Audible URLs
- **No ASIN found**: flag for manual review in a `review/` directory
- **Format validation**: validate 10-character alphanumeric before passing to providers
- **Caching**: file-based JSON map, no re-acquisition on repeated runs
- **Existing ASINs**: always verify (check that the ASIN resolves to the correct book)
- **Storage after acquisition**: cache only (defer to full tagging pass)
- **Cache location**: `.wayfinder/cache/asin.json`