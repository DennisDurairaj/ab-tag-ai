# Audiobook Tagging Ecosystem — Comprehensive Survey

> Research conducted 2026-07-29 against primary sources only.
> Target scenario: large library of poorly-tagged audiobooks with varying folder structures, primary goal = correctness (no false matches).

---

## Summary / Recommendations

### Where `ab-tag-ai` Fits

`ab-tag-ai` (described in `specs/000-baseline.md` through `specs/002-reduce-llm-calls.md`) is unique among audiobook taggers in its architecture:

1. **LLM as verifier, not orchestrator** — uses an LLM only for path interpretation (1 call) and ambiguous-match resolution (1 call, ~20% of books). Most books resolve deterministically via fuzzy match on provider results.
2. **Multi-provider merge** — parallel Open Library + Hardcover searches, ASIN from OL editions, series from HC, enrichment from Audnexus.
3. **Correctness-first design** — flag-for-review escape hatch at every phase, ASIN cache verification (never trusts tag ASINs), fuzzy-match gate before accepting a match.
4. **ABS-native upload** — uploads tagged files directly to Audiobookshelf with duplicate detection, retry, and fallback.

**No other tool in the ecosystem combines all of these properties.** Most tools either (a) require manual tagging (Mp3tag), (b) are music-first with no audiobook metadata model (beets, Picard), (c) match against a single provider (beets-audible → Audible only), or (d) use the directory structure as the authoritative metadata source (m4b-tool, tone).

### Comparison Matrix

| Tool | Auto-tagging | Multi-provider | ABS Upload | Review Queue | LLM |
|------|:---:|:---:|:---:|:---:|:---:|
| **ab-tag-ai** | Yes | OL + HC + Audnexus | Yes | Yes (`review/`) | Yes (verifier) |
| Mp3tag + Audible src | Manual | Audible only (via scraping) | No | No | No |
| beets + beets-audible | Yes | Audible only (via Audnexus) | No (local only) | Manual prompt | No |
| m4b-tool | Dir-structure only | None (batch-pattern) | No | No | No |
| tone | Dir-structure only | None (path-pattern) | No | No | No |
| Audiobookshelf (server) | Manual (one-at-a-time) | Google + OL + Audible + iTunes | N/A (it's the server) | No | No |
| Picard/MusicBrainz | Yes (music) | MusicBrainz only | No | No | No |
| Readarr | Yes (ebook) | Goodreads (retired) | No | No | No |

### Recommendation

`ab-tag-ai` is the most appropriate tool for the stated scenario. Its LLM-based path interpreter is the only existing approach that handles _varying folder structures_ without hardcoded patterns. Potential improvements to consider:

- **Add Audible as a search provider** — its metadata quality is significantly better than Open Library for audiobook-specific fields (narrator, duration, description).
- **Add Google Books as a provider** — could improve coverage for non-English books not in Audible/OL/HC. Google Books already has an audiobook-specific search (`volumeInfo.accessInfo.epub.isAvailable`).
- **Add iTunes as a provider** — ABS already integrates it; could provide cover art.
- **Consider an ASIN-first search path** — if ASIN is in filename or existing tags and verified against cache, skip the LLM path-interpreter call entirely.

---

## 1. Automated Audiobook Tagging Tools

### 1.1 Mp3tag

- **Website:** <https://www.mp3tag.de/en/>
- **Documentation:** <https://docs.mp3tag.de/>
- **Type:** Windows GUI application (also runs under Wine)

**Metadata sources built-in:** Discogs, MusicBrainz, freedb, plus a user-contributed "Web Sources" framework that allows custom web scrapers. Mp3tag ships with tag sources for Discogs, MusicBrainz, and supports user-contributed `.src` files placed in `%appdata%\mp3tag\data\sources`.

**Audiobook-specific:** There is no built-in audiobook tag source. However, the community has created an Audible.com scraper (`Audible.com#Search by Album.src`) by qudo, dano, and Romano — maintained in seanap's repo: <https://github.com/seanap/Audible.com-Search-by-Album>. This script scrapes Audible's website HTML to extract title, author, narrator, series, description, cover URL, ASIN, subtitle, genres, publisher, and year. It supports multiple regions (`us`, `uk`, `de`, `fr`, etc.) with separate `.src` files per region.

**Accuracy model:** Fully manual — the user opens Mp3tag, loads files, hits `Ctrl+Shift+I` to search Audible, reviews results, and manually accepts. No automated matching or verification. This gives the user full control and is effectively 100% accurate when human-verified, but scales poorly.

**Limitations:**
- Windows-only (the Audible scraper script relies on Windows-specific functionality; see <https://github.com/seanap/Plex-Audiobook-Guide/issues/2>)
- Can only process one audiobook at a time
- Requires files to already have ALBUM and ARTIST tags for search to work
- Scrapes HTML, so it breaks when Audible changes their page structure

**Primary source:** <https://github.com/seanap/Audible.com-Search-by-Album> — contains the `.src` files and documents all tags written.

### 1.2 MusicBrainz Picard

- **Website:** <https://picard.musicbrainz.org/>
- **Documentation:** <https://picard-docs.musicbrainz.org/en/>
- **Source:** <https://github.com/metabrainz/picard>

**Audiobook support:** MusicBrainz does have an audiobook entity type in its database. However, audiobook coverage is extremely sparse — most audiobooks are not in MusicBrainz. The MusicBrainz wiki page for audiobooks (<https://wiki.musicbrainz.org/Audiobook>) exists and provides a template for entering audiobook metadata, but the database is community-curated and has far fewer audiobooks than Audible or Google Books.

**Accuracy model:** Picard uses **acoustID** fingerprinting (<https://picard-docs.musicbrainz.org/en/appendices/acoustid.html>) which computes an audio fingerprint from the actual audio signal and matches against the AcoustID database. This can be very accurate for music (fingerprints are independent of metadata), but requires:
1. The audio to have been fingerprinted and submitted to AcoustID
2. The fingerprint to be linked to a MusicBrainz recording
3. That recording to exist in MusicBrainz

For audiobooks, acoustID fingerprinting is **generally not useful** because:
- Spoken-word audiobooks have no meaningful musical features for acoustic fingerprinting
- Most audiobooks have never been submitted to AcoustID
- Fingerprinting a 20-hour audiobook is computationally expensive

Picard also supports filename-to-tag matching and existing tag-based lookup to MusicBrainz.

**Primary source:** <https://picard-docs.musicbrainz.org/en/> — the official documentation confirms Picard is primarily a music tagger; audiobook support is incidental.

### 1.3 beets

- **Website:** <https://beets.io/>
- **Documentation:** <https://beets.readthedocs.io/en/stable/>
- **Source:** <https://github.com/beetbox/beets>

**Audiobook support:** beets itself is music-first. It has no native audiobook support. However, there is a community plugin:

**beets-audible** (<https://github.com/Neurrone/beets-audible>):
- Fetches metadata via the Audnexus API (<https://audnex.us/>)
- Sources: Audible.com data (title, author, narrator, series, description, cover, genres, publisher, ASIN, release date)
- Optional Goodreads lookup for original publication date
- Supports `metadata.yml` files for non-Audible content
- Writes extensive ID3 tags including TXXX frames for series/series-part, ASIN, WOAF (Audible URL), TIT1 for series, TCOM for narrator, etc.
- Writes `desc.txt` and `reader.txt` sidecar files for Booksonic/Audiobookshelf compatibility
- Outputs proper folder structure: `Author/Series/SeriesPosition - Title/`

**Search order** (from the plugin docs):
1. A `metadata.yml` file if present
2. Album and artist tags from file metadata
3. `fromfilename` plugin if tags are missing
4. Folder name as query string
5. ASIN-based direct lookup

**Accuracy model:** beets' interactive CLI prompts the user to confirm or correct each match. The user can enter a different search term, ASIN, or region. Results are scored and presented for review. The `data_source_mismatch_penalty` configuration (default `0.5`) penalizes matches from different sources.

**Limitations:**
- Single provider (Audible/Audnexus only)
- Requires manual interaction for matches
- Chapter-to-file matching can be inaccurate when file count ≠ Audible chapter count
- beets' `move` only moves audio files + cover; `desc.txt` and `reader.txt` are left behind
- Not designed for fully automated/"headless" processing

**Primary source:** <https://github.com/Neurrone/beets-audible/blob/main/readme.md>

### 1.4 m4b-tool

- **Website/source:** <https://github.com/sandreas/m4b-tool> (1.6k stars)
- **Type:** PHP CLI tool wrapping ffmpeg + mp4v2
- **Purpose:** Merge, split, and tag M4B audiobook files

**Metadata capability:**
- **NOT an auto-tagger** — does not search any external metadata source
- Metadata comes exclusively from:
  1. Existing tags on input files
  2. `--batch-pattern` directory structure parsing (using `%a` for artist, `%n` for title, `%s` for series, `%p` for series part, `%g` for genre)
  3. Manual CLI flags (`--name`, `--artist`, `--series`, `--series-part`, etc.)
  4. `cover.jpg` / `description.txt` files found in the source directory
- Can auto-embed local cover art and description files
- Can generate chapters from silence detection with `--max-chapter-length`
- Custom `mp4v2` build supports `sortname`, `sortalbum`, `series`, `series-part` pseudo-tags

**Primary source:** <https://github.com/sandreas/m4b-tool/blob/master/README.md>

### 1.5 tone (m4b-tool successor)

- **Source:** <https://github.com/sandreas/tone> (514 stars)
- **Type:** Single-binary CLI tool written in C# (no dependencies)
- **Purpose:** Dump and modify audio metadata for MP3, M4B, FLAC, etc.

**Metadata capability:**
- Like m4b-tool, does **NOT** search external metadata sources
- Uses `--path-pattern` (similar to m4b-tool's `--batch-pattern`) to extract tags from directory/filename structure
- Supports `--script` with custom JavaScript taggers — can call external APIs (e.g., MusicBrainz) via `tone.Fetch()`
- `--taggers="musicbrainz"` example in docs shows calling MusicBrainz API by release ID
- Supports extensive tag fields including custom fields (Amazon ASIN stored as `----:com.pilabor.tone:AUDIBLE_ASIN`)

**Primary source:** <https://github.com/sandreas/tone/blob/main/README.md>

### 1.6 Other tools

**Libation** (<https://github.com/rmcrackan/Libation>): Audible-specific audiobook manager. Downloads, decrypts, organizes, and tags books from a user's own Audible library. Uses mkb79's `AudibleApi` (<https://github.com/rmcrackan/AudibleApi>) C# library. Not a general-purpose audiobook tagger — it works with books you own on Audible.

**Audible-cli** (<https://github.com/mkb79/audible-cli>): Command-line interface for the `audible` Python library (<https://github.com/mkb79/Audible>, 408 stars). Downloads audiobooks (aax/aaxc), covers, chapters. Direct interface to Audible's internal API — requires registration with Audible device keys. Not a tagger; it's a downloader/backup tool.

**AAXtoMP3** (<https://github.com/KrumpetPirate/AAXtoMP3>): Converts Audible AAX files to MP3/FLAC/M4A/OPUS. Handles DRM removal and conversion but does not tag.

**LibriSync** (<https://github.com/Promises/LibriSync>): Android port of Libation — Audible backup tool.

**OpenAudible** (<https://openaudible.org/>): Cross-platform Audible download manager (freemium/shareware). Downloads, decrypts, converts to MP3/M4B. Bulk operations.

---

## 2. Audiobookshelf Ecosystem

### 2.1 ABS Server Metadata Matching

- **Source:** <https://github.com/advplyr/audiobookshelf> (13.8k stars)
- **Matching announcement:** <https://github.com/advplyr/audiobookshelf/discussions/157> (Oct 2021)

**Natively supported metadata providers** (confirmed via source code):
1. **Google Books** — `server/providers/GoogleBooks.js` — searches by `intitle:` and `inauthor:` via the public Google Books API (<https://www.googleapis.com/books/v1/volumes>). No API key required for basic search. Returns title, author, publisher, published date, description, ISBNs, cover images, categories/genres.
2. **Open Library** — `server/providers/OpenLibrary.js` — searches via `<https://openlibrary.org/search.json?title=...>`, enriches with works data for cover images and first publish date. Returns title, author, published year, cover images, description, works data.
3. **Audible** — `server/providers/Audible.js` — searches via Audible's catalog API (`https://api.audible.{tld}/1.0/catalog/products`) for title+author queries, then enriches each result via the Audnexus API (<https://api.audnex.us/books/{ASIN}>). Returns title, subtitle, author, narrator, publisher, published year, description, cover, ASIN, ISBN, genres, series (with cleaned sequence), language, duration, rating, abridged status. Supports 11 regions.
4. **iTunes** — (referenced in matching UI, provider file at `server/providers/Itunes.js`)

**How matching works:**
- Manual one-at-a-time matching via the ABS web UI
- User selects provider, searches by title/author, reviews results, picks which fields to apply
- Title from folder name takes priority; provider data fills in metadata gaps
- Not designed for automated batch processing

**Custom metadata providers:**
- ABS supports custom metadata providers via the OpenAPI spec at <https://raw.githubusercontent.com/advplyr/audiobookshelf/master/custom-metadata-provider-specification.yaml>
- A custom provider needs only a `/search` endpoint with `query` and optional `author` parameters
- Returns `BookMetadata` schema: title, subtitle, author, narrator, publisher, publishedYear, description, cover, isbn, asin, genres, tags, series, language, duration

**ABS matching discussion #774** — `sandreas` (author of m4b-tool/tone) proposed custom folder pattern matching for library scans using grok patterns: <https://github.com/advplyr/audiobookshelf/discussions/774> (Jun 2022, 42 replies). This would allow ABS to parse `Author/Series/SeriesPart - Title/` from folder structures during scan.

**Primary sources:**
- Google Books provider: <https://github.com/advplyr/audiobookshelf/blob/master/server/providers/GoogleBooks.js>
- Open Library provider: <https://github.com/advplyr/audiobookshelf/blob/master/server/providers/OpenLibrary.js>
- Audible provider: <https://github.com/advplyr/audiobookshelf/blob/master/server/providers/Audible.js>
- Custom provider spec: <https://github.com/advplyr/audiobookshelf/blob/master/custom-metadata-provider-specification.yaml>

### 2.2 Community Pre-processing Tools

**beets-audible (Neurrone)** — discussed in section 1.3. Explicitly designed to produce Audiobookshelf-compatible output. The beets-audible author posted about it in the ABS discussions: <https://github.com/advplyr/audiobookshelf/discussions/411>

**seanap's Plex Audiobook Guide** — <https://github.com/seanap/Plex-Audiobook-Guide> (1.8k stars) — produces folder structures compatible with Booksonic and Audiobookshelf. The workflow is Mp3tag-based and manual.

**rmcrackan's AudiobookHub** — <https://github.com/rmcrackan/AudiobookHub> (695 stars) — a curated list of audiobook management software resources including Audible APIs, backup/decrypt tools, file editors, and players.

### 2.3 The `abs-tagger` Question

No tool named `abs-tagger` exists in the community. The closest equivalents are:
- `ab-tag-ai` (this project)
- beets-audible (produces ABS-compatible output)
- Mp3tag with Audible.com source (manual, but produces ABS-compatible output)

---

## 3. Metadata Sources

### 3.1 Audible / Amazon API

**Official API:** There is no public, documented Audible API. The `api.audible.com` endpoints are internal APIs used by the Audible mobile/web apps. However, they have been reverse-engineered by the community.

**Unofficial wrappers:**

| Library | Language | Stars | Source |
|---------|----------|-------|--------|
| `audible` (mkb79) | Python | 408 | <https://github.com/mkb79/Audible> |
| `AudibleApi` (rmcrackan) | C# | — | <https://github.com/rmcrackan/AudibleApi> |
| Audnexus API | TypeScript (Bun) | 209 | <https://github.com/laxamentumtech/audnexus> |

**`audible` (mkb79):** Full Python interface to the internal Audible API. Supports auth via `ADP_TOKEN` and `PRIVATE_KEY` (requires registering a device — see <https://audible.readthedocs.io/en/latest/auth/register.html>). Provides search, library management, downloads. Pure Python with optional `cryptography`/`pycryptodome` backends for 5-100x faster crypto.

**Audnexus API** (<https://audnex.us>): An aggregation layer that wraps Audible data into a clean REST API. Routes:
- `GET /books/{ASIN}` — returns title, subtitle, authors, narrators, publisher, description, cover, genres, series, language, duration, rating, region
- `GET /authors?name=...` — author search
- `GET /books/{ASIN}/chapters` — requires Audible device keys

Audnexus is built with Fastify, MongoDB, and Redis. It caches data with configurable update intervals (default 30 days). Used by Audiobookshelf's Audible provider, beets-audible, and the Plex Audnexus agent.

**API reference for Audible catalog search** (from ABS source code):
```
https://api.audible.{tld}/1.0/catalog/products?title={title}&author={author}&num_results=10&products_sort_by=Relevance
```
- No API key required
- Returns product results which can then be looked up via Audnexus by ASIN
- Supports 11 regions: us (.com), ca (.ca), uk (.co.uk), au (.com.au), fr (.fr), de (.de), jp (.co.jp), it (.it), in (.in), es (.es)

**Primary sources:**
- <https://github.com/mkb79/Audible>
- <https://github.com/laxamentumtech/audnexus>
- <https://audible.readthedocs.io/en/latest/misc/external_api.html>

### 3.2 Google Books API

- **API reference:** <https://developers.google.com/books/docs/v1/using>
- **Base URL:** `https://www.googleapis.com/books/v1/volumes`
- **Auth:** API key recommended but not strictly required for low-volume queries. Quota: ~864 requests/day without key, higher with key.

**Search capabilities:**
- Full-text search with special keywords: `intitle:`, `inauthor:`, `inpublisher:`, `subject:`, `isbn:`, `lccn:`, `oclc:`
- Filters: `filter=ebooks`, `filter=partial`, `filter=free-ebooks`, `printType=books`, `langRestrict=en`
- Returns: title, subtitle, authors, publisher, publishedDate, description, industryIdentifiers (ISBN-10, ISBN-13), categories/genres, cover images (multiple sizes), language, averageRating, ratingsCount

**Audiobook relevance:** Google Books indexes _books_ (text), not audiobooks specifically. There is no `format=audiobook` filter. However, audiobook editions of most books exist in Google Books and the metadata is identical. The `accessInfo.epub.isAvailable` flag can suggest digital formats but does not distinguish audiobooks. ISBN lookups are particularly useful for matching.

**Primary source:** <https://developers.google.com/books/docs/v1/using> (official Google documentation)

### 3.3 iTunes / Apple Books API

- The iTunes Search API (`https://itunes.apple.com/search`) supports audiobooks via `entity=audiobook`
- Example: `https://itunes.apple.com/search?term=harry+potter&entity=audiobook`
- Returns: trackName (title), artistName (author), collectionName, description, cover URL (multiple sizes), genres, release date
- No authentication required, but rate-limited
- Audiobookshelf integrates iTunes as a provider in `server/providers/Itunes.js`

### 3.4 Open Library

- **API reference:** <https://openlibrary.org/developers/api>
- **Search:** `https://openlibrary.org/search.json?title=...&author=...`
- **Editions/ISBN:** `https://openlibrary.org/isbn/{ISBN}.json` — returns edition data including `source_records` which can contain ASINs
- **Works:** `https://openlibrary.org{worksKey}.json` — returns covers, first_publish_date, description
- **Covers:** `https://covers.openlibrary.org/b/id/{coverId}-L.jpg`
- **Rate limits:** ~1 request/second (enforced in ab-tag-ai as 1.1s inter-call delay)
- **No authentication required**
- **Quality:** Good coverage for popular books; catalog entries often have author/title that are exact matches for filename strings. Open Library is community-edited and varies in quality.

### 3.5 Hardcover

- **Source:** <https://hardcover.app/>
- **API:** GraphQL endpoint; requires `HARDCOVER_API_KEY`
- **Audiobook relevance:** Hardcover provides series name and sequence data that is often more complete than Open Library. Also provides ASINs for Audible editions. Used in ab-tag-ai for series enrichment alongside Open Library's author/title/cover data.
- **Rate limits:** ~60 requests/minute

### 3.6 ISBNdb, Goodreads (unofficial)

**Goodreads:** No public API since 2020 (deprecated by Amazon). The beets-audible plugin uses a Goodreads API key with `goodreads_apikey` config for original publication date lookup, but Goodreads API keys are no longer issued. Unofficial scraping is the only current method.

**ISBNdb:** Commercial API (<https://isbndb.com/>) with paid plans starting at $9.95/month. Can look up books by ISBN and return title, author, publisher, etc. No significant community tools use it for audiobook tagging.

---

## 4. How People Solve This in Practice

### 4.1 seanap's Plex Audiobook Guide (1.8k stars)

The canonical community guide for audiobook organization: <https://github.com/seanap/Plex-Audiobook-Guide>

**Workflow:**
1. Copy untagged files to a `temp/` directory (Dropit on Windows, cron+script on Linux)
2. Optionally convert MP3s to chapterized M4B using m4b-tool
3. Open Mp3tag, set track numbers, search Audible via custom web source
4. Run custom Action that renames files, creates folder structure, exports cover/desc/reader files
5. Plex picks up the library via Audnexus.bundle agent

**Key insight from the community:** This workflow is manual but gives full control. The Audible.com scraper script writes 20+ tags to each file, far more than any automated tool.

**The guide recommended a pipeline:**

```
Original → Copy to temp → Mp3tag (Audible source) → Properly tagged & organized → Plex/Audiobookshelf
```

### 4.2 beets-audible Docker Workflow

The recommended setup per the beets-audible README (<https://github.com/Neurrone/beets-audible>):

```yaml
services:
  beets:
    image: lscr.io/linuxserver/beets:2.12.0-ls337
    volumes:
      - /path/to/audiobooks:/audiobooks
      - /path/to/import/books/from:/input
```

Config disables MusicBrainz and uses only the `audible` plugin. Import is interactive: `beet import /input`.

### 4.3 Audiobookshelf Discussions

From the ABS GitHub discussions (<https://github.com/advplyr/audiobookshelf/discussions>), common tagging strategies include:

- Using `beets-audible` to pre-tag files, then importing to ABS via folder scan (discussion #411)
- Requesting Audible metadata integration in ABS matching (discussion #157 — later implemented)
- Custom folder pattern proposals for library scan to extract title/author/series from paths without file tags (discussion #774 by sandreas)
- Manual matching via the ABS web UI using the built-in Google/OL/Audible providers

### 4.4 Readarr (Retired)

- **Source:** <https://github.com/Readarr/Readarr> (archived Jun 2025, 3.5k stars)
- **Status:** RETIRED. Announcement: <https://github.com/Readarr/Readarr#announcement-retirement-of-readarr>
- **Reason:** "The project's metadata has become unusable." Relied on Goodreads metadata which became unavailable.
- **Attempted transition to Open Library** stalled. Community mirror: `rreading-glasses` (<https://github.com/blampe/rreading-glasses>)
- **Audiobook support:** Readarr supported both ebooks and audiobooks, but was primarily an ebook manager. Metadata quality was uneven.

### 4.5 Docker / Compose Pipelines

Common patterns seen in the community:

1. **Libation → beets-audible → Audiobookshelf:** Libation backs up Audible purchases with full metadata; beets-audible organizes them; ABS serves them.
2. **Mp3tag (manual) → Audiobookshelf:** Files are manually tagged once, then scanned by ABS.
3. **m4b-tool merge → Audiobookshelf:** MP3 collections merged to single M4B files with proper chapter markers, then ABS scans.

---

## 5. Correctness vs. Coverage Tradeoffs

### 5.1 Manual Review Workflows

| Tool | Review Mechanism |
|------|-----------------|
| ab-tag-ai | `flag_for_review` tool writes JSON to `output/review/`; LLM can flag at any phase; deterministic fuzzy-match gate rejects ambiguous results |
| Mp3tag + Audible src | User manually reviews every search result before applying tags |
| beets + beets-audible | Interactive CLI prompt; user confirms each match or enters ASIN manually |
| Audiobookshelf matching | Manual one-at-a-time in web UI; user selects provider and chooses fields |
| Picard/MusicBrainz | Shows match candidates with confidence scores; user confirms or overrides |

### 5.2 Uncertainty Flagging

- **ab-tag-ai:** Explicit `flag_for_review` tool available to the LLM in both Path Interpreter and Verifier phases. Books flagged for review are written as JSON files to `output/review/` directory. The fuzzy-match gate in deterministic search automatically routes ambiguous results to the verifier.
- **beets:** When no match is found, beets prompts the user to enter a different search term or ASIN. The `data_source_mismatch_penalty` config penalizes cross-source matches.
- **Audiobookshelf:** No automatic flagging — the user must notice mismatches and manually use the match/override UI.
- **Others:** Most tools either match or fail silently; none have a structured review queue.

### 5.3 AcoustID vs. Filename/Path Matching

**AcoustID fingerprinting** (used by MusicBrainz Picard):
- **Accuracy:** Very high for music when the audio matches a known recording in the database (95%+ for popular music)
- **Audio requirement:** Must process the actual audio signal (reads entire file)
- **Audiobook limitation:** Spoken-word content produces poor fingerprints. The fingerprinting algorithm (Chromaprint) is designed for musical features (chroma, spectral patterns), not speech. Two different audiobook recordings of the same book will produce completely different fingerprints.
- **Coverage:** Near-zero for audiobooks. The AcoustID database contains almost no audiobook fingerprints.

**Filename/path-based matching** (used by most audiobook tools):
- **Accuracy:** Depends on filename quality. Well-named files (e.g., `Harry Potter and the Philosopher's Stone.mp3`) match correctly with fuzzy string comparison. Poorly named files (e.g., `cd01_track01.mp3`) are unsolvable without external context.
- **Path-based (ab-tag-ai LLM):** The LLM interprets arbitrary path structures, which is strictly more capable than regex-based filename parsing. The LLM can handle cases like `Author/Series/BookTitle/Files` vs `Author/BookTitle` vs `Author - Series - BookTitle` without hardcoded patterns.
- **Path-based (m4b-tool/tone):** Uses hardcoded grok patterns (`%g/%a/%s/%p - %n/`). Requires the directory structure to match one of the configured patterns. Fast and predictable but brittle with non-standard structures.

### 5.4 Multi-provider vs. Single-provider Matching

**ab-tag-ai** uses three providers:
- Open Library → author, title, ASIN (via editions), cover ID
- Hardcover → series name, sequence, ASIN
- Audnexus → narrator, cover URL, duration (enrichment only, after ASIN confirmed)

This multi-provider merge gives richer metadata than any single provider. The parallel search with fuzzy-match gate means the tool won't accept a match unless the author and title agree across providers.

**beets-audible** uses only Audible/Audnexus. This gives the richest audiobook-specific metadata (narrator, description, duration, explicit ASIN) but cannot match books not on Audible.

**Audiobookshelf** allows switching between Google Books, Open Library, and Audible but does not merge results — the user picks one.

---

## Appendix: Key Repository References

| Repository | URL | Stars | Status |
|-----------|-----|-------|--------|
| audiobookshelf | <https://github.com/advplyr/audiobookshelf> | 13.8k | Active |
| m4b-tool | <https://github.com/sandreas/m4b-tool> | 1.6k | Maintenance |
| tone | <https://github.com/sandreas/tone> | 514 | Active (successor) |
| Audible.py | <https://github.com/mkb79/Audible> | 408 | Active |
| audnexus | <https://github.com/laxamentumtech/audnexus> | 209 | Active |
| beets-audible | <https://github.com/Neurrone/beets-audible> | 193 | Active |
| Audible.com-Search-by-Album | <https://github.com/seanap/Audible.com-Search-by-Album> | 118 | Maintenance |
| Plex-Audiobook-Guide | <https://github.com/seanap/Plex-Audiobook-Guide> | 1.8k | Maintenance |
| Audnexus.bundle | <https://github.com/djdembeck/Audnexus.bundle> | 649 | Active |
| AudiobookHub | <https://github.com/rmcrackan/AudiobookHub> | 695 | Active |
| Readarr | <https://github.com/Readarr/Readarr> | 3.5k | **Retired (Jun 2025)** |
| Libation | <https://github.com/rmcrackan/Libation> | — | Active |
| audible-cli | <https://github.com/mkb79/audible-cli> | — | Active |
