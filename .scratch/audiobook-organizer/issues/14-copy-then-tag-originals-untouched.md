# 14 — Copy-then-tag the copy, originals untouched

**What to build:** The `move_file` tool copies each audio file to its resolved output path (`Author/Series/Book/` for series books, `Author/Book/` for standalones) and then tags the *copies* in the output directory — source files are never mutated. Wires into the `trust` branch of the verifier flow. This fixes the #1 spec gap: the current code writes ID3 tags to source paths in place and never copies anything to the output directory, directly violating SPEC line 7 and user story 9. After this ticket, a `trust` verdict results in a tagged copy in the output dir and an unchanged source.

**Blocked by:** 13 — Sequential candidates + retry (the trust branch is where copy-then-tag fires)

**Status:** done

- [x] `move_file` copies the audio file to the resolved `Author/[Series/]Book/` output path
- [x] Tags are written to the *copy* in the output directory, not the source
- [x] Source file's tags are provably unchanged after a run (test asserts this)
- [x] `buildBookFolderPath` used for the output path; output dir created with `ensureDir`
- [x] Tests cover: standalone book → `Author/Book/`, series book → `Author/Series/Book/`, source unchanged
