## Destination

An AI agent tool that scans audiobook directories, uses an LLM orchestrator to determine correct metadata (via Audnexus + Open Library + Hardcover APIs), writes correct ID3 tags, downloads cover art (fallback if none exists), restructures into Audiobookshelf-compatible folders (`Author/Series/Book/` or `Author/Book/`), copies to a separate output directory, and supports dry-run preview mode.

## Notes

- Domain: audiobook metadata, ID3 tagging, LLM tool-use agents
- Skills: /grilling (for HITL decisions), /research (for AFK investigations)
- Tech stack: Node.js, LLM API-based (opencode zen license)
- Online providers: Audnexus (primary for ASIN-based enrichment), Open Library (primary search + ASIN source), Hardcover (fuzzy search + series + ratings)
- Cover art: use existing .jpg/.png if present, download from provider otherwise
- Multi-file mp3 books: leave as separate files, tag individually (same album/title, track numbers for ordering)
- Existing sidecar files: preserve useful ones (.nfo, .cue, .json, synopsis files), discard junk (.txt support messages, desktop.ini, Icon.ico)
- Dry-run mode: required before any modification
- Output: copy to separate directory (originals untouched)
- Folder structure: Author/Series/Book/ for series books, Author/Book/ for standalones

## Decisions so far

- [Audnexus API Research](tickets/001-audnexus-api-research.md) — No book search by title exists; only ASIN-based lookup. Series data missing from public API. 100 req/min, free, no auth.
- [Open Library API Research](tickets/002-open-library-api-research.md) — Free, no auth, robust title+author search. Returns ASINs, series info, covers. No native audiobook-specific fields (narrator, duration). Rate limits: 1 req/s default.
- [Hardcover API Research](tickets/003-hardcover-api-research.md) — GraphQL API with free Bearer token. Fuzzy book search, full series support, audio_seconds for duration matching. Rate limit 60 req/min.
- [Audio Tagging Libraries](tickets/004-audio-tagging-libraries.md) — node-id3 for MP3 (reads/writes ID3v2 including custom TXXX for series/series-part + APIC cover art). ffmpeg for M4B (ffprobe read, -metadata write). This covers both formats in the library.
- [Agent Architecture Grilling](tickets/005-agent-architecture-grilling.md) — 9 tools defined (read_audio_metadata, search_open_library, search_audnexus, search_hardcover, write_id3_tags, write_ffmetadata, download_cover_art, move_file, dry_run_preview). LLM role = verifier (not orchestrator): procedural code calls most tools; LLM verifies each candidate and returns `{verdict: trust|flag|retry, reason, retryHint?}`. Per-book sequential pipeline with one LLM verification call per candidate (up to 2). Provider fallback chain (Audnexus → Open Library → Hardcover) feeds candidates sequentially; max 1 retry then flag for review. Config file + CLI flags. TypeScript project structure.
- [ASIN Acquisition](tickets/006-asin-acquisition.md) — Open Library first, Hardcover fallback. Verify existing ASINs. File-based cache at `.wayfinder/cache/asin.json`. Flag for manual review if no ASIN found.
- [Multi-file MP3 Tagging](tickets/007-mp3-multi-file-tagging.md) — Directory-based set detection, shared album + per-file titles, alphabetical track numbering, full tags written to all files including series TXXX fields.
- [Cover Art](tickets/008-cover-art.md) — Resized to 500x500 via sharp, named cover.jpg, skip silently if unavailable, fetched during metadata discovery (ASIN-independent).
- [Hardcover API Key](tickets/009-hardcover-api-key.md) — Requirement acceptable (free, easy sign-up). Layered input: config file default, env var secrets layer, CLI flag for one-off overrides.
- [Foreign Language Books](tickets/010-foreign-language-books.md) — Preserve non-ASCII filenames as-is. Open Library and Hardcover handle Polish/Norwegian/Spanish natively; Audnexus limited (ASIN-only, no pl/no region). Pass Unicode titles through verbatim to providers.
- [Performance/Concurrency](tickets/011-performance-concurrency.md) — Auto-respect provider rate limits with inter-call delays. Fully sequential (no I/O overlap). Progress logging for large libraries. Checkpoint+resume deferred.
- [Filename Title Detection](tickets/012-filename-title-detection.md) — Directory name primary, filename pattern stripping fallback. Author always available from folder path. No provider results → flag for manual review immediately.

## Not yet specified

<!-- work ruled beyond the destination -->

## Out of scope

<!-- work ruled beyond the destination -->
