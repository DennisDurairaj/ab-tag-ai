# Audiobookshelf HTTP REST API — Research

> **Primary sources:**
> - Official API docs: <https://api.audiobookshelf.org>
> - GitHub repo: <https://github.com/advplyr/audiobookshelf> (server source in `server/`)
> - API Router source: [`server/routers/ApiRouter.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/routers/ApiRouter.js)
> - MiscController: [`server/controllers/MiscController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/MiscController.js)
> - LibraryItemController: [`server/controllers/LibraryItemController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/LibraryItemController.js)
> - CoverManager: [`server/managers/CoverManager.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/managers/CoverManager.js)
> - Official docs site: <https://www.audiobookshelf.org/docs>
> - Warning from api.audiobookshelf.org: *"These API docs are out-of-date and are no longer maintained. We hope to implement automated OpenAPI docs in the future."*

**No published OpenAPI/Swagger spec exists.** The only spec-like document is the Slate-based API reference at `api.audiobookshelf.org`, which is marked as out-of-date. The definitive source is the source code itself.

---

## 1. Authentication

**Primary method: Bearer token**

- ABS uses a **JWT-like user API token** passed as a Bearer token in the `Authorization` header.
- Source: <https://api.audiobookshelf.org/#authentication>
  > "Audiobookshelf uses a users API token as a Bearer token for requests."

**Header format:**
```
Authorization: Bearer exJhbGciOiJI6IkpXVCJ9.eyJ1c2Vyi5NDEyODc4fQ.ZraBFohS4Tg39NszY
```

**Alternative for GET requests:** The token may be passed as a query parameter:
```
https://abs.example.com/api/items/li_asdfalwkerioa?token=exJhbGciOiJI6IkpXVCJ9...
```
Source: <https://api.audiobookshelf.org/#authentication> — "For GET requests the API token can optionally be passed in as a query string."

**Obtaining a token:**
1. Via the web UI (admin → config → users → click your account).
2. Programmatically via `POST /login` with `username` and `password`. The token is returned in `response.user.token`.
   - Source: <https://api.audiobookshelf.org/#login>

**Token validation:**
- `POST /api/authorize` — re-validates a persisted token and returns user + server settings. Useful for client startup.
  - Source: <https://api.audiobookshelf.org/#get-authorized-user-and-server-information>

**No API-key alternative** (e.g., separate "API keys" managed in settings). The `POST /api/authorize` endpoint is the standard way to validate a token programmatically. ABS v2.x does have an API key system (`GET /api/api-keys`, etc.) but it appears secondary to the user token.

**Rate limiting on login:** Configurable via `rateLimitLoginRequests` and `rateLimitLoginWindow` server settings (default: 10 requests per 600000ms = 10 minutes).
  - Source: Login response in API docs shows `"rateLimitLoginRequests": 10, "rateLimitLoginWindow": 600000`.

---

## 2. Library Targeting

**Libraries are addressed by UUID** in the URL path. Libraries have IDs of the form `lib_xxxxxxxxxxxxxx`.

- Source: <https://api.audiobookshelf.org/#get-a-library> — `GET https://abs.example.com/api/libraries/<ID>`
- Source: `ApiRouter.js` — routes pattern: `/libraries/:id/...`

**Library UUIDs are obtained via:**
- `GET /api/libraries` — returns all libraries accessible to the user.
  - Source: <https://api.audiobookshelf.org/#get-all-libraries>
- The `userDefaultLibraryId` field in the login/authorize response gives the user's default library.

**Library folders** are also addressed by ID (e.g., `fol_xxxxxxxxxxxxxx`). Required for the upload endpoint (`POST /api/upload`).

**No name-based lookup** exists in the API. Libraries are fully UUID-keyed.

---

## 3. File Upload / Library Item Creation

### Endpoint: `POST /api/upload`

- Source: <https://api.audiobookshelf.org/#upload-files>
- Source: `MiscController.handleUpload()` at [`MiscController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/MiscController.js)

**Request format: multipart/form-data**

```
curl -X POST "https://abs.example.com/api/upload" \
  -H "Authorization: Bearer ..." \
  -F title="Wizard's First Rule" \
  -F author="Terry Goodkind" \
  -F series="Sword of Truth" \
  -F library="lib_c1u6t4p45c35rf0nzd" \
  -F folder="fol_bev1zuxhb0j0s1wehr" \
  -F 0=@"file01.mp3" \
  -F 1=@"file02.mp3" \
  -F 2=@cover.jpg
```

**Form parameters:**

| Parameter  | Required | Description |
|------------|----------|-------------|
| `title`    | Yes      | Library item title |
| `library`  | Yes      | Library UUID |
| `folder`   | Yes      | Folder UUID within library |
| `author`   | No       | Author name (nullable) |
| `series`   | No       | Series name (nullable) |
| (any key)  | —        | File attachments. Keys are ignored. |

**File path convention:** Files are placed at:
```
<folderPath>/<author>/<series>/<title>/<filename>
```
Source: `MiscController.handleUpload()` lines 63–65:
```js
const outputDirectoryParts = library.isPodcast ? [title] : [author, series, title]
```

**Multiple files may be uploaded together** and they will be placed into the same directory, creating one library item. The server does not wantonly combine them; they appear as individual audio files under the item.

**Supported file types** (from API docs):
> Source: <https://api.audiobookshelf.org/#upload-files>
Audio: `.m4b`, `.mp3`, `.m4a`, `.flac`, `.opus`, `.ogg`, `.oga`, `.mp4`, `.aac`, `.wma`, `.aiff`, `.wav`, `.webm`, `.webma`, `.m4b`  
Images: `.png`, `.jpg`, `.jpeg`, `.webp`  
Ebooks: `.epub`, `.pdf`, `.mobi`, `.azw3`, `.cbr`, `.cbz`  
Metadata: `.nfo`, `.txt`, `.opf`, `.abs`

**Important: No metadata fields can be set on upload besides `title`, `author`, and `series`.** Other metadata (narrator, ASIN, ISBN, description, publisher, genres, etc.) must be set after creation via `PATCH /api/items/:id/media`.

**No explicit file size limit** is documented. The only limit is whatever the HTTP server/reverse proxy enforces.

**Permissions:** Requires `upload` permission on the user account.
  - Source: `MiscController.handleUpload()` — `if (!req.user.canUpload) { return res.sendStatus(403) }`

---

## 4. Metadata Fields

### Book Metadata Schema

Source: API docs "Book Metadata" schema (see the match endpoint response at lines 6235–6268 in the full docs).

Full metadata fields stored for a book:

| Field               | Type              | Settable on upload? | Description |
|---------------------|-------------------|----------------------|-------------|
| `title`             | String            | Yes (via form param) | Book title |
| `titleIgnorePrefix` | String            | No (auto-computed)   | Title with prefix removed for sorting |
| `subtitle`          | String or null    | Via update only      | Subtitle |
| `authors`           | Array of objects  | Via update only      | `[{id, name}]` — now an array in current API |
| `authorName`        | String            | No (computed from authors) | Flat author name for old API compat |
| `authorNameLF`      | String            | No (computed)        | "Last, First" format |
| `narrators`         | Array of String   | Via update only      | Narrator names |
| `narratorName`      | String            | No (computed)        | Flat narrator name |
| `series`            | Array of objects  | Via update only      | `[{id, name, sequence}]` |
| `seriesName`        | String            | No (computed)        | Flat series name |
| `genres`            | Array of String   | Via update only      | Genre tags |
| `publishedYear`     | String or null    | Via update only      | Publication year |
| `publishedDate`     | String or null    | Via update only      | Full publication date |
| `publisher`         | String or null    | Via update only      | Publisher name |
| `description`       | String or null    | Via update only      | Book description/synopsis |
| `isbn`              | String or null    | Via update only      | ISBN identifier |
| `asin`              | String or null    | Via update only      | Amazon ASIN |
| `language`          | String or null    | Via update only      | Language code |
| `explicit`          | Boolean           | Via update only      | Explicit content flag |

**Update endpoint:** `PATCH /api/items/:id/media`
  - Source: <https://api.audiobookshelf.org/#update-a-library-item-39-s-media>
  - Source: `LibraryItemController.updateMedia()` at [`LibraryItemController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/LibraryItemController.js) — handles `series`, `authors`, `metadata` updates, and cover URL upload.

**Batch update:** `POST /api/items/batch/update` — accepts array of `[{id, mediaPayload}]`.
  - Source: `LibraryItemController.batchUpdate()` and API docs "Batch Update Library Items"

**Additional item-level fields:** `tags` (array of strings), `coverPath`, `chapters`, `tracks` (ordered audio track data), `duration`, `size`.

---

## 5. Duplicate Detection

**ABS has no built-in explicit "duplicate check" endpoint.** There is no API call that answers "does this title already exist?"

**Workarounds available:**

### 5a. Library search: `GET /api/libraries/:id/search?q=...`
- Source: <https://api.audiobookshelf.org/#search-a-library>
- Returns library items matching a text query against title, author, etc.
- Can be used to search by title or ASIN before uploading.

### 5b. Library items list (with filtering): `GET /api/libraries/:id/items`
- Source: <https://api.audiobookshelf.org/#get-a-library-39-s-items>
- Supports `filter` parameter for filtering. See filtering docs for filter format (base64-encoded values).
- Could filter by author, series, genre, etc. and scan results for matching titles.
- Note: **no direct filter by ASIN or ISBN** — these are nested in `media.metadata.asin` and filtering is limited to top-level attributes (authors, genres, tags, series, narrators, languages).

### 5c. Client-side dedup
- Fetch all library items (possibly paginated), then compare by `title + authorName` or `asin` locally.

**Key insight:** The existing tooling around ABS (e.g., `abs-cli`) generally scans the library's items endpoint and does client-side matching. The API itself imposes no uniqueness constraint on title+author.

---

## 6. Provider Metadata Matching

### Built-in metadata providers

Source: `SearchController.js` provider map:
- `google` — Google Books
- `itunes` — iTunes
- `openlibrary` — Open Library
- `fantlab` — FantLab.ru
- `audiobookcovers` — AudiobookCovers.com (covers only)
- `audible`, `audible.ca`, `audible.uk`, `audible.au`, `audible.fr`, `audible.de`, `audible.jp`, `audible.it`, `audible.in`, `audible.es` — Various Audible regions
- `audnexus` — Audnexus API
- Custom metadata providers (user-defined via `/api/custom-metadata-providers`)

### Search providers externally: `GET /api/search/books`
- Source: <https://api.audiobookshelf.org/#search-for-books>
- Query: `?provider=audible&title=...&author=...`
- Optional: `?id=<libraryItemId>` to use existing item metadata for search.
- Returns provider-specific results with cover URLs, metadata.

### Match a library item: `POST /api/items/:id/match`
- Source: <https://api.audiobookshelf.org/#match-a-library-item>
- Source: `LibraryItemController.match()` at [`LibraryItemController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/LibraryItemController.js) line ~300

**Request body:**
```json
{
  "provider": "openlibrary",
  "title": "optional override title",
  "author": "optional override author",
  "isbn": "optional ISBN",
  "asin": "optional ASIN",
  "overrideCover": false,
  "overrideDetails": false
}
```

- The `match()` controller calls `Scanner.quickMatchLibraryItem()` which searches the specified provider using the item's existing metadata (or overrides), then applies the matched metadata to the library item.
- Returns `{ updated: true, libraryItem: {...} }` if a match was found and applied.
- `provider` field is optional — if omitted, uses the library's default provider.
- `overrideCover` — whether to replace the existing cover with the match result.
- `overrideDetails` — whether to overwrite existing details (description, genres, etc.)

### Batch quick match: `POST /api/items/batch/quickmatch`
- Source: `LibraryItemController.batchQuickMatch()` and API docs "Batch Quick Match Library Items"
- Accepts `{libraryItemIds: [...], options: {provider, overrideCover, overrideDetails}}`
- Runs async and sends results via WebSocket event `batch_quickmatch_complete`.

### Match all items in a library: `GET /api/libraries/:id/matchall`
- Source: <https://api.audiobookshelf.org/#match-all-of-a-library-39-s-items>
- Runs `Scanner.matchLibraryItems()` for the entire library — async, no response body besides 200.

### Chapter lookup: `GET /api/search/chapters?asin=...`
- Source: <https://api.audiobookshelf.org/#search-for-a-book-39-s-chapters>
- Looks up chapter data by ASIN using Audnexus API.

### Cover search: `GET /api/search/covers`
- Source: <https://api.audiobookshelf.org/#search-for-covers>
- `?title=...&author=...&provider=...`

---

## 7. Cover Art

### Upload a cover: `POST /api/items/:id/cover`
- Source: <https://api.audiobookshelf.org/#upload-a-library-item-cover>
- Source: `LibraryItemController.uploadCover()` at [`LibraryItemController.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/controllers/LibraryItemController.js)
- Two modes:
  1. **Multipart upload:** `-F cover=@cover.jpg`
  2. **Download from URL:** `-H "Content-Type: application/json" -d '{"url": "https://..."}'`

**Supported image formats** (from `CoverManager.js`):
> Source: [`CoverManager.js`](https://github.com/advplyr/audiobookshelf/blob/master/server/managers/CoverManager.js) — `SupportedImageTypes` from `globals`

- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- WebP (`.webp`)
- JIFF (`.jiff`)

**No explicit resolution limit is documented.** The cover is stored as-is. The cover retrieval endpoint (`GET /api/items/:id/cover`) supports optional `width`, `height`, and `format` query parameters to serve scaled/transcoded versions on-the-fly.

### Update cover path: `PATCH /api/items/:id/cover`
- Source: <https://api.audiobookshelf.org/#update-a-library-item-39-s-cover>
- Points to an existing image path on the server.

### Remove cover: `DELETE /api/items/:id/cover`

### Get cover: `GET /api/items/:id/cover`
- Optional: `?width=400&height=&format=webp&raw=1`
- `raw=1` returns the raw file without scaling.
- `format` defaults to `webp` if the client supports it, else `jpeg`.

---

## 8. Rate Limits / Best Practices

**Only documented rate limit: Login endpoint**
- Source: Login response — `"rateLimitLoginRequests": 10, "rateLimitLoginWindow": 600000`
- 10 login attempts per 10 minutes.

**No other documented rate limits** for API endpoints. The source code shows no per-endpoint rate limiting middleware on the API router (`ApiRouter.js`), except the `auth.authRateLimiter` middleware on the password change endpoint.

**Best practices inferred from source:**
- Uploads are synchronous (the handler moves files to disk and returns 200). After upload, the library watcher or a library scan picks up new items.
- For bulk operations, use `POST /api/items/batch/delete`, `POST /api/items/batch/update`, `POST /api/items/batch/get`, `POST /api/items/batch/quickmatch`.
- The `POST /api/upload` endpoint does NOT return a library item ID — it only places files on disk. Afterward, you need to trigger a library scan (`POST /api/libraries/:id/scan`) and then find the new item by searching.
- There is no progress reporting for uploads (it's a simple multipart upload, so it blocks until complete).
- Library scanning is async — `POST /api/libraries/:id/scan` returns 200 immediately and scans in the background, emitting WebSocket events for progress.

---

## Quick Reference: Key Endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| Login / get token | POST | `/login` |
| Validate token | POST | `/api/authorize` |
| List libraries | GET | `/api/libraries` |
| Upload files (create item) | POST | `/api/upload` |
| Get library items | GET | `/api/libraries/:id/items` |
| Search library | GET | `/api/libraries/:id/search?q=...` |
| Get item details | GET | `/api/items/:id` |
| Update item metadata | PATCH | `/api/items/:id/media` |
| Match item to provider | POST | `/api/items/:id/match` |
| Batch quick match | POST | `/api/items/batch/quickmatch` |
| Upload cover | POST | `/api/items/:id/cover` |
| Delete item | DELETE | `/api/items/:id` |
| Scan library | POST | `/api/libraries/:id/scan` |
| Search provider for books | GET | `/api/search/books` |
| Delete all items with issues | DELETE | `/api/libraries/:id/issues` |
