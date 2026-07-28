# ab-tag-ai

Audiobook metadata tagger and organizer for [Audiobookshelf](https://www.audiobookshelf.org).

[![npm](https://img.shields.io/badge/node-%3E%3D22-blue)](#)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#)

`ab-tag-ai` scans an unstructured directory of audiobook files, resolves metadata from multiple book APIs, writes proper ID3v2/ffmpeg tags, downloads cover art, and copies the result into an organized output tree — or uploads it directly to an Audiobookshelf server.

---

## Features

- **Two output modes** — restructure to an `Author/Series/Book/` filesystem tree, or upload in-place to an Audiobookshelf instance.
- **Multi-provider metadata resolution** — Open Library (search + ISBN/ASIN), Audnexus (ASIN-based enrichment with narrator + cover), Hardcover (fuzzy search with series support).
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
Usage: audiobook-organizer [options]

Options:
  -c, --config <path>        Config file path (default: config.yaml)
  -i, --input <path>         Input directory
  -o, --output <path>        Output directory
  --hardcover-key <key>      Hardcover API key
  --llm-key <key>            LLM API key
  --llm-base-url <url>       LLM API base URL
  --concurrency <n>          Books to process in parallel (default: 4)
  --include <patterns>       Comma-separated author/pattern filters
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
2. Uploads files as a multipart form, triggers a library scan.
3. Polls until the item appears in search results.
4. Uploads cover art, patches metadata (ASIN, series), matches to Audible provider.

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
             │   Orchestrator  │  Per-book LLM loop (tool-calling)
             └──────┬──────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
   Open Library  Audnexus  Hardcover
   (search +     (ASIN      (fuzzy
    ISBN/ASIN)    enrich)    search)
         │          │          │
         ▼──────────▼──────────▼
               Metadata
               ┌─────┴─────┐
               ▼           ▼
          LLM Verify   Skip/Flag
               │
               ▼
     ┌─────────────────┐
     │  Tag & Copy     │  Write ID3/ffmpeg, embed cover
     └────────┬────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
  Local tree     Audiobookshelf
  (filesystem)     (upload API)
```

### Provider fallback chain

Audnexus → Open Library → Hardcover. Rate limits are respected with inter-call delays (1.1s Open Library, 1s Hardcover, 0.6s Audnexus).

### LLM as verifier

Procedural code drives the pipeline. The LLM receives tool access (`search_open_library`, `search_hardcover`, `fetch_audnexus`, `write_output`, `flag_for_review`) and returns a verdict per book. Max 1 retry per book, then auto-flag.

---

## Project structure

```
src/
  index.ts              CLI entry (commander), config load + merge
  agent.ts              Sequential per-book orchestration loop
  orchestrator.ts       LLM tool-calling loop with ABS upload flow
  scanner.ts            Input walker, audio detection, multi-file grouping
  config.ts             YAML loader, CLI override merge, validation
  types.ts              Shared interfaces
  utils.ts              Path helpers, sidecar classification, file copy
  inference.ts          Book identity inference from paths and tags
  providers/
    abs-client.ts       Audiobookshelf REST client
    asin.ts             ASIN validation + cache (.wayfinder/cache/asin.json)
    audnexus.ts         Audnexus API client
    cover-art.ts        Cover download, resize (sharp), local lookup
    hardcover.ts        Hardcover GraphQL client
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

## Tech stack

| Area | Choice |
|------|--------|
| Runtime | Node.js 22, TypeScript (strict, ESM, ES2022) |
| CLI | commander |
| Config | js-yaml |
| ID3 tags | node-id3 |
| M4B metadata | ffmpeg |
| Cover art | sharp |
| Testing | vitest |
| Linting | ESLint + @typescript-eslint |
| Container | Docker (Alpine, multi-stage) |
