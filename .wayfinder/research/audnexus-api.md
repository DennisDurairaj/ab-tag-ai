# Audnexus API Research

**Source:** https://audnex.us/ | https://github.com/laxamentumtech/audnexus | https://laxamentum.tech/

**Version:** 1.8.0+ (latest: 1.14.0)

**License:** GPL v3

---

## 1. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (returns server, DB, Redis status) |
| GET | `/authors?name={name}&region={region}` | Search authors by name |
| GET | `/authors/{ASIN}?region={region}&update={0\|1}` | Get author by ASIN |
| DELETE | `/authors/{ASIN}?region={region}` | Delete author |
| GET | `/books/{ASIN}?region={region}&update={0\|1}&seedAuthors={0\|1}` | Get book by ASIN |
| DELETE | `/books/{ASIN}?region={region}` | Delete book |
| GET | `/books/{ASIN}/chapters?region={region}&update={0\|1}` | Get chapters by ASIN |
| DELETE | `/books/{ASIN}/chapters?region={region}` | Delete chapters |

**Base URL:** `https://api.audnex.us`

---

## 2. Searching by Title and Author

**Critical limitation:** There is NO book search endpoint. The only search is author-by-name at `GET /authors?name=...`.

To find a book, you need the **ASIN** (Amazon Standard Identification Number) — obtained separately (e.g., from Audible website search, or from a local file name).

**Author search example:**
```
GET https://api.audnex.us/authors?name=Andy%20Weir
```
Returns an array of author objects with `asin`, `name` fields. The first results are the best match (repeated for relevance), followed by partial matches.

**Typical workflow:** Search Audible website → extract ASIN from URL → query Audnexus.

---

## 3. Book Metadata Fields

### Confirmed from live API response (`/books/B08G9PRS1K` — Project Hail Mary):

| Field | Type | Example |
|-------|------|---------|
| `asin` | string | `"B08G9PRS1K"` |
| `authors` | array[{asin, name}] | `[{"asin":"B00G0WYW92","name":"Andy Weir"}]` |
| `copyright` | integer | `2021` |
| `description` | string | `"When the Sun is threatened..."` (short text) |
| `formatType` | string | `"unabridged"` |
| `genres` | array[{asin, name, type}] | Genres (`type: "genre"`) and tags (`type: "tag"`) |
| `image` | string | URL to cover image (Amazon CDN) |
| `isAdult` | boolean | `false` |
| `isbn` | string | `"9781603935470"` |
| `language` | string | `"english"` |
| `literatureType` | string | `"fiction"` |
| `narrators` | array[{name}] | `[{"name":"Ray Porter"}]` |
| `publisherName` | string | `"Audible Studios"` |
| `rating` | string | `"4.9"` |
| `region` | string | `"us"` |
| `releaseDate` | string (ISO 8601) | `"2021-05-04T00:00:00.000Z"` |
| `runtimeLengthMin` | integer | `970` |
| `summary` | string (HTML) | Full description with HTML tags |
| `title` | string | `"Project Hail Mary"` |

### Field mapping to user request:

| Requested Field | Available? | Notes |
|----------------|-----------|-------|
| title | ✅ | `title` field |
| author | ✅ | `authors[].name` |
| narrator | ✅ | `narrators[].name` |
| series name | ❌ | **NOT returned** by the public API |
| series position | ❌ | **NOT returned** by the public API |
| publisher | ✅ | `publisherName` |
| year | ✅ | `copyright` (also `releaseDate`) |
| description | ✅ | `description` (short) and `summary` (HTML long) |
| genres | ✅ | `genres[]` with `type: "genre"` (parent) and `type: "tag"` (sub) |
| cover image URL | ✅ | `image` field (Amazon CDN URL) |
| duration | ✅ | `runtimeLengthMin` (minutes); chapters give ms/sec |
| ASIN | ✅ | `asin` field |
| language | ✅ | `language` field |

### ⚠️ Series Information Gap

The public Audnexus API (`api.audnex.us`) does **not** return series name or series position. The OpenAPI spec (v1.8.0) does not document a `series` field on the book response.

Laxamentum Technologies offers a **separate paid enrichment product** (`/v1/books/enrich`) at laxamentum.tech that does include series data:
```json
"series": { "name": "Project Hail Mary", "position": 1 }
```
This is NOT the same as the free open-source API.

---

## 4. Chapter Metadata Fields

**Endpoint:** `GET /books/{ASIN}/chapters`

| Field | Type | Example |
|-------|------|---------|
| `asin` | string | `"B08G9PRS1K"` |
| `brandIntroDurationMs` | integer | `0` |
| `brandOutroDurationMs` | integer | `0` |
| `isAccurate` | boolean | `true` |
| `region` | string | `"us"` |
| `runtimeLengthMs` | integer | `58244201` |
| `runtimeLengthSec` | integer | `58244` |
| `chapters[]` | array | Array of chapter objects |
| ├ `lengthMs` | integer | `11264` |
| ├ `startOffsetMs` | integer | `0` |
| ├ `startOffsetSec` | integer | `0` |
| └ `title` | string | `"Opening Credits"` |

The chapters endpoint requires `ADP_TOKEN` and `PRIVATE_KEY` env vars if self-hosting (Audible API credentials). The public instance handles this server-side.

---

## 5. Author Metadata Fields

**Endpoint:** `GET /authors/{ASIN}`

| Field | Type | Example |
|-------|------|---------|
| `asin` | string | `"B00G0WYW92"` |
| `description` | string | Author biography text |
| `genres` | array[{asin, name, type}] | Author-level genre associations |
| `image` | string | URL to author photo |
| `name` | string | `"Andy Weir"` |
| `region` | string | `"us"` |
| `similar` | array[{asin, name}] | Similar authors |

---

## 6. Authentication

**None required.** The API is fully public and free.

No API keys, no registration, no tokens needed for the public instance at `api.audnex.us`.

---

## 7. Rate Limits

| Parameter | Default | Configurable |
|-----------|---------|-------------|
| Max requests per minute | 100 | Yes (`MAX_REQUESTS` env var) |

- Returns HTTP 429 with `RATE_LIMIT_EXCEEDED` error code.
- Response includes `retryAfterSeconds` in the error `details` object.
- Rate limiting is per source IP (with Cloudflare IP auto-discovery support).
- Circuit breaker pattern protects upstream providers.
- If self-hosting, rate limits are fully configurable.

---

## 8. Region/Locale Support

10 supported regions, passed as query parameter `region=`:

| Code | Domain |
|------|--------|
| `us` | audible.com (default) |
| `uk` | audible.co.uk |
| `au` | audible.com.au |
| `ca` | audible.ca |
| `de` | audible.de |
| `es` | audible.es |
| `fr` | audible.fr |
| `in` | audible.in |
| `it` | audible.it |
| `jp` | audible.co.jp |

Different regions return different ASINs and localized metadata. The agent was primarily built for English-speaking regions.

---

## 9. Response Format

- Default: JSON (`application/json`)
- Also supports: `application/xml`
- Error format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": null
  }
}
```

### Error Codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `CONTENT_TYPE_MISMATCH` | 400 | Wrong endpoint for content type (e.g., podcast ASIN on `/books`) |
| `BAD_REQUEST` | 400 | Invalid request parameters |
| `VALIDATION_ERROR` | 422 | Schema validation failed |
| `NOT_FOUND` | 404 | Item not found |
| `REGION_UNAVAILABLE` | 404 | Content not available in requested region |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |

---

## 10. ASIN Direct Lookup

**Yes, this is the primary way to use the API.** Every data endpoint is keyed by ASIN:

- `GET /books/{ASIN}` — Lookup book by ASIN
- `GET /authors/{ASIN}` — Lookup author by ASIN
- `GET /books/{ASIN}/chapters` — Lookup chapters by ASIN

The ASIN is the Amazon Standard Identification Number (e.g., `B08G9PRS1K`).

---

## 11. Reliability & Production Status

| Metric | Value |
|--------|-------|
| Uptime | 99.9% |
| Monthly requests | 4.7M+ |
| Audiobooks indexed | 3.2M+ |
| Last release | v1.14.0 (May 2026) |
| GitHub stars | 188+ |
| Forks | 10+ |
| Status page | https://status.audnex.us/ |
| Self-hostable | Yes (Docker, Docker Swarm, Coolify) |

**Known users:** Audiobookshelf (chapter lookup), Plex (via Audnexus.bundle), Bragibooks, Shisho, Listenarr.

**Data sources:** Primarily scrapes/aggregates from Audible's own API. Data is cached in MongoDB + Redis for performance. The more people use it, the more books are cached.

**Caveats:**
- Some books return 404 if not yet cached (especially niche or regional titles)
- Series information is NOT available through the public API
- Chapter data requires ADP_TOKEN/PRIVATE_KEY on self-hosted instances
- Description text sometimes has formatting issues (paragraph spacing lost)

---

## 12. Summary for Usability in Audiobook Metadata Tool

**Strengths:**
- Free, no auth, open source
- Fast JSON responses (cached)
- Reliable uptime (99.9%)
- Rich metadata for most popular US-market audiobooks
- Chapter-level data with accurate timings
- Covers 10 regions
- Can be self-hosted

**Weaknesses:**
- **No book search by title** — requires pre-existing ASIN
- **No series/position data** in the public API
- Limited coverage for niche or non-US titles
- Chapters endpoint may have degraded data if ADP_TOKEN not configured
- Audible is the primary data source (no Goodreads, no other cross-references)

**Recommendation:** Use Audnexus for ASIN-based lookups (get ASINs from filename patterns, user input, or Audible search). For series information, supplement with another source (Hardcover API, Open Library, or a local DB).
