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
- **Project structure**: TypeScript (`.ts`), organized into `providers/`, `taggers/`, and shared `utils.ts`, `config.ts`, `agent.ts` as orchestrator
