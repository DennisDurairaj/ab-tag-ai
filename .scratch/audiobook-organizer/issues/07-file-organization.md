# 07 — File Organization + Copy to Output

**What to build:** Build the output directory path using the resolved metadata: `Author/Series/Book/` for series books, `Author/Book/` for standalones. Copy all tagged audio files (and any preserved sidecar files) to the output directory. Leave originals untouched. Handle non-ASCII characters in author/series/book names by preserving filenames as-is (UTF-8 native).

**Blocked by:** 06 — Tag Writing (MP3 + M4B)

**Status:** ready-for-agent

- [ ] Determine Author/Series/Book vs Author/Book path
- [ ] Create output directory structure
- [ ] Copy tagged audio files to output
- [ ] Preserve useful sidecar files (.nfo, .cue, .json, synopsis)