## Question

What data and endpoints does Hardcover's GraphQL API offer for searching and retrieving book metadata? Investigate:
- Authentication setup (API key from account settings)
- GraphQL queries for searching books by title and author
- What metadata fields are available (title, author, series, description, rating, cover, pages, audio_seconds, publisher, release date, ISBN, genres, etc.)
- Rate limits
- Any audiobook-specific fields?

## Research Findings

Context pointer: [Hardcover API Research](research/hardcover-api.md)

### Key Findings

- **Authentication:** Bearer token from hardcover.app/account/api, passed as `Authorization: Bearer <token>` header
- **Endpoint:** `POST https://api.hardcover.app/v1/graphql`
- **Rate limits:** 60 req/min; each top-level field counts; 30s timeout, max depth 3
- **Search:** Typesense-backed fuzzy search via `search(query, query_type: "Book")` — supports title+author fuzzy matching with typo tolerance
- **Filter-based queries:** `books(where: {title: {_eq: "..."}})` for exact match, `editions(where: {isbn_13: {_eq: ...}})` for ISBN lookup
- **Audiobook fields:** `audio_seconds` (duration), `has_audiobook`, `edition_format: "audiobook"`, `asin`, `reading_format_id: 2`
- **Series:** full series support via `book_series` join table with `position`, `series.name`
- **Cover images:** available via `image { url }` (book-level) and `cached_image`
- **Metadata:** title, subtitle, description, publisher, release_date, release_year, rating, ratings_count, genres (via taggings/moods), isbns, authors (via contributions), language, page count, series
- **Tokens expire after 1 year**, need renewal
- **API key required** — no anonymous access unlike Open Library

### Implications for Design
- Hardcover provides the best search experience (fuzzy matching) and the most complete book metadata including series
- Use Hardcover when Open Library yields no results or poor matches
- Hardcover API key required from user — a decision on whether to require user setup
- Rate limit of 60/min is generous for a personal tool processing 2000+ books over time

