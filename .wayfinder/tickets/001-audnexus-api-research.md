## Question

What data and endpoints does Audnexus offer for searching and retrieving audiobook metadata? Investigate:
- Search by title + author (or just title)
- What metadata fields are returned (author, narrator, series, series-position, publisher, year, description, genres, cover, duration, ASIN, language, etc.)
- Rate limits and authentication requirements
- Response format
- Can it be queried by ASIN directly?
- Region/locale support (US, UK, AU, etc.)

## Research Findings

Context pointer: [Audnexus API Research](research/audnexus-api.md)

### Key Findings

- **NO book search by title exists** — only author-by-name search (`GET /authors?name=`). Book lookups require ASIN (`GET /books/{ASIN}`)
- Metadata available per book: title, authors, narrators, publisher, year, description (short), genres (with type), cover image URL, duration (`runtimeLengthMin`), ASIN, language, ISBN, rating
- **Series data is NOT in the public API** — series name/position are missing
- **No authentication required** — fully public and free, 100 req/min per IP
- 10 regions supported: us, uk, au, ca, de, es, fr, in, it, jp
- 3.2M+ books indexed, 99.9% uptime, v1.14.0 (May 2026)
- Chapters endpoint available for chapter-level data
- Self-hostable option if rate limits are an issue

### Implications for Design
- Agent cannot use Audnexus as the primary way to find a book — it needs another source (Open Library / Hardcover) to get ASIN values first, then Audnexus can provide rich audio-specific metadata (narrator, chapters, cover)
- Series metadata must come from Open Library or Hardcover, not Audnexus
- Audnexus is best used as a secondary enrichment source after ASIN is known
