# 19 — Dry-run enforcement across all write paths

**What to build:** The `dry_run_preview` tool: every write site gates on `!config.dry_run` — file copy, ID3 tag write, M4B ffmpeg write, sidecar copy, cover-art write, and `review/` directory creation. In dry-run, each site logs the planned action (planned output path, planned tags, cover source, planned review file) instead of writing anything. The `config.dry_run` flag is currently read only to print a banner in `index.ts`; none of the write sites check it. Satisfies SPEC line 13, issue 08, and user story 13.

**Blocked by:** 14 — Copy-then-tag the copy, 15 — M4B tag writer, 16 — Sidecar preservation (dry-run must gate every write site that now exists)

**Status:** ready-for-agent

- [ ] `config.dry_run` checked at every write site: copy, ID3 write, M4B write, sidecar copy, cover write, review-dir creation
- [ ] Dry-run logs the planned output path, planned tags, and cover source per book instead of writing
- [ ] `--dry-run` CLI flag and `dry_run` config key both honored (already wired in `index.ts`)
- [ ] Tests run the full pipeline in dry-run against a fixture and assert nothing is written to disk
