# 02 — File Scanning & Metadata Detection

**What to build:** Walk the input directory recursively, detect MP3 and M4B files, read their existing ID3/ffprobe tags, and detect multi-file sets (files sharing a directory and common filename prefix). Print a summary of discovered books and files per book.

**Blocked by:** 01 — Project Scaffolding & Config

**Status:** ready-for-agent

- [ ] Recursive directory walk to find .mp3 and .m4b files
- [ ] Read existing ID3 tags (node-id3) for MP3 files
- [ ] Read existing metadata (ffprobe) for M4B files
- [ ] Detect multi-file sets via directory + filename prefix matching
- [ ] Print summary: books found, files per book, any files missing metadata