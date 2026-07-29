# 001 — Audiobookshelf Upload Mode

<!-- STATUS: implemented -->
<!-- SUPERSEDES: 000-baseline — output modes, tag-in-place behavior -->
<!-- VERIFIED: 2026-07-29 — all claims confirmed against src/ (see verification below) -->

## Problem Statement

`ab-tag-ai` tags audiobooks and copies them to a local output directory in an Audiobookshelf-compatible folder structure. Users must then manually import that directory into their Audiobookshelf server — either by moving files into a watched folder or by triggering a library scan. This manual step breaks the automation promise of the tool.

## Solution

Add an optional Audiobookshelf HTTP API upload mode configured via `output_mode: "audiobookshelf"`. Each successfully tagged book is uploaded directly to a target ABS library immediately, instead of being copied to a local output directory. Books already present in the library are skipped. On upload failure, the tool retries with exponential backoff and falls back to local copy. After upload, metadata is verified by triggering ABS's provider matching and comparing results against the tags we wrote.

## User Stories

1. A user configures the tool to upload tagged books directly to ABS library, no manual import.
2. Switch between local and ABS via `output_mode` config field.
3. Tag files in-place (modifying originals) regardless of output mode.
4. Skip books already present in the ABS library (duplicate prevention).
5. Multi-file audiobooks uploaded as a single ABS library item.
6. Upload cover art alongside audio files.
7. Verify uploaded metadata by triggering ABS provider matching and comparing results.
8. Flag books when ABS provider match returns conflicting metadata.
9. Retry failed uploads automatically (3 attempts with exponential backoff).
10. Fall back to local output when upload fails after retries.
11. Fail-fast on auth/config errors (bad token, wrong library ID).
12. Inline progress logging for uploads, retries, fallbacks, plus run-end summary.
13. Dry-run mode shows upload plan without modifying files or making network calls.
14. Default to `output_mode: "local"` when ABS keys are absent.
15. Override ABS settings via CLI flags and env vars (consistent with other config).

## Implementation Decisions

### Configuration

- New flat config keys: `output_mode` (`"local"` | `"audiobookshelf"`, defaults to `"local"`), `abs_url`, `abs_api_token`, `abs_library_id`.
- `output` path remains required — fallback destination when ABS upload fails.
- CLI flags: `--abs-url`, `--abs-token`, `--abs-library-id`.
- Env var: `ABS_API_TOKEN` overrides `abs_api_token`.
- Validation: when `output_mode` is `"audiobookshelf"`, all three `abs_*` keys must be non-empty.

### Pipeline change: in-place tagging

In both modes, the tool tags files directly in the source directory (modifying originals). After tagging:
- **Local**: copy tagged files from source to `output/Author/Series/Book/`.
- **ABS**: attempt upload. On failure, copy tagged files to `output/Author/Series/Book/` as fallback.

### Fork point

The fork lives inside `write_output`'s implementation in the orchestrator. The LLM sees no change — `write_output` has the same parameters as before.

### Audiobookshelf API (new module)

- `GET /api/libraries` — fetch folder UUID at startup.
- `POST /api/upload` — multipart upload with `title`, `author`, `series` form fields. All audio files in one request.
- `GET /api/libraries/:id/search?q=...` — duplicate detection and item ID discovery.
- `PATCH /api/items/:id/media` — set `asin` and `series`.
- `POST /api/items/:id/match` — trigger provider matching.
- `POST /api/items/:id/cover` — upload cover image.

### Upload flow (per book, ABS mode)

1. Duplicate check by ASIN; if no result, search by title + match author+fuzzy title. Found → skip.
2. Upload all audio files in one multipart request (with track-number prefix).
3. Poll `GET /api/libraries/:id/search?q=<title>` until item appears (max ~25s).
4. PATCH metadata: set `asin` and `series`.
5. Provider match: `POST /api/items/:id/match` with ASIN, title, author.
6. Verify: fetch item metadata post-match. Mismatch → flag for review.
7. Upload cover art.

### Duplicate detection

ASIN search first (definitive). If no ASIN match, search by title and match author+title client-side. Skipped books are logged, not treated as failure.

### Retry and fallback

- 3 retries with exponential backoff (1s, 2s, 4s) for retryable errors: network, timeouts, 5xx, 429.
- Non-retryable: 401, 404, 400 → immediate fallback without retries.
- Fallback copies tagged files to `output/Author/Series/Book/` with cover art.
- Inline logging per retry attempt. Run-end summary of all fallback books.

### Dry-run

`write_output` shows target (ABS library or local path), metadata, file count. No file modification, no network calls.

### LLM tool surface

No changes. `write_output` and `flag_for_review` are unchanged. The upload-vs-copy branch is invisible to the LLM.

## Out of Scope

- Multi-library management per run.
- Collection/playlist assignment.
- Playback state or user permission management.
- Bidirectional sync (ABS → local).
- Incremental metadata updates to already-uploaded books.

## Verification (codebase cross-check, 2026-07-29)

| Claim | Source | Match? |
|-------|--------|--------|
| Config keys: `output_mode`, `abs_url`, `abs_api_token`, `abs_library_id` | `config.ts:16-19` | ✓ |
| Validation: ABS keys required when mode is `audiobookshelf` | `config.ts:80-89` | ✓ |
| Env var: `ABS_API_TOKEN` override | `config.ts:59-60` | ✓ |
| CLI flags: `--abs-url`, `--abs-token`, `--abs-library-id` | `index.ts:24-26` | ✓ |
| Fork point in `write_output`, invisible to LLM | `orchestrator.ts:55-57` | ✓ |
| ABS client module with Bearer auth | `abs-client.ts:159-161` | ✓ |
| Multipart upload (`POST /api/upload`) | `abs-client.ts:244-276` | ✓ |
| Library search (`GET /api/libraries/:id/search`) | `abs-client.ts:297-306` | ✓ |
| PATCH metadata (`PATCH /api/items/:id/media`) | `abs-client.ts:308-322` | ✓ |
| Provider match (`POST /api/items/:id/match`) | `abs-client.ts:324-339` | ✓ |
| Cover upload (`POST /api/items/:id/cover`) | `abs-client.ts:341-356` | ✓ |
| Duplicate check: ASIN then title+author | `orchestrator.ts:257-289` | ✓ |
| Upload flow: poll for item ID after upload | `orchestrator.ts:333-361` | ✓ |
| Retry with backoff (1s, 2s, 4s) | `orchestrator.ts:181` | ✓ |
| Fallback to local on upload failure | `orchestrator.ts:254, 322` | ✓ |
| Non-retryable errors fail-fast | `orchestrator.ts:154-163` | ✓ |
| Dry-run: no modification or network calls | `orchestrator.ts:60-65, 101-106` | ✓ |
| Run-end summary of fallback books | `agent.ts:57-72` | ✓ |
| Multi-file upload in single multipart request | `orchestrator.ts:291-296` | ✓ |
| In-place tagging (modify source, then copy/upload) | `orchestrator.ts:81, 122` | ✓ |
| ~~`overrideCover` dynamic based on cover upload~~ | `orchestrator.ts:389` | Minor — always `false`, cover uploaded separately |
