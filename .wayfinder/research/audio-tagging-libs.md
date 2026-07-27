# Audio Metadata Tagging Libraries — Node.js Research

> Researched 2026-07-26 for an audiobook metadata tool targeting Audiobookshelf compatibility.

---

## 1. node-id3

- npm package (`node-id3`), most popular Node.js library for MP3 ID3v2 tags
- Supports reading AND writing all standard ID3 frames
- Supports **custom TXXX frames** — critical for `series` and `series-part` (non-standard tags Audiobookshelf reads)
- Supports **APIC frames** for embedding cover art in MP3s
- Pure Node.js, no native dependencies
- API: `node-id3.read(buffer/file)` returns parsed tags; `node-id3.write({...tags}, buffer/file)` writes them
- Can handle genre, artist, album, title, subtitle, publisher, year, description (as COMM frame), custom fields
- Limitation: MP3 only, no M4B/M4A support

## 2. ffmpeg (via fluent-ffmpeg or child_process)

- Best option for M4B/M4A metadata
- Uses `-metadata key=value` to write tags to MP4 containers
- Can read metadata via `ffprobe` (child_process: `ffprobe file.mp3`)
- Supports custom metadata keys including ` series` and `series-part` (via `-metadata series=XXX -metadata series-part=N`)
- Can also write APIC (cover art) to M4B: `-i cover.jpg -c copy -metadata:s:v:0 filename=cover.jpg`
- Pros: handles both mp3 and m4b/m4a (one tool for all formats); extremely reliable
- Cons: external binary dependency (ffmpeg must be installed on the system); shell subprocess overhead

## 3. Other libraries (not recommended)

| Library | Read | Write | MP3 | M4B | Custom Tags | Cover Art |
|---------|------|-------|-----|-----|-------------|-----------|
| node-id3 | Yes | Yes | Yes | No | Yes (TXXX) | Yes (APIC) |
| jsmediatags | Yes | No | Yes | No | No | No |
| musicmetadata | Yes | No | Yes | No | No | No |
| fluent-ffmpeg | Yes | Yes | Yes | Yes | Yes | Yes |
| taglib (bindings) | Read | Read | Yes | Yes | Limited | No |

## 4. Recommended approach

Use `node-id3` for MP3 files (read + write, including custom TXXX frames and APIC cover art). Use `ffi-ffmpeg` or direct `child_process` calls to ffmpeg for M4B files (reads via ffprobe, writes via ffmpeg -metadata). This gives complete coverage of all audio formats in your library.

## 5. Key Audiobookshelf-specific tags

When writing tags, the following non-standard tags are used by Audiobookshelf:
- `series` → Maps to Audiobookshelf Series field (ID3v2 TXXX frame with description "series", or MP4 metadata key "series")
- `series-part` → Maps to Audiobookshelf Series Sequence (TXXX with description "series-part", or MP4 key "series-part")
- `composer` → Maps to Narrator in Audiobookshelf (standard ID3v2 frame)
- `album` → Maps to Title (standard ID3v2 frame)
- `album-artist` → Maps to Author (standard ID3v2 frame)
