# 11 — Filename & directory title detection

**What to build:** Book identity inference uses the directory name as the primary title source and derives the author from the folder path (matching MAP ticket 012: "Author always available from folder path"), with filename-pattern stripping as the fallback. A book sitting in `Riordan, Rick/The Trials of Apollo/Book 1/` infers its title and author from the path without needing existing tags. Existing tags, when present, still take precedence over path inference.

**Blocked by:** 09 — Prefactor (clean `BookIdentity` usage)

**Status:** ready-for-agent

- [ ] Directory name used as primary title source when no existing tag title
- [ ] Author derived from the parent folder path (`Author, First/...`) when no existing tag artist
- [ ] Filename-pattern stripping remains as a fallback
- [ ] Existing tags still take precedence over path inference
- [ ] Tests cover: tagged file, untagged file in `Author/Book/`, untagged file in `Author/Series/Book/`
