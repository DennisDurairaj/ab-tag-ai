# 002 — Reduce LLM Calls (Verifier Not Orchestrator)

<!-- STATUS: implemented -->
<!-- SUPERSEDES: 000-baseline — control flow, LLM role, tool set, provider chain, error handling -->
<!-- DOES NOT AFFECT: 001-abs-upload — ABS upload pipeline kept intact (see Out of Scope) -->
<!-- VERIFIED: 2026-07-29 — all claims confirmed against src/ (see verification below) -->

## Problem Statement

The app hits rate limits quickly because the LLM is used as an orchestrator — it drives a loop of up to 30 iterations per book, making 4-8 LLM calls per successful book just to dispatch provider searches that are deterministic. The SPEC originally defined the LLM as a verifier, but the implementation makes it the dispatcher for every step. This burns API budget on decisions that don't need AI, leaving no headroom for the work that actually requires intelligence: interpreting arbitrary path structures and resolving ambiguous provider results.

## Solution

Restructure the per-book flow into four phases, only two of which involve the LLM:

1. **Pre-processing** (deterministic): find local cover art, extract weak tag signals for context.
2. **Path Interpreter** (1 LLM call): the LLM interprets the path structure and returns `{title, author}` or flags for review.
3. **Deterministic Search** (no LLM): check ASIN cache, search OL + HC in parallel, merge results, fuzzy-match against inferred title/author. If matched, enrich with Audnexus and write output — no more LLM calls.
4. **Verifier Fallback** (1 LLM call, ~10-20% of books): only when fuzzy match can't decide between provider results, the LLM resolves ambiguity and calls `write_output` or `flag_for_review`.

This cuts LLM calls from 4-8 per book to 1-2 (a 75-90% reduction), with most books needing only the single path-interpreter call.

## User Stories

1. As a user with a large library, I want the tool to make fewer LLM calls per book so that I don't hit API rate limits before my library is processed.
2. As a user with irregular folder structures (e.g., `Author/Series/Book/BookFolder/Files` or `Author/Book/Files`), I want the LLM to interpret my path structure correctly regardless of depth.
3. As a user, I want provider searches to run without LLM involvement so that search latency doesn't depend on LLM iteration time.
4. As a user, I want the ASIN cache to short-circuit provider searches entirely so that previously processed books skip both LLM and API calls.
5. As a user with unambiguous provider results (title and author match within fuzzy threshold), I want the tool to trust them automatically and avoid a second LLM verification call.
6. As a user with ambiguous provider results (multiple plausible candidates or mismatched names), I want the LLM to resolve the ambiguity rather than the tool guessing.
7. As a user, I want invalid ASINs in existing ID3 tags to be ignored entirely — only the file-based cache of previously verified ASINs is trusted.
8. As a user running in Audiobookshelf mode, I want the ABS upload pipeline (search, upload, scan, poll, match, cover) to be transparent behind the `write_output` tool with no additional LLM involvement.
9. As a user, I want provider rate limits respected automatically via inter-call delays regardless of which code path triggers the API call.
10. As a user with a multi-file audiobook, I want the LLM to interpret the single path once and apply the inferred title/author to all files.
11. As a user, I want the LLM to have an explicit escape hatch (`flag_for_review`) at every phase so that unparseable paths or unresolvable books don't burn the full iteration budget.
12. As a user, I want local cover art detection to happen before the LLM fires so that cover availability doesn't consume LLM tokens or tool calls.
13. As a user, I want Hardcovers' series/sequence data merged with Open Library's ASIN and cover ID so that the richest possible metadata is collected without requiring the LLM to choose between providers.

## Implementation Decisions

- **Phase separation**: the per-book processing pipeline is split into four sequential phases: pre-processing, path interpretation, deterministic search, and verifier fallback. Only phases two and four involve the LLM.

- **Path Interpreter interface**: the LLM has exactly two tools available — `set_title_author(title, author)` and `flag_for_review(reason)`. No search tools, no output tools. The LLM's sole job is to read the path and either commit to a title+author pair or bail. Maximum five iterations for edge cases where the LLM needs to reconsider its interpretation.

- **Path Interpreter input**: the LLM receives the full path segment breakdown, the file list with filenames and formats, and weak tag signals per file as one-line annotations (`file.mp3 [tag_artist=..., tag_title=...]`). Tags are presented as unreliable hints, with the path treated as ground truth.

- **Deterministic search**: runs `searchOpenLibraryAsin` and `searchHardcoverAsin` in parallel with the inferred `{title, author}`. Results are merged — Open Library provides the ASIN (via editions/isbn) and cover ID; Hardcover provides series name and sequence. No LLM involvement.

- **ASIN cache check**: before any provider search, the file-based cache at `.wayfinder/cache/asin.json` is checked. If the inferred `{title}/{author}` key exists, provider searches and enrichment are skipped — the cached ASIN is used directly with Audnexus enrichment.

- **No trust in tag ASINs**: ASINs found in existing ID3 tags are not used or cached unless they have been verified in a prior run and stored in the file-based cache. Tags are treated as weak signals only.

- **Fuzzy match gate**: after provider search, the inferred title and author are compared against each candidate using the existing `fuzzyMatch` function (normalized whitespace, case, alphanumeric-only comparison). If a single candidate matches, it's accepted deterministically. If multiple candidates match or none match, the Verifier fallback is triggered.

- **Verifier fallback interface**: the LLM has two tools — `write_output(title, author, asin, series?, seriesPart?, narrator?, coverUrl?, coverId?)` and `flag_for_review(reason)`. The LLM receives all OL and HC results plus the fuzzy match failure reason. Maximum five iterations. This reuses the existing tool definitions from the current orchestrator but is only invoked as a fallback.

- **Audnexus enrichment**: runs only after a title/author match is confirmed (either deterministically via fuzzy match or by the verifier LLM). Audnexus provides narrator, cover URL, and duration. Failure is non-blocking — write_output proceeds without these fields.

- **Local cover detection**: runs in pre-processing before the LLM. If a JPG or PNG is found in the source directory, it's stored as a buffer and passed directly to `write_output`. No LLM tool call needed.

- **ABS upload path**: `write_output` internally checks `outputMode`. In ABS mode, it runs the full `executeAbsUpload` pipeline (ASIN dedup check, title dedup check, upload, scan, poll, metadata PATCH, provider match with verify/revert, cover upload, verification). The LLM is never exposed to ABS errors, retries, or polling. Failure falls back to local output.

- **Rate-limit delays**: provider-specific inter-call delays (1.1s OL, 1s HC, 0.6s Audnexus) live in the provider modules and are respected regardless of call origin. The deterministic search path uses `metadata-resolver.ts` which already has these delays.

- **MAX_ITERATIONS**: reduced from 30 to 5 for both the Path Interpreter and the Verifier fallback. The LLM no longer runs a search loop, so the budget is for interpretation retries, not tool dispatch.

## Testing Decisions

- **Test the Path Interpreter seam**: mock the LLM API, verify that `{title, author}` is correctly parsed from the response and passed to the deterministic search phase. Verify that `flag_for_review` properly short-circuits.

- **Test the deterministic search phase**: mock the OL and HC providers, verify parallel execution, verify merge logic (OL ASIN + HC series), verify fuzzy match gate (pass-through vs. fallback trigger).

- **Test the Verifier fallback seam**: mock the LLM API, verify that ambiguous provider results trigger the fallback and that the LLM's `write_output` or `flag_for_review` call is honored.

- **Test the ASIN cache short-circuit**: verify that when the cache is populated, provider searches and the entire deterministic phase are skipped.

- **Test the full pipeline end-to-end**: feed a known directory structure through the pipeline, verify the correct metadata emerges at the output, and count LLM calls — should be 1-2 per book maximum.

- **Prior art**: the existing test infrastructure in `tests/` uses Vitest with mocks for provider APIs and the LLM. Follow the same pattern.

- **What makes a good test**: only test behavior observable through the module's interface. For the Path Interpreter, test that given a path + file list, the output is either `{title, author}` or a flagged result. Don't test internal LLM prompt construction.

## Out of Scope

- Changing the Audiobookshelf upload pipeline. The `executeAbsUpload` function is unchanged.
- Changing the file tagging logic (ID3v2 writing, ffmpeg M4B metadata).
- Changing the cover art download and resize logic.
- Adding new providers or modifying existing provider API contracts.
- Modifying the config format or CLI flags.
- Changing the concurrency model or the `processWithConcurrency` mechanism.

## Further Notes

- The `metadata-resolver.ts` module is currently unused in the primary code path but contains the exact deterministic search logic needed. This spec makes it the primary code path.
- The ASIN cache format (`{title}/{author} → asin`) remains unchanged. The cache population logic moves from the LLM tool handler to the deterministic search phase.
- The `buildInitialMessage` function in the orchestrator will be split: the path description becomes the Path Interpreter's input, and the provider results summary becomes the Verifier's input.

## Verification (codebase cross-check, 2026-07-29)

| Claim | Source | Match? |
|-------|--------|--------|
| 4-phase pipeline (pre-processing → path interpreter → deterministic search → verifier) | `agent.ts:173-219` | ✓ |
| Path interpreter tools: only `set_title_author` + `flag_for_review` | `path-interpreter.ts:15-44` | ✓ |
| Path interpreter MAX_ITERATIONS = 5 | `path-interpreter.ts:47` | ✓ |
| Deterministic search: OL + HC parallel via Promise.all | `deterministic-search.ts:104` | ✓ |
| ASIN cache check before provider search | `deterministic-search.ts:159-176` | ✓ |
| Fuzzy match gate before writing output | `deterministic-search.ts:192-201` | ✓ |
| Verifier only on fallthrough | `agent.ts:198-219` | ✓ |
| Verifier tools: only `write_output` + `flag_for_review` | `verifier.ts:19-54` | ✓ |
| Verifier MAX_ITERATIONS = 5 | `verifier.ts:57` | ✓ |
| Audnexus enrichment only after ASIN confirmed | `deterministic-search.ts:136` | ✓ |
| Local cover detection before LLM (pre-processing) | `agent.ts:175` | ✓ |
| ABS upload behind write_output, no LLM exposure | `orchestrator.ts:55-134` | ✓ |
| Rate-limit delays in provider modules | `open-library.ts:6`, `utils.ts:5` | ✓ |
| ASIN cache key format `{title}/{author}` unchanged | `asin.ts:97` | ✓ |
| Concurrency with 500ms staggered delays | `agent.ts:89` | ✓ |
| Metadata-resolver.ts not primary path (deterministic-search implements own merge) | `deterministic-search.ts:98-148` | Minor — behavior equivalent, unused module remains |
