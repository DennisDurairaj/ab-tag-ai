# 08 — Dry-Run Mode + Error Handling + Progress

**What to build:** A dry-run mode that simulates all operations (scanning, metadata resolution, tagging, file copy) without writing anything to disk. Progress logging that prints book-by-book status as the pipeline processes 2000+ files. Error handling: provider fallback chain (Audnexus → Open Library → Hardcover), flag books for manual review when all providers fail. CLI flags override config for dry-run toggle, input/output paths, and Hardcover API key.

**Blocked by:** 07 — File Organization + Copy to Output

**Status:** ready-for-agent

- [ ] Dry-run mode that logs all operations without touching disk
- [ ] Progress logging per book
- [ ] Provider fallback chain with manual review flag
- [ ] CLI flag overrides for --dry-run, --input, --output, --hardcover-key