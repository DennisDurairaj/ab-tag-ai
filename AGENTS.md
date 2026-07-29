# AGENTS.md

## Commands

```bash
npm run build          # tsc -> dist/
npm run dev -- -c config.yaml     # tsx runner, no build needed
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/
npm test               # vitest run (unit tests, excludes tests/e2e/)
npm run test:e2e       # vitest run --config vitest.e2e.config.ts (requires Docker)
```

Run `typecheck` after codegen or structural changes. The `lint` script only checks `src/`.

## Architecture

This is a TypeScript ESM CLI (`"type": "module"`) that scans audiobook files, resolves metadata from book APIs, writes ID3v2/ffmpeg tags, and outputs to a local tree or an Audiobookshelf server.

### Processing pipeline (per book, sequential phases)

1. **Pre-processing** — find local cover art, extract weak tag signals
2. **Path Interpreter** (1 LLM call) — LLM tools: `set_title_author` / `flag_for_review`. Parses `Author/Series/Book/` paths. No search tools.
3. **Deterministic Search** (no LLM) — checks ASIN cache, searches OL + HC in parallel, merges results, fuzzy-matches against inferred title/author. If matched → writes output directly (no LLM).
4. **Verifier Fallback** (1 LLM call, only when fuzzy match can't decide) — LLM tools: `write_output` / `flag_for_review`. Resolves ambiguous provider results.

**Key insight**: The LLM is a verifier, not an orchestrator. Most books need only the single path-interpreter call. See `specs/002-reduce-llm-calls.md`.

### Entrypoints

- `src/index.ts` — CLI (commander), config load + merge, launches `processLibrary`
- `src/agent.ts` — `processLibrary()`: orchestrates scanning, grouping, per-book pipeline
- `src/path-interpreter.ts` — Phase 2: LLM tool-calling loop for path interpretation
- `src/deterministic-search.ts` — Phase 3: parallel OL+HC search, ASIN cache, fuzzy match gate
- `src/verifier.ts` — Phase 4: LLM verifier fallback
- `src/orchestrator.ts` — `writeOutputForBook()` and `executeAbsUpload()` (shared by all phases)

### Providers

- `src/providers/audnexus.ts` — Audnexus API (ASIN-based enrichment: narrator, cover, duration)
- `src/providers/open-library.ts` — Open Library search + editions (ASIN and cover ID)
- `src/providers/hardcover.ts` — Hardcover GraphQL (ASIN + series data)
- `src/providers/abs-client.ts` — Audiobookshelf REST client (upload, search, match, cover)
- `src/providers/asin.ts` — ASIN validation, caching, filename/URL extraction

### Output modes

- **local** — `Author/Series/Book/` or `Author/Book/` directory tree
- **audiobookshelf** — uploads to ABS server; falls back to local on failure

## Config resolution order

YAML file → env vars (`HARDCOVER_API_KEY`, `LLM_API_KEY`, `LLM_API_BASE_URL`, `ABS_API_TOKEN`) → CLI flags

## Testing

- Unit tests: `npm test` — excludes `tests/e2e/`, can run single file with `npx vitest run tests/utils.test.ts`
- E2E tests: `npm run test:e2e` — spins up an ephemeral Audiobookshelf Docker container, provisions user + library, runs full upload pipeline, tears down. Requires Docker. 300s timeouts.
- Provider tests mock `fetchFn` — the `fetchFn` parameter is the injection point for all HTTP calls (LLM, providers, ABS).

## Gotchas

- **ESM imports require `.js` extensions**: `import { foo } from "./bar.js"` — even in `.ts` files. Use `node:` prefix for built-ins.
- **`tsconfig.json` enforces `noUnusedLocals` and `noUnusedParameters`** — unused vars/params will fail `typecheck`.
- **`config.yaml` contains real secrets** (API keys, JWTs) — never commit this file. Don't propagate secrets from it into code or docs.
- **ASIN cache must be explicitly saved**: `asinCache.save()` is called once at the end of `processLibrary()`. Sets within the run persist in memory but won't hit disk without `save()`.
- **`ffprobe-static` is a runtime dependency** for M4B scanning — the scanner tries to `require("ffprobe-static")` or falls back to `ffprobe` on PATH.
- **`ffmpeg` must be on PATH** for M4B metadata writing — the tagger calls `execFileSync("ffmpeg", ...)`.
- **`sharp` needs native build deps** — Docker builder stage installs `python3 make g++`.
- **Concurrency uses 500ms staggered start delays** — each book starts 500ms after the previous to avoid thundering-herd on providers/LLM.
- **ABS mode validates extra config fields**: `abs_url`, `abs_api_token`, `abs_library_id` are required when `output_mode` is `audiobookshelf`.
- **Sidecar files**: `.nfo`, `.cue`, `.json`, and files with "synopsis" in name are preserved; `.txt`, `desktop.ini`, `Icon.ico` are discarded.
- **Cover art**: local JPG/PNG from source dir is preferred; provider covers are downloaded and resized to 500×500 via sharp.
- **Multi-file detection**: groups files by directory first, then by filename stem (stripping trailing numbers/chapter patterns). Single files in their own directory are treated as standalone books.
- **Flagged books** are written as JSON files to `output/review/`.

### Important: two vitest configs

- `vitest.config.ts` — includes `tests/**/*.test.ts`, excludes `tests/e2e/**`
- `vitest.e2e.config.ts` — includes `tests/e2e/**/*.test.ts`, 300s timeouts, verbose reporter
- Run the right one. `npm test` uses the first; `npm run test:e2e` uses the second.

## CI

On push to `main`, `.github/workflows/build.yml` builds the Docker image and pushes to `ghcr.io/dennisdurairaj/ab-tag-ai:latest`. No typecheck or test step in CI.

## Specs

Specs live in `specs/` and are numbered migrations applied sequentially (like database migrations). Read `specs/README.md` for the convention. In short:

- Read in numeric order (000 → 001 → …) to reconstruct the current design.
- `STATUS: implemented` specs are the current truth; the codebase is the final authority.
- Struck-through sections in earlier specs are overridden by later ones.

Key docs:

- `README.md` — full feature list, CLI reference, architecture diagram
- `specs/000-baseline.md` — original requirements and user stories (partially superseded)
- `specs/001-abs-upload.md` — Audiobookshelf upload mode (implemented)
- `specs/002-reduce-llm-calls.md` — LLM-verifier-not-orchestrator refactor (implemented)
- `.wayfinder/MAP.md` — wayfinder project map
