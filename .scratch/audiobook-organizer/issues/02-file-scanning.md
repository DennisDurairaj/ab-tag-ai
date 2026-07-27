# 02 — File Scanning & Metadata Detection

**What to build:** Walk the input directory recursively, detect MP3 and M4B files, read their existing ID3/ffprobe tags, and detect multi-file sets (files sharing a directory and common filename prefix). Print a summary of discovered books and files per book.

**Blocked by:** 01 — Project Scaffolding & Config

**Status:** done

- [x] Recursive directory walk to find .mp3 and .m4b files
- [x] Read existing ID3 tags (node-id3) for MP3 files
- [x] Read existing metadata (ffprobe) for M4B files
- [x] Detect multi-file sets via directory + filename prefix matching
- [x] Print summary: books found, files per book, any files missing metadata

## Known limitation

`extractCommonStem` regex patterns (`src/scanner.ts:128-132`) only match stems ending with digit suffixes:
- `/(.*?)[_\-\s]?\d+$/`
- `/(.*?)[_\-\s]?Part\d+$/i`
- `/(.*?)[_\-\s]?Chapter\s*\d+$/i`

Files named like `57300_001_IN.mp3`, `57300_002_C001.mp3`, `57300_PRE.mp3` (common in LibriVox-style rips) don't share a common stem — the `_IN` and `_PRE` suffixes prevent grouping. Discovered while testing Elizabeth Peters' Vicky Bliss series.