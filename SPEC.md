## Problem Statement

Audiobook collections lose metadata over time — ID3 tags become outdated or missing, cover art doesn't match, and files aren't organized in a way Audiobookshelf or other players can browse cleanly. Manual tagging is error-prone and doesn't scale across 2000+ files. There's no automated tool that can scan an unstructured audiobook directory, resolve correct metadata via multiple book APIs, write proper ID3/M4B tags, download cover art, and restructure everything into an Audiobookshelf-compatible layout without touching the originals.

## Solution

A Node.js/TypeScript CLI tool that scans an input directory, resolves metadata for each audiobook via Open Library (primary search + ASIN source), Audnexus (ASIN-based enrichment), and Hardcover (fuzzy search + series support), writes ID3v2 tags for MP3s and ffmpeg metadata for M4Bs, downloads cover art resized to 500×500, and copies the result to an output directory in `Author/Series/Book/` or `Author/Book/` folder structure. A dry-run mode previews all changes before any modification.

## User Stories

1. As a user, I want to point the tool at a directory of audiobook files so that it can scan and process them automatically.
2. As a user, I want the tool to detect when an MP3 file has no metadata (title, author, etc.) and try to infer it from the filename before searching providers.
3. As a user, I want the tool to search Open Library first for metadata, falling back to Hardcover and Audnexus, so that the best possible match is found.
4. As a user, I want the tool to verify existing ASINs in file metadata rather than trusting them blindly.
5. As a user, I want the tool to cache ASINs it finds so it doesn't re-lookup the same book on repeated runs.
6. As a user, I want the tool to flag a book for manual review when no provider can determine its metadata, rather than guessing or failing silently.
7. As a user with a multi-file audiobook (e.g., one book split across 10 MP3 files), I want all files to share the same album title but have individual chapter titles and sequential track numbers.
8. As a user with an M4B file, I want the tool to read and write its metadata correctly.
9. As a user, I want the tool to copy (not move) files to the output directory so the originals remain untouched.
10. As a user, I want the tool to preserve useful sidecar files (.nfo, .cue, .json, synopsis files) and discard junk (.txt support messages, desktop.ini, Icon.ico).
11. As a user, I want the tool to download cover art from providers, resize it to 500×500, and embed it as APIC in ID3 tags or as a cover file.
12. As a user, I want the tool to handle non-ASCII characters (Polish Ł, Norwegian Ø, Spanish accents) in titles, authors, and filenames without mangling them.
13. As a user, I want to run the tool in dry-run mode first to see what changes will be made without writing anything.
14. As a user, I want to configure the tool via a YAML config file for input path, output path, Hardcover API key, and LLM model selection.
15. As a user, I want to override any config setting via CLI flags for quick one-off runs.
16. As a user, I want the tool to respect provider rate limits automatically (Open Library 1 req/s, Hardcover 60 req/min, Audnexus 100 req/min) with small inter-call delays.
17. As a user, I want the tool to display progress logging so I can monitor a large library processing run.
18. As a user with a series of books (e.g., The Trials of Apollo), I want the tool to detect the series and series-part numbers and write them as TXXX custom ID3 frames.
19. As a user, I want existing cover art in the source files to be preserved rather than unnecessarily re-downloaded.
20. As a user, I want the tool to handle foreign-language books (Polish, Norwegian, Spanish) where the author names and titles contain characters outside the ASCII range.

## Implementation Decisions

- **Runtime**: Node.js/TypeScript; `package.json` with TypeScript compiler and ts-node or a build step to `dist/`
- **Project structure**: `src/index.ts` (CLI entry), `src/agent.ts` (orchestrator, per-book sequential loop), `src/providers/` (search provider implementations), `src/taggers/` (metadata writers per format), `src/utils.ts` (shared helpers), `src/config.ts` (config loading + merge)
- **CLI interface**: config file (`config.yaml.example`) for defaults, CLI flags override config values
- **Config format**: YAML; required keys: `input`, `output`, `hardcover_api_key`; optional keys: `dry_run`, `llm_model`, `log_level`
- **Control flow**: per-book sequential — scan input directory, find all audio files, resolve metadata, LLM verifies each candidate (verdict: trust/flag/retry, max 1 retry), write tags, copy to output, then move to next book
- **Tool set** (9 tools): `read_audio_metadata`, `search_open_library`, `search_audnexus`, `search_hardcover`, `write_id3_tags`, `write_ffmetadata`, `download_cover_art`, `move_file`, `dry_run_preview`
- **LLM role**: verifier, not orchestrator — procedural code calls most tools directly; the LLM performs the per-book verification pass (the manual check the user currently does by hand), returning `{ verdict: "trust"|"flag"|"retry", reason, retryHint? }`. Direct LLM tool use: `flag_for_review`, `retry_provider`. Max 1 retry per book, then auto-flag.
- **ASIN acquisition**: Open Library editions/isbn first, Hardcover editions.asin fallback, filename patterns third, Audible URLs fourth; validate 10-char alphanumeric before passing to providers; file-based cache at `.wayfinder/cache/asin.json`; always verify existing ASINs; defer writing ASINs to the full tagging pass
- **Multi-file MP3 handling**: directory-based set detection (primary), filename prefix matching (secondary); shared album, per-file titles, alphabetical track numbering; all files get full tag set including series TXXX fields
- **Cover art**: download during metadata discovery (ASIN-independent); resize to 500×500 via `sharp`; file named `cover.jpg`; skip silently if no cover art is available from providers
- **Error handling**: provider fallback chain (Audnexus → Open Library → Hardcover); if all providers fail, flag the book for manual review in a `review/` directory
- **API key management**: layered approach — config file default, `HARDCOVER_API_KEY` env var override, `--hardcover-key` CLI flag for one-off overrides
- **Non-ASCII handling**: preserve filenames as-is (UTF-8 native on modern Linux); pass Unicode titles/author names verbatim to providers
- **Rate limiting**: auto-respect provider limits with inter-call delays (1.1s for Open Library, ~1s for Hardcover, ~0.6s for Audnexus)
- **Audio formats**: node-id3 for MP3 (ID3v2 with TXXX custom frames for series/series-part + APIC cover art); ffmpeg for M4B (ffprobe read, `-metadata` write)
- **Cover art I/O**: use existing .jpg/.png if present in the source; download from provider otherwise; embed in ID3 tags via APIC frame