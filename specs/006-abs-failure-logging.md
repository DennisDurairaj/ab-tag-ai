# 006 — ABS Failure Handling and Run Logging

<!-- STATUS: proposed -->

## Problem Statement

In `output_mode: "audiobookshelf"`, two things go wrong when failures occur:

1. **Upload failures write to local disk.** When an ABS upload fails (server error, item not found after upload, etc.), the tool falls back to copying files to `<outputDir>/Author/Book/` — a local output that contradicts the user's configured output mode. The user chose ABS; landing files on disk is a silent mode breach.

2. **Pre-upload failures write review JSONs.** When the path interpreter can't parse a directory or the verifier can't resolve provider metadata, a JSON file is written to `<outputDir>/review/`. In ABS mode this is another local write the user didn't ask for.

Additionally, the tool has no persistent run log — once the console scrolls past, there's no record of what ran, what failed, or why.

## Solution

In ABS mode: no local writes on any failure path. Instead, failures are collected into a run-end console summary and a daily log file at `<outputDir>/logs/YYYY-MM-DD.log`. The log file captures the full console transcript and rotates automatically (7-day retention).

In local mode: behavior is unchanged. Review JSONs and file copies remain as they are today.

## User Stories

1. A user uploading to ABS whose upload fails sees the failure in the run-end summary, not a silent local file copy.
2. A user whose book can't be matched by any provider sees the failure in the summary, not a stray review JSON file.
3. A user can check the daily log file to see exactly what happened in a past run.
4. Old log files are automatically removed after 7 days — no manual cleanup needed.
5. If the log file can't be written (disk full, permissions), the run continues with a console warning.
6. A user in local mode sees no change — review JSONs and file copies work as before.

## Implementation Decisions

### Log file writer

- Daily files at `<outputDir>/logs/YYYY-MM-DD.log`.
- Plain text format: `[YYYY-MM-DD HH:mm:ss] <message>` per line.
- Full console transcript captured (all `progress`, `success`, `warn`, `error`, `flagged`, `skipped`, `detail`, `tagged` output).
- Rotation: startup scan removes files older than 7 days; per-write day-change check creates a new file when the date rolls.
- Write failures: warn to console and continue. No recursive log-attempt. The console is the safety valve.

### ABS mode failures — upload path

The current local fallback in `executeAbsUpload` is replaced. Instead of calling `executeLocalFallback` (which copies files to `<outputDir>/Author/Book/>`), upload failures return a `{ status: "flagged" }` result. The `processBook` function in the agent distinguishes this from pre-upload flags by context and routes both to the same failures collection.

Five failure points in `executeAbsUpload` are affected:
- ASIN duplicate search errors
- Title duplicate search errors
- Library info lookup failure
- Upload failure after retries
- Post-upload item ID not discovered

Each produces a reason string (e.g. `"Upload failed (Server error 500)"`) that appears in the summary.

### ABS mode failures — pre-upload path

The path interpreter and verifier stop writing review files as side effects. The `writeFlagForReview` helpers are removed; the flagged result (`{ status: "flagged", reason }`) propagates up to `processBook`, which checks `config.output_mode` and decides: push to failures list (ABS) or write review file (local).

When the verifier's input has `metadata: null` (providers returned nothing), the verifier is skipped entirely — `processBook` short-circuits to the failure summary without an LLM call.

### Failure summary

Run-end console output:

```
=== FAILURES ===
2 book(s) failed to process:

  - "The Book Title" - "Author Name": Upload failed (Server error 500)
  - "Another Title": Cannot interpret path
```

Format: `"Title" - "Author": Reason`. When author is empty, the `- "Author"` part is omitted.

### `flagForReview` export

The public `flagForReview` function in the agent module checks `output_mode`: in ABS mode it pushes to the failures list; in local mode it writes the review JSON as before.

### `processBook` as decision point

All branch logic for write-vs-capture lives in `processBook` in the agent module. The path interpreter, verifier, and `executeAbsUpload` return data without side-effecting the filesystem. This makes the behavior testable by injecting a mock `processBook` or asserting on the failures collection.

## Testing Decisions

- The log file writer is tested with the same real-filesystem pattern used by `writeReviewFile`: write to `mkdtempSync`, read back, assert, clean up in `afterEach`. No `vi.mock` for `fs`.
- Failure collection is tested by asserting on the failures array shape after a mock pipeline.
- No new injection seams are added — the existing `fetchFn` pattern covers ABS client mocking; the real filesystem covers file writes.
- Prior art: `tests/config.test.ts` (flagForReview), `tests/verifier.test.ts` (review file assertions), `tests/orchestrator.test.ts` (ABS upload with fetch mock).

## Out of Scope

- Changing local mode behavior (review JSONs, local file copies remain unchanged).
- Removing the `writeReviewFile` function (still used in local mode).
- Structured/JSON log format (plain text decided; can revisit if machine consumption is needed).
- Log file retention configuration (hardcoded at 7 days; configurable later if needed).
- The original "permission denied /output/review" fix — already applied in `src/index.ts` and `src/utils.ts`.
- Bi-directional sync or incremental metadata updates to already-uploaded books.
