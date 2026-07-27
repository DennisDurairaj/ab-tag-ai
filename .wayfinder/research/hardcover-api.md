# Hardcover.app GraphQL API — Research Summary

> Sources: `docs.hardcover.app`, `github.com/hardcoverapp/hardcover-docs`, GitHub issues, community projects.
> Last updated: July 2026

---

## 1. Getting an API Key

- Go to **https://hardcover.app/account/api** (Settings > Hardcover API)
- Token is displayed at the top of the page — copy it exactly (includes `Bearer ` prefix?)
  - Some docs say the token itself is the raw JWT; **you must prepend `Bearer `** when setting the `Authorization` header.
  - Other docs say the page shows a ready-to-use `Bearer eyJ...` string. Check which format is shown and use as-is.
- Tokens expire after **1 year**, reset on January 1st.
- Tokens may be reset without notice during beta.
- Do not share tokens — they can access your account data.
- Only usable from localhost/backend — never from a browser.

---

## 2. GraphQL Endpoint

```
POST https://api.hardcover.app/v1/graphql
```

- GraphQL Console (Hasura): https://cloud.hasura.io/public/graphiql?endpoint=https://api.hardcover.app/v1/graphql
- Staging: `https://staging-api.hardcover.app/`

---

## 3. Authentication

**Header format:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

All queries require authentication — even public book/author searches. The API no longer accepts unauthenticated requests.

**Curl example:**

```bash
curl -X POST https://api.hardcover.app/v1/graphql \
  -H "Authorization: Bearer $HARDCOVER_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "query { me { id username } }"}'
```

**Response codes:**

| Code | Description          | Body                                        |
|------|----------------------|---------------------------------------------|
| 200  | Success              |                                             |
| 401  | Invalid/expired token | `{ "error": "Unable to verify token" }`    |
| 403  | No access            | `{ "error": "Message describing error" }`  |
| 429  | Rate limited         | `{ "error": "Throttled" }` + `RateLimit-*` headers |
| 500  | Server error         | `{ "error": "An unknown error occurred" }` |

---

## 4. Rate Limits & Constraints

### Per-minute rate limit
- **60 requests per minute** per user.
- Each **top-level field** in a GraphQL request counts as 1 request (minimum 1 per HTTP POST). A query with 5 top-level queries uses 5 of your 60.
- Introspection (`__schema`, `__type`, `__typename`) is free.

### Per-request top-level limits (announced July 2026)
- `search`: max **1** per request
- `mutation`: max **5** per request
- `query`: max **5** per request
- Aliases count separately — `q1: books(...) q2: books(...)` counts as 2.
- Nested selections do not count — only root fields.
- Exceeded limit returns `403 Forbidden` with body `{"errors": ["top_level_limit_exceeded", ...]}`.

### Other constraints
- Max query timeout: **30 seconds**
- Max query depth: **3**
- Disabled operators: `_like`, `_nlike`, `_ilike`, `_niregex`, `_nregex`, `_iregex`, `_regex`, `_nsimilar`, `_similar` — **only `_eq` and `_gt`/`_lt`/`_gte`/`_lte`/`_neq`/`_in`/`_is_null` are available**.
- Can only access your own data, public data, and data of users you follow.
- Recommended: include a `User-Agent` header describing your script.

---

## 5. How Search Works

Search uses **Typesense** under the hood — the same index as the website. It supports fuzzy matching with configurable typo tolerance.

### Search query (GraphQL `search` root field)

```graphql
query SearchBooks {
  search(
    query: "lord of the rings"
    query_type: "Book"
    per_page: 5
    page: 1
  ) {
    results
  }
}
```

### Parameters
| Parameter    | Required | Default  | Description |
|-------------|----------|----------|-------------|
| `query`     | Yes      | —        | Search term |
| `query_type`| No       | `book`   | One of: `author`, `book`, `character`, `list`, `prompt`, `publisher`, `series`, `user` (case-insensitive) |
| `per_page`  | No       | 25       | Results per page |
| `page`      | No       | 1        | Page number |
| `sort`      | No       | varies   | Sort attributes (e.g. `_text_match:desc,users_count:desc`) |
| `fields`    | No       | varies   | Which fields within the type to include in search |
| `weights`   | No       | varies   | Comma-separated weights for each field in `fields` |
| `typos`     | No       | varies   | Comma-separated typo tolerance for each field |

### Return shape
```json
{
  "data": {
    "search": {
      "ids": [123, 456, ...],
      "results": [ /* Typesense result objects */ ],
      "query": "lord of the rings",
      "query_type": "book",
      "page": 1,
      "per_page": 5
    }
  }
}
```

### Search — book fields available
- `title`, `subtitle`, `alternative_titles`, `author_names`, `series_names`
- `description`, `rating`, `ratings_count`, `reviews_count`, `users_count`, `users_read_count`
- `pages`, `audio_seconds`, `has_audiobook`, `has_ebook`
- `release_year`, `release_date_i`
- `isbns`, `slug`, `cover_color`
- `genres` (top 5), `moods` (top 5), `tags` (top 5), `content_warnings` (top 5)
- `compilation`, `lists_count`, `prompts_count`, `activities_count`
- `contributions`, `featured_series`, `featured_series_position`

### Default search config (books)
- `fields`: `title,isbns,series_names,author_names,alternative_titles`
- `sort`: `_text_match:desc,users_count:desc`
- `weights`: `5,5,3,1,1`
- `typos`: `5,0,5,5,5` — title gets typo tolerance 5 (fuzzy), ISBN gets 0 (exact)

### Fuzzy vs exact
- Search is **fuzzy by default** via Typesense (controlled by `typos` parameter).
- For exact matching, use the **filter-based queries** (e.g., `books(where: {title: {_eq: "..."}})` or `editions(where: {isbn_13: {_eq: "..."}})`).
- Regex and `LIKE` operators are **disabled** — only `_eq`, `_neq`, `_in`, `_gt`, `_lt`, `_gte`, `_lte`, `_is_null` are available.

---

## 6. Metadata Fields Available

### Book (`books` table)
| Field | Type | Description |
|-------|------|-------------|
| `id` | Int! | Unique identifier |
| `title` | String | Primary title |
| `subtitle` | String | Subtitle |
| `alternative_titles` | json! | Alternate titles array |
| `description` | String | Book summary |
| `slug` | String | URL-friendly identifier |
| `pages` | Int | Page count |
| `audio_seconds` | Int | Audiobook duration in seconds |
| `release_date` | date | Original publication date |
| `release_year` | Int | Publication year |
| `rating` | numeric | Average rating (0-5) |
| `ratings_count` | Int! | Total ratings |
| `ratings_distribution` | jsonb! | Ratings breakdown by star |
| `reviews_count` | Int! | Total reviews |
| `users_count` | Int! | Users with this book shelved |
| `users_read_count` | Int! | Users who finished reading |
| `book_category_id` | Int! | 1=Book, 2=Novella, 3=Short Story, 4=Graphic Novel, 5=FanFic, 6=Research Paper, 7=Poetry, 8=Collection, 9=Web Novel, 10=Light Novel |
| `compilation` | Boolean! | Is a compilation/anthology |
| `is_partial_book` | Boolean | Part of a larger work |
| `literary_type_id` | Int | 1=Fiction, 2=Nonfiction |
| `links` | jsonb! | External links (Wikipedia, Goodreads, etc.) |
| `headline` | String | Short tagline |
| `cached_contributors` | json! | Cached contributor data |
| `cached_image` | jsonb! | Cached cover image |
| `cached_tags` | jsonb! | Cached tags |
| `cached_featured_series` | jsonb | Cached featured series info |
| `genres` | (via `taggings`) | |
| `image` | images | Cover image |
| `default_audio_edition` | editions | Default audiobook edition |
| `default_physical_edition` | editions | Default physical edition |
| `default_ebook_edition` | editions | Default ebook edition |
| `editions` | [editions!]! | All editions |

### Edition (`editions` table) — additional fields
| Field | Type | Description |
|-------|------|-------------|
| `id` | Int! | Unique identifier |
| `title` | String | Edition title |
| `subtitle` | String | Subtitle |
| `isbn_10` | String | ISBN-10 |
| `isbn_10_valid` | Boolean | Valid ISBN-10 |
| `isbn_13` | String | ISBN-13 |
| `isbn_13_valid` | Boolean | Valid ISBN-13 |
| `asin` | String | Amazon ID (ASIN) |
| `pages` | Int | Page count |
| `audio_seconds` | Int | Audiobook duration in seconds |
| `release_date` | date | Publication date |
| `release_year` | Int | Publication year |
| `edition_format` | String | `hardcover`, `paperback`, `ebook`, `audiobook` |
| `physical_format` | String | Physical format details |
| `reading_format_id` | Int! | 1=Physical, 2=Audio, 3=Both, 4=Ebook |
| `publisher` | publishers | Publisher (name, etc.) |
| `language` | languages | Edition language |
| `country` | countries | Country of publication |
| `rating` | numeric | Average rating |
| `users_count` | Int! | Users with this edition |
| `users_read_count` | Int! | Users who read this edition |
| `cached_contributors` | json! | Cached contributor data |
| `cached_image` | jsonb! | Cached cover image |
| `compilation` | Boolean! | Is a compilation |
| `source` | String | Data source (OpenLibrary, manual, etc.) |

### Series (`series` table)
| Field | Type | Description |
|-------|------|-------------|
| `id` | Int! | Unique identifier |
| `name` | String! | Series name |
| `slug` | String! | URL-friendly identifier |
| `description` | String | Description |
| `author` | authors | Primary author |
| `books_count` | Int! | Number of books |
| `primary_books_count` | Int | Main series books (excl. companions) |
| `is_completed` | Boolean | Series is complete |
| `book_series` | [book_series!]! | Books in this series with position |

### Book Series (join: `book_series`)
| Field | Type | Description |
|-------|------|-------------|
| `position` | numeric | Position in series |
| `compilation` | Boolean! | Whether position represents a compilation |
| `book` | books! | The book |
| `series` | series! | The series |

### Author (`authors`)
| Field | Type | Description |
|-------|------|-------------|
| `id` | Int! | Unique identifier |
| `name` | String | Name |
| `slug` | String | URL-friendly identifier |
| `image` | images | Author photo |
| `born_at` | date | Birth date |
| `died_at` | date | Death date |
| `description` | String | Biography |
| `books_count` | Int! | Number of books |

---

## 7. Audiobook-Specific Fields

| Field | Location | Description |
|-------|----------|-------------|
| `audio_seconds` | `books` / `editions` | Duration in seconds |
| `has_audiobook` | Search result field | Boolean — known to have an audiobook |
| `reading_format_id` | `editions` | `2` = Audio |
| `edition_format` | `editions` | `"audiobook"` |
| `default_audio_edition` | `books` | The default audiobook edition (object) |
| `default_audio_edition_id` | `books` | ID of default audiobook edition |
| `asin` | `editions` | Amazon ASIN (often links to Audible) |

**Finding audiobooks** — use either:
- Filter `editions` by `reading_format_id: {_eq: 2}` and/or `audio_seconds: {_gt: 0}`
- Use the `search` endpoint and inspect `has_audiobook` / `audio_seconds` fields
- Walk `book.default_audio_edition` for the canonical audiobook

---

## 8. Pagination

### For `search` queries
Simple offset-based: `page` (default 1) + `per_page` (default 25).

### For filter-based queries (`books`, `editions`, `user_books`, etc.)
Standard Hasura pagination with `limit` and `offset`:

```graphql
books(
  limit: 20
  offset: 40
  order_by: { users_count: desc }
) { ... }
```

No cursor-based pagination documented.

### Aggregate queries
Use `_aggregate` variants for counting:

```graphql
books_aggregate(where: { ... }) {
  aggregate {
    count
  }
}
```

---

## 9. Example Queries

### Me query (test auth)
```graphql
query {
  me {
    id
    username
  }
}
```

### Search book by title+author (fuzzy)
```graphql
query SearchBook {
  search(
    query: "the hobbit jrr tolkien",
    query_type: "Book",
    per_page: 5
  ) {
    results
  }
}
```

### Search with explicit fields/weights/typos
```graphql
query SearchBookCustom {
  search(
    query: "mistborn",
    query_type: "Book",
    fields: "title,author_names",
    weights: "5,3",
    typos: "3,2",
    per_page: 10
  ) {
    ids
    results
  }
}
```

### Find book by exact ISBN (via editions)
```graphql
query FindByISBN {
  editions(where: { isbn_13: { _eq: "9780765326355" } }) {
    id
    title
    isbn_13
    asin
    audio_seconds
    pages
    release_date
    edition_format
    reading_format { format }
    publisher { name }
    language { language }
    book {
      id
      title
      rating
      description
      release_date
      contributions {
        author { name }
      }
      book_series {
        series { name }
        position
      }
      image { url }
    }
  }
}
```

### Get audiobook editions
```graphql
query AudiobookEditions {
  editions(
    where: {
      reading_format_id: { _eq: 2 },
      audio_seconds: { _gt: 0 }
    }
    order_by: { users_count: desc }
    limit: 20
  ) {
    id
    title
    asin
    audio_seconds
    edition_format
    release_date
    publisher { name }
    language { language }
    cached_contributors
    book {
      id
      title
      rating
      image { url }
      description
    }
  }
}
```

### Get book with all metadata
```graphql
query BookWithDetails {
  books(where: { id: { _eq: 328491 } }) {
    id
    title
    subtitle
    description
    slug
    pages
    audio_seconds
    release_date
    release_year
    rating
    ratings_count
    reviews_count
    users_count
    users_read_count
    book_category_id
    compilation
    literary_type_id
    links
    headline
    cached_image
    image { url width height }
    default_audio_edition {
      id
      asin
      audio_seconds
      publisher { name }
    }
    contributions {
      author { id name slug }
      role
    }
    book_series(order_by: { position: asc }) {
      position
      series { id name slug }
    }
  }
}
```

### Get books by series
```graphql
query BooksInSeries {
  series(where: { name: { _eq: "The Stormlight Archive" } }) {
    id
    name
    slug
    books_count
    author { name }
    book_series(
      distinct_on: position
      order_by: [{ position: asc }, { book: { users_count: desc } }]
      where: {
        book: { canonical_id: { _is_null: true }, is_partial_book: { _eq: false } }
        compilation: { _eq: false }
      }
    ) {
      position
      book {
        id
        title
        slug
        pages
        rating
        release_year
        image { url }
      }
    }
  }
}
```

### Pagination example (offset-based)
```graphql
query PaginatedBooks {
  books(
    where: { book_category_id: { _eq: 1 } }
    limit: 25
    offset: 50
    order_by: { users_count: desc }
  ) {
    id
    title
    rating
  }
  books_aggregate(
    where: { book_category_id: { _eq: 1 } }
  ) {
    aggregate { count }
  }
}
```

---

## 10. Known Caveats

- **The API is in beta** — may break without notice.
- **No `_like`/`_ilike`/regex operators** — exact match only via `_eq`, use `search()` for fuzzy.
- **Max depth 3** — deeply nested queries will fail.
- **Search is limited to 1 per request** (per-request limit).
- **Each top-level field counts against 60/min rate limit** — batch carefully.
- **Only offline/localhost use** — cannot be used from browser frontends.
- **Data ownership** — you can only access your data, public data, and followed users' data.

---

## 11. Key URLs

| Resource | URL |
|----------|-----|
| API key page | https://hardcover.app/account/api |
| GraphQL endpoint | `POST https://api.hardcover.app/v1/graphql` |
| GraphQL console | https://cloud.hasura.io/public/graphiql?endpoint=https://api.hardcover.app/v1/graphql |
| Docs homepage | https://docs.hardcover.app |
| Getting started | https://docs.hardcover.app/api/getting-started/ |
| Search guide | https://docs.hardcover.app/api/guides/searching/ |
| Book schema | https://docs.hardcover.app/api/graphql/schemas/books/ |
| Edition schema | https://docs.hardcover.app/api/graphql/schemas/editions/ |
| Series schema | https://docs.hardcover.app/api/graphql/schemas/series/ |
| Docs GitHub | https://github.com/hardcoverapp/hardcover-docs |
| Discord | https://discord.gg/edGpYN8ym8 |
