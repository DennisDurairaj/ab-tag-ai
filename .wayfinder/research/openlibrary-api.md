# Open Library API — Research Summary

> **Source:** openlibrary.org/developers/api, openlibrary.org/dev/docs/api/search, GitHub (internetarchive/openlibrary)
> **Date:** 2026-07-26
> **Context:** Audiobook metadata tool

---

## 1. Authentication / API Keys

**No API key required.** Open Library is a public-good, open API. No registration or authentication is needed for any endpoint.

---

## 2. Rate Limits

| Tier | Limit | How to qualify |
|------|-------|----------------|
| Default (unidentified) | **1 request/second** | No special headers |
| Identified | **3 requests/second** | Add `User-Agent` header with app name + contact email |

**Guidance from maintainers:**
- Cache responses aggressively
- Use the Search API (`/search.json`) to batch-fetch many works at once instead of hitting individual work/edition endpoints
- For bulk processing, use [data dumps](https://openlibrary.org/developers/dumps) instead of live API
- If you notice 429/blocking, add a User-Agent header and contact the team

---

## 3. Endpoints

### 3.1 Search API (`/search.json`) — **Primary endpoint**

```
GET https://openlibrary.org/search.json
```

**Parameters:**

| Param | Description |
|-------|-------------|
| `q` | Free-text search query (Solr syntax) |
| `title` | Title search |
| `author` | Author search |
| `isbn` | ISBN search (10 or 13) |
| `subject` | Subject search |
| `publisher` | Publisher search |
| `place` / `person` / `time` | Faceted search |
| `fields` | Comma-separated field list (default: limited set; use `*` for all) |
| `limit` | Results per page (default 100, max?) |
| `offset` | Pagination offset |
| `page` | Alternative pagination (1-based) |
| `sort` | Sort: `relevance` (default), `new`, `old`, `rating`, `editions`, `random` |
| `lang` | Language filter for edition selection |
| `mode` | `everything` (default) or `all` |

**Examples:**

```
# Search by title + author
GET https://openlibrary.org/search.json?title=The+Hobbit&author=Tolkien

# Search by ISBN
GET https://openlibrary.org/search.json?isbn=9780547928227

# Search with specific fields
GET https://openlibrary.org/search.json?q=sherlock+holmes&fields=key,title,author_name,cover_i,isbn,first_publish_year

# Search with edition data
GET https://openlibrary.org/search.json?q=dune&fields=key,title,author_name,editions,editions.key,editions.title,editions.cover_i,editions.isbn

# Batch fetch with OR
GET https://openlibrary.org/search.json?q=key:(/works/OL82563W OR /works/OL82537W)&fields=key,title,author_name,editions,editions.key,editions.cover_i
```

### 3.2 ISBN Lookup (Legacy Books API)

```
GET https://openlibrary.org/api/books?bibkeys=ISBN:9780547928227&format=json
```

- Supports one or more comma-separated bibkeys: ISBN, OCLC, LCCN, OLID
- Add `&details=true` for richer metadata
- **Deprecated** — recommendation is to use `/search.json?isbn=` instead

### 3.3 Read API (Volumes)

```
GET https://openlibrary.org/api/volumes/brief/isbn/9780547928227.json
```

- Returns availability + cover + edition info for readable/borrowable books
- Supports `isbn`, `lccn`, `oclc`, `olid`
- Returns match quality (`exact` / `similar`), availability status (`full access`, `lendable`, etc.), and cover URLs

### 3.4 Work / Edition JSON Endpoints

```
GET https://openlibrary.org/works/OL27448W.json      # Work-level data
GET https://openlibrary.org/books/OL37239326M.json    # Edition-level data
GET https://openlibrary.org/authors/OL26320A.json     # Author data
```

- Append `.json`, `.rdf`, or `.yml` to any Open Library page URL
- Work record includes: title, authors, subjects, description, series info, covers, first_publish_date, links
- Edition record includes: publishers, publish_date, physical_format, isbn_10, isbn_13, languages, number_of_pages, covers, works (parent work link)

### 3.5 Covers API

```
GET https://covers.openlibrary.org/b/<key>/<value>-<size>.jpg
```

| Key types | `isbn`, `oclc`, `lccn`, `olid`, `id` |
|-----------|--------------------------------------|
| Sizes | `S` (small), `M` (medium), `L` (large) |
| Default | Returns blank image if not found |
| 404 mode | Append `?default=false` to get 404 instead of blank |

**Examples:**

```
https://covers.openlibrary.org/b/isbn/9780547928227-L.jpg
https://covers.openlibrary.org/b/olid/OL7440033M-S.jpg
https://covers.openlibrary.org/b/id/258027-M.jpg
```

**Important:** OLID for covers only works with **edition IDs** (e.g., `OL7440033M`), not work IDs (e.g., `OL27448W`). Use `cover_edition_key` from search results to find the best edition's cover.

For **author photos**:
```
GET https://covers.openlibrary.org/a/olid/OL23919A-S.jpg
```

### 3.6 Authors API

```
GET https://openlibrary.org/search/authors.json?q=Rowling
```

Returns: `key`, `name`, `alternate_names`, `birth_date`, `death_date`, `top_work`, `work_count`, `top_subjects`

### 3.7 Subjects API

```
GET https://openlibrary.org/subjects/<subject>.json
```

---

## 4. Response Format & Available Fields

All endpoints return JSON. The Search API response shape:

```json
{
  "numFound": 2421,
  "start": 0,
  "numFoundExact": true,
  "docs": [
    {
      "key": "/works/OL27448W",
      "title": "The Lord of the Rings",
      "author_name": ["J. R. R. Tolkien"],
      "author_key": ["OL26320A"],
      "first_publish_year": 1954,
      "cover_i": 258027,
      "cover_edition_key": "OL123456M",
      "isbn": ["9780544003415", "0544003411"],
      "publisher": ["Houghton Mifflin"],
      "language": ["eng"],
      "subject": ["Fantasy fiction", "Middle Earth"],
      "edition_count": 120,
      "has_fulltext": true,
      "ia": ["returnofking00tolk_1"],
      "public_scan_b": true,
      "subtitle": "...",
      "number_of_pages_median": 1178,
      "lcc": ["PR6039.O32"],
      "ddc": ["823.912"],
      "ratings_average": 4.5,
      "ratings_count": 45231,
      "want_to_read_count": 12893,
      "id_project_gutenberg": [],
      "id_librivox": [],
      "id_standard_ebooks": [],
      "id_openstax": []
    }
  ]
}
```

### Complete list of searchable/returnable fields (from Solr schema + source code):

**Core metadata:**
`key`, `title`, `subtitle`, `alternative_title`, `alternative_subtitle`, `author_name`, `author_key`, `author_alternative_name`, `first_publish_year`, `publish_year`, `publish_date`, `edition_count`, `edition_key`

**Identifiers:**
`isbn`, `lccn`, `oclc`, `ia` (Internet Archive ID), `cover_edition_key`

**Publisher/edition info:**
`publisher`, `by_statement`, `first_sentence`, `publish_place`, `contributor`, `language`

**Classification:**
`lcc`, `ddc`, `lcc_sort`, `ddc_sort`

**Availability:**
`has_fulltext`, `public_scan_b`, `ebook_access`, `lending_edition_s`, `lending_identifier_s`

**Categorization:**
`subject`, `person`, `place`, `time`, `subject_key`, `person_key`, `place_key`, `time_key`

**Ratings/engagement:**
`ratings_average`, `ratings_count`, `want_to_read_count`

**External IDs:**
`id_project_gutenberg`, `id_librivox`, `id_standard_ebooks`, `id_openstax`, `id_cita_press`, `id_wikisource`

**Series:**
`series_name`, `series_position`, `series_key`

**Edition sub-object** (when `editions` is in fields):
`editions.numFound`, `editions.start`, `editions.docs[].key`, `editions.docs[].title`, `editions.docs[].subtitle`, `editions.docs[].language`, `editions.docs[].cover_i`, `editions.docs[].isbn`, `editions.docs[].publisher`, `editions.docs[].publish_date`, `editions.docs[].ebook_access`, `editions.docs[].ia`

**Availability sub-object** (when `availability` is in fields):
`availability.status`, `availability.available_to_waitlist`, `availability.is_printdisabled`, `availability.identifier`, `availability.isbn`, `availability.openlibrary_work`, `availability.openlibrary_edition`, `availability.num_waitlist`

---

## 5. Series Information

Open Library has first-class series support:

### In the Search API
Series data appears as parallel arrays in search results:

```
series_name: ["Harry Potter"]
series_position: ["1"]
series_key: ["/series/OL326110L"]
```

### Via the Work/Edition JSON
Work records have a `series` field (array of series names). The API `get_doc()` function in the source code constructs series objects as:

```json
"series": [
  {
    "series": { "key": "/series/OL326110L", "name": "Harry Potter" },
    "position": "1"
  }
]
```

### Series page
Each series has its own page: `https://openlibrary.org/series/OL326110L/Harry_Potter`

### Known caveat
Requesting the `editions` field in Search API silently filters out works that match **only** via series-level fields (because the edition subquery requires at least one matching edition). This is a known bug. If you need series-matched results, either:
- Don't request the `editions` field
- Request editions but be aware some results will be dropped
- Use `/works/OL27448W.json` for individual work lookups (includes series info)

---

## 6. Audiobook-Specific Data

### Open Library does NOT have a dedicated audiobook type or audiobook-specific fields.

What it does have:

| Aspect | Details |
|--------|---------|
| **Format field** | Editions have `physical_format` (e.g., "digital audio", "CD", "cassette", "Preloaded Digital Audio Player") |
| **LibriVox links** | Search result field `id_librivox` contains LibriVox IDs for public-domain audiobooks |
| **Internet Archive** | Many audiobooks on archive.org link back to OL editions with `ia` field + `ebook_access` |
| **Schema.org markup** | OL pages include Schema.org `Audiobook` markup with `readBy`, `duration`, `abridged`, `encodingFormat` |
| **No genre flag** | No boolean/field to distinguish "this is an audiobook" at the search result level |

### Alternative: LibriVox API

For public-domain audiobooks specifically:

```
GET https://librivox.org/api/feed/audiobooks?title=hobbit&format=json
```

Parameters: `id`, `author`, `title`, `genre`, `since` (UNIX timestamp), `extended=1` (full data)
Returns: `id`, `title`, `description`, `language`, `copyright_year`, `totaltime`, `totaltimesecs`, `authors`, `sections` (chapters with track numbers), `genres`, `url_zip_file`, `url_librivox`, `url_iarchive`, `coverart_thumbnail`

---

## 7. Cover Image URL Patterns

| Identifier | URL Pattern | Example |
|------------|-------------|---------|
| ISBN | `https://covers.openlibrary.org/b/isbn/{isbn}-{S,M,L}.jpg` | `/b/isbn/9780547928227-L.jpg` |
| OLID (edition) | `https://covers.openlibrary.org/b/olid/{olid}-{S,M,L}.jpg` | `/b/olid/OL7440033M-M.jpg` |
| Internal ID | `https://covers.openlibrary.org/b/id/{cover_i}-{S,M,L}.jpg` | `/b/id/258027-S.jpg` |
| LCCN | `https://covers.openlibrary.org/b/lccn/{lccn}-{S,M,L}.jpg` | `/b/lccn/93005405-S.jpg` |
| OCLC | `https://covers.openlibrary.org/b/oclc/{oclc}-{S,M,L}.jpg` | `/b/oclc/28419896-S.jpg` |
| Author photo | `https://covers.openlibrary.org/a/olid/{olid}-{S,M,L}.jpg` | `/a/olid/OL23919A-S.jpg` |

**Getting the cover for a work (not edition):** Use `cover_edition_key` from search results or `cover_i` (internal cover ID). The Search API's edition subquery in combination with `&lang=en` helps select the best edition cover.

**Getting cover JSON info:** Append `.json`: `https://covers.openlibrary.org/b/id/12547191.json`

---

## 8. Recommended Approach for an Audiobook Metadata Tool

### Primary flow:
1. **Search by title/author** → `GET /search.json?q={title}+{author}&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,publisher,subject,series_name,series_position,id_librivox,language&limit=10`
2. **Lookup by ISBN** → `GET /search.json?isbn={isbn}&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,publisher,subject,series_name,series_position,language`
3. **Get full work details** → `GET https://openlibrary.org{work_key}.json` (for description, full series info)
4. **Get cover URL** → `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg` or `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg`

### Audiobook-specific enrichment:
- Check `id_librivox` for LibriVox audiobook links
- For books found via search that have `ebook_access`, check archive.org for audio formats
- Consider using the [LibriVox API](https://librivox.org/api/info) as a companion source for public-domain audiobook metadata (narrator, duration, chapters, download URLs)

### Caching strategy:
- Cache search results aggressively (per `fields` recommendation and rate limits)
- Use batch OR queries instead of individual lookups: `?q=key:(/works/OL123W OR /works/OL456W)`
- Prefer data dumps for large-scale metadata needs

---

## 9. Key Limitations & Known Issues

1. **No native audiobook metadata** — No `narrator`, `duration`, or `abridged` fields in search results. These exist in Schema.org markup on page views but are not exposed via the Search API.
2. **Series + editions bug** — Requesting `editions` field silently drops works matched only via series name.
3. **Deprecated legacy APIs** — The `/api/books` endpoint and `/api/search` (Infogami) are deprecated; use `/search.json` instead.
4. **Solr-backed, not always consistent** — The search index lags behind the database; recent edits may not appear immediately.
5. **`number_of_pages_median`** — Not actual page count of a specific edition; it is the median across all editions of a work.
6. **No bulk author lookup** — No endpoint to fetch full data for multiple authors at once (workaround: search with `key:(/authors/OL123A OR /authors/OL456A)`).
