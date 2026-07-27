## Question

What data and endpoints does Open Library offer for searching and retrieving book metadata? Investigate:
- Search by title + author
- ISBN lookup
- What metadata fields are returned (title, author, publisher, year, description, subjects/genres, covers, ISBN, etc.)
- Authentication requirements
- Rate limits
- Response format
- How does it handle series information?
- Any audiobook-specific data?

## Research Findings

Context pointer: [Open Library API Research](research/openlibrary-api.md)

### Key Findings

- **No auth/API key needed** — fully open, public-good API
- **Rate limits:** 1 req/s default, 3 req/s identified (User-Agent header with contact email)
- **Primary endpoint:** `/search.json` with `q`, `title`, `author`, `isbn` params
- **Rich metadata returned:** title, author_name, subtitle, first_publish_year, cover_i (cover image ID), isbn, publisher, subject, series_name, series_position, series_key, language, ratings_average, id_librivox
- **Series info:** available via `series_name`, `series_position`, `series_key` arrays in search results; also via work-level endpoint (`/works/OLxxxW.json`)
- **Cover images:** CDN URL pattern `https://covers.openlibrary.org/b/id/{cover_i}-{S,M,L}.jpg` or `https://covers.openlibrary.org/b/isbn/{isbn}-{S,M,L}.jpg`
- **No native audiobook-specific data** — no narrator, duration, or audio format fields in search results
- **LibriVox API** available as companion for public-domain audiobook metadata (narrator, duration, chapters)
- **Known caveat:** requesting `editions` field in search silently drops works matched only via series

### Implications for Design
- Open Library is excellent as the PRIMARY search source to find books by title+author and get ASINs (via editions/isbn) and series info
- Use Open Library search → get ASINs → feed to Audnexus for audio metadata
- Series metadata comes from Open Library, not Audnexus
- Cover art can come from either Open Library covers API or Audnexus (Audnexus has higher quality Amazon CDN covers)
- For books not in Open Library, Hardcover provides fuzzy search fallback
