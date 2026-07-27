# 06 — Tag Writing (MP3 + M4B)

**What to build:** Write metadata tags to audio files. For MP3: use node-id3 to write ID3v2 tags including TXXX custom frames for series/series-part and APIC for cover art. For M4B: use ffmpeg to write metadata via ffprobe read and -metadata write. Each multi-file MP3 set gets shared album, individual per-file titles (chapter names from filename), sequential track numbers, and series TXXX fields on all files. All tags include album, album artist, title, track number, series, series-part, and cover art (APIC).

**Blocked by:** 04 — Provider Metadata Resolution, 05 — Cover Art Download + Resize

**Status:** ready-for-agent

- [ ] Write ID3v2 tags for MP3 via node-id3 (TXXX for series/series-part, APIC for cover)
- [ ] Write ffmpeg metadata for M4B
- [ ] Multi-file set: shared album, per-file titles, alphabetical track numbering
- [ ] Series TXXX fields on all files in a set