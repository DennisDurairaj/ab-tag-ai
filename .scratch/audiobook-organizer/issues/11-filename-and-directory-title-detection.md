# 11 — Filename & directory title detection

**What to build:** Book identity inference uses the directory name as the primary title source and derives the author from the folder path (matching MAP ticket 012: "Author always available from folder path"), with filename-pattern stripping as the fallback. A book sitting in `Riordan, Rick/The Trials of Apollo/Book 1/` infers its title and author from the path without needing existing tags. Existing tags, when present, still take precedence over path inference.

**Blocked by:** 09 — Prefactor (clean `BookIdentity` usage)

**Status:** done

- [x] Directory name used as primary title source when no existing tag title
- [x] Author derived from the parent folder path (`Author, First/...`) when no existing tag artist
- [x] Filename-pattern stripping remains as a fallback
- [x] Existing tags still take precedence over path inference
- [x] Tests cover: tagged file, untagged file in `Author/Book/`, untagged file in `Author/Series/Book/`

## Amendments (post live-testing)

After end-to-end testing against real audiobooks, the priority order was reversed. ID3 tags in audiobook files are frequently unreliable — narrators in the `artist` field, per-chapter titles, whitespace-only values. The folder structure (`Author/Series/Book/`) is the ground truth.

**Committed in `7cdb2b7` and `ec06ff1`:**

- Author: folder path (`authorFromPath`) now takes priority over ID3 `artist` tag. The tag is only a fallback.
- Title: directory name now takes priority over `album` and `title` tags. Fallback chain: `dirName → album → tagTitle → filenameStem`.
- All tag values (`title`, `album`, `artist`) are trimmed; whitespace-only values treated as empty.

**Known limitation:** `extractCommonStem` in `src/scanner.ts` doesn't handle `57300_001_IN` / `57300_PRE` naming patterns, so multi-file sets with that format aren't grouped. Filename-stem titles leak through when no tag metadata exists and the files can't be grouped.
