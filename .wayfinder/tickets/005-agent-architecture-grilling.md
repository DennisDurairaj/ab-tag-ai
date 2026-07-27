## Question

What should the LLM agent's architecture, tool set, and control flow look like? Key decisions:
- Tool definitions: what tools does the agent need (read_file, search_provider, write_tags, move_folder, download_image, etc.)
- Control flow: one LLM call per book? Per batch? How does it iterate through 2000+ books?
- Error handling: what happens when metadata can't be determined?
- CLI interface: flags, config file format
- Project structure

Depends on: 001, 002, 003, 004

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Tool definitions** (9 tools):
  - `read_audio_metadata` — probe MP3/M4B files (ffprobe + node-id3)
  - `search_open_library` — title+author search, returns ASINs, covers, series info
  - `search_audnexus` — ASIN-based enrichment (narrator, duration)
  - `search_hardcover` — fuzzy search, series metadata, ratings
  - `write_id3_tags` — write ID3v2 tags via node-id3 (TXXX custom fields for series/series-part + APIC cover art)
  - `write_ffmetadata` — write M4B metadata via ffmpeg
  - `download_cover_art` — fetch cover image from providers
  - `move_file` — copy/move files to output directory
  - `dry_run_preview` — simulate all operations without modifying anything
- **Control flow**: per-book sequential LLM call (simple, debuggable, sufficient for always-on home server)
- **Error handling**: cycle through providers Audnexus → Open Library → Hardcover; if all fail, flag book for manual review in a `review/` directory
- **CLI interface**: config file (`config.yaml.example`) for defaults, CLI flags override config values
  - **Project structure**: TypeScript (`.ts`), organized into `providers/`, `taggers/`, and shared `utils.ts`, `config.ts`, `agent.ts` as per-book pipeline + LLM verifier

## Amended (re-grilled 2026-07-27)

Original resolution treated the LLM as the orchestrator that calls all 9 tools per book. A spec-compliance review found the implementation had silently dropped the LLM entirely (procedural pipeline, `llm_model` unused). Four decisions re-resolved:

1. **Honor the LLM-agent architecture (not amend to procedural).** Rebuild `agent.ts` to use an LLM per book. The 9 tools remain the capability set.
2. **LLM role = verifier, not orchestrator.** Procedural code does the deterministic work (fetch, cache, tag, copy); the LLM performs the manual-verification pass the user currently does by hand, on every book. Without this, silent mistakes (wrong ASIN match, translation mismatch, wrong series part) go uncaught — the exact problem manual per-book review solves today. Cost budget ≈ $2/run for 2000 books on a mini-tier model.
3. **LLM output contract:** `{ verdict: "trust" | "flag" | "retry", reason: string, retryHint?: string }`. Max 1 retry per book, then auto-flag. The LLM picks which provider to trust/retry; it does not invent metadata (avoids hallucination reintroducing the silent-mistake problem).
4. **Sequential candidates + retry.** Fallback chain (Audnexus → Open Library → Hardcover) feeds candidates one at a time; LLM verdicts per candidate; `retry` advances to the next provider; `flag` on second miss. Common case = 1 LLM call (trust on first candidate).

**Updated tool-calling model:** the procedural code calls `read_audio_metadata`, `search_*`, `download_cover_art`, `write_id3_tags`, `write_ffmetadata`, `move_file`, `dry_run_preview` directly. The LLM's direct tool use is `flag_for_review` and `retry_provider`. The 9 tools still exist as functions; they are not all invoked *by* the LLM.

**Control flow (updated):** per-book sequential pipeline with one LLM verification call per candidate (up to 2 candidates seen). Scan → acquire ASIN → fetch candidate from next provider in chain → LLM verdict → (trust: tag+copy | retry: next provider | flag: review/) → next book.
