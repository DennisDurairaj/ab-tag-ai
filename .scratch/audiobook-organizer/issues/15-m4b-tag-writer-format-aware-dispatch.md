# 15 — M4B tag writer + format-aware dispatch

**What to build:** The `write_ffmetadata` tool writes M4B metadata via `ffmpeg -metadata`, and the tagger dispatch becomes format-aware: MP3 files route to node-id3, M4B files route to ffmpeg. Currently `tagMultiFileSet` runs node-id3 on every file including M4Bs, which cannot tag them correctly. After this ticket, an M4B book flows through the full pipeline and gets correct metadata written to its output copy, verifiable by reading tags back with ffprobe.

**Blocked by:** 14 — Copy-then-tag the copy (tagging happens on the copy, not the source)

**Status:** done

- [x] `write_ffmetadata` writes M4B metadata via `ffmpeg -metadata` (title, album, artist, track number)
- [x] Tagger dispatch routes MP3 → node-id3, M4B → ffmpeg based on `AudioFile.format`
- [x] Multi-file M4B sets get shared album, per-file titles, sequential track numbers (same rules as MP3)
- [x] M4B cover art handled appropriately for the format (co-located `cover.jpg` written by `writeCoverArt` in agent.ts; embedding not needed)
- [x] Tests write tags to a sample M4B, read them back via ffprobe, and assert correctness
