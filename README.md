# audiobook-metadata-ai

Audiobook metadata tagger and organizer for [Audiobookshelf](https://www.audiobookshelf.org).

[![npm](https://img.shields.io/badge/node-%3E%3D22-blue)](#)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

`audiobook-metadata-ai` scans an unstructured directory of audiobook files, resolves metadata from multiple book APIs, writes proper ID3v2/ffmpeg tags, downloads cover art, and copies the result into an organized output tree — or uploads it directly to an Audiobookshelf server.

---

## Features

- **Two output modes** — restructure to an `Author/Series/Book/` filesystem tree, or upload in-place to an Audiobookshelf instance.
- **Multi-provider metadata resolution** — Audible (ASIN catalog search), Audnexus (narrator + cover), Open Library (ISBN/ASIN), Hardcover (series data), Lubimyczytac (Polish-language scraper).
- **Language-based provider routing** — LLM detects book language from path structure; Spanish books routed to audible.es, Polish books to Lubimyczytac.
- **LLM-verified pipeline** — an LLM acts as verifier between metadata discovery and write, returning `trust` / `flag` / `retry` judgments.
- **Multi-file book detection** — groups files by directory and filename stems, assigns sequential track numbers.
- **Cover art handling** — downloads from providers, resizes to 500×500 via `sharp`, embeds as APIC in ID3 tags, preserves existing covers.
- **Duplicate prevention** — checks for existing ASINs and matching title+author before uploading to Audiobookshelf.
- **Fallback to local** — when the ABS upload fails (network, auth, server error), the tool falls back to local filesystem output.
- **Sidecar preservation** — keeps `.nfo`, `.cue`, `.json`, and synopsis files; discards junk.
- **Dry-run mode** — preview all changes before writing.
- **Docker image** — ready-to-run container with multi-stage build.

---

## Quick start

```bash
npm install
npm run build

# Run against a directory
npm run dev -- -c config.yaml

# Preview only
npm run dev -- -c config.yaml --dry-run
```

### Docker

```bash
docker compose up organize
# or just preview:
docker compose --profile check up dry-run
```

---

## Configuration

Configuration is resolved from three sources (later overrides earlier):

1. **YAML config file** (default: `config.yaml`)
2. **Environment variables** (`HARDCOVER_API_KEY`, `LLM_API_KEY`, `LLM_API_BASE_URL`, `ABS_API_TOKEN`)
3. **CLI flags**

### Example config

```yaml
input: /path/to/audiobooks
output: /path/to/output
hardcover_api_key: ""
dry_run: false
llm_model: "deepseek-v4-flash-free"
llm_api_key: ""
llm_api_base_url: "https://opencode.ai/zen/v1"
concurrency: 4
include:
  # - "Peters, Elizabeth"
  # - "Riordan, Rick"
log_level: info
output_mode: local           # "local" or "audiobookshelf"
abs_url: ""
abs_api_token: ""
abs_library_id: ""
```

### CLI reference

```
Usage: abmeta [options]

Options:
  -c, --config <path>        Config file path (default: config.yaml)
  -i, --input <path>         Input directory
  -o, --output <path>        Output directory
  --hardcover-key <key>      Hardcover API key
  --llm-key <key>            LLM API key
  --llm-base-url <url>       LLM API base URL
  --concurrency <n>          Books to process in parallel (default: 4)
  --include                  Interactively select folders to process
  --dry-run                  Preview without writing
  --log-level <level>        debug | info | warn | error
  --abs-url <url>            Audiobookshelf server URL
  --abs-token <token>        Audiobookshelf API token
  --abs-library-id <id>      Audiobookshelf library ID
  -V, --version              Output version
  -h, --help                 Display help
```

---

## Output modes

### Local mode (default)

Restructures files into `Author/Series/Book/` or `Author/Book/` hierarchy, writes tagged copies, and preserves sidecar files. Originals remain untouched.

```
output/
  Author Name/
    Series Name/
      Book Title/
        cover.jpg
        01 - Chapter One.mp3
        02 - Chapter Two.mp3
```

### Audiobookshelf mode

Uploads tagged files to an Audiobookshelf server via its API:

1. Searches the library for duplicates by ASIN and title+author.
2. Uploads files as a multipart form with title, author, and series metadata.
3. Triggers a library scan, then looks up the item by title to get its ID.
4. Patches full metadata (narrator, description, publisher, genres, ASIN, ISBN, cover), uploads cover art.

> **Note:** When upload fails after retries (network error, server down, auth failure), the tool falls back to local output with a logged reason.

---

## Architecture

```
                 ┌─────────────┐
                 │   Scanner   │  Walk input, detect multi-file books
                 └──────┬──────┘
                        │ BookSet
                        ▼
              ┌─────────────────┐
              │  Path Interpreter│  LLM: title, author, language
              └──────┬──────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │   Deterministic Search     │  Parallel provider search
        └────────────┬───────────────┘
                     │
         ┌───────────┼───────────┬──────────────┐
         ▼           ▼           ▼              ▼
      Audible   Open Library  Hardcover   Lubimyczytac
      (catalog)  (ISBN/ASIN)  (series)     (PL scraper)
         │           │           │              │
         └───────────┴───────────┴──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │ Fuzzy Match   │  Match resolved title/author
              └──────┬───────┘
                     │
              ┌──────┴──────┐
              ▼              ▼
          Match OK       Fallthrough
              │              │
              ▼              ▼
      ┌───────────┐  ┌────────────┐
      │ Write     │  │  Verifier   │  LLM: resolve ambiguity
      │ Output    │  └─────┬──────┘
      └─────┬─────┘        │
            │       ┌──────┴──────┐
            │       ▼              ▼
            │   Write Output   Flag for
            │                  Review
            ▼
     ┌─────────────┐
     │  Tag & Write │  ID3/ffmpeg tags, cover art
     └──────┬──────┘
            │
     ┌──────┴──────┐
     ▼              ▼
  Local tree   Audiobookshelf
  (filesystem)  (upload API)
```

### Provider chain

Audible (primary, ASIN + full metadata) → Open Library (ISBN/ASIN fallback) → Hardcover (series data) → Audnexus (ASIN enrichment). Polish-language books route to Lubimyczytac (cheerio scraper) instead of Audible. Language is auto-detected by the LLM during path interpretation.

### LLM in the pipeline

Two LLM phases: (1) **Path Interpreter** — determines title, author, and language from the directory structure. (2) **Verifier** — resolves ambiguous provider matches that fail fuzzy-matching. Most books skip the verifier entirely.

---

## Project structure

```
src/
  index.ts              CLI entry (commander), config load + merge
  agent.ts              Sequential per-book orchestration loop
  orchestrator.ts       Output writer: tags files, dispatches to local or ABS mode
  scanner.ts            Input walker, audio detection, multi-file grouping
  config.ts             YAML loader, CLI override merge, validation
  types.ts              Shared interfaces
  utils.ts              Path helpers, sidecar classification, file copy
  inference.ts          Book identity inference from paths and tags
  providers/
    abs-client.ts       Audiobookshelf REST client
    abs-upload.ts       ABS upload saga (dedup, upload, scan, PATCH, cover, verify)
    asin.ts             ASIN validation + cache (.wayfinder/cache/asin.json)
    audible.ts          Audible catalog search (api.audible.{region})
    audnexus.ts         Audnexus API client (ASIN-based enrichment)
    cover-art.ts        Cover download, resize (sharp), local lookup
    hardcover.ts        Hardcover GraphQL client
    lubimyczytac.ts     Lubimyczytac.pl scraper (Polish-language books, cheerio)
    metadata-resolver.ts
    open-library.ts     Open Library search + editions
  taggers/
    index.ts            ID3v2 writer (node-id3), ffmpeg (M4B), cover embed
tests/
    *.test.ts            Unit tests (vitest)
    e2e/                 Docker-based end-to-end tests
```

---

## Development

```bash
# Build
npm run build

# Type-check
npm run typecheck

# Lint
npm run lint

# Unit tests
npm test

# E2E tests (requires Docker)
npm run test:e2e
```

### E2E tests

The E2E suite spins up an ephemeral Audiobookshelf container via `ghcr.io/advplyr/audiobookshelf:latest`, provisions a root user and library, runs the full upload pipeline, and tears down the container.

```bash
npm run test:e2e
```

Tests run sequentially: upload → metadata verification → duplicate skip → real-book upload → fallback on container kill.

---

## Roadmap

- **Web UI mode** — interactive folder selection served from the Docker container on a port, bringing the CLI picker experience to headless deployments.

## Tech stack

| Area | Choice |
|------|--------|
| Runtime | Node.js 22, TypeScript (strict, ESM, ES2022) |
| CLI | commander |
| Config | js-yaml |
| ID3 tags | node-id3 |
| M4B metadata | ffmpeg |
| Cover art | sharp |
| HTML scraping | cheerio |
| Testing | vitest |
| Linting | ESLint + @typescript-eslint |
| Container | Docker (Alpine, multi-stage) |
