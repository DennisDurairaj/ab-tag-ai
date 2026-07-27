## Question

What Node.js libraries can read/write ID3 tags on mp3 files and metadata on m4b files, embed cover art, and handle folder restructuring? Investigate:
- For mp3: node-id3, jsmediatags, musicmetadata, fluent-ffmpeg/ffprobe
- For m4b/m4a: what libraries handle MP4 metadata tags (mp4box, etc.)
- Can ffmpeg be used as a subprocess for all of these?
- Cover art embedding support
- Series and series-part tag support (non-standard ID3 tags used by Audiobookshelf)
- What about bulk operations and performance with 2000+ books?

## Research Findings

Context pointer: [Audio Tagging Libraries Research](research/audio-tagging-libs.md)

### Key Findings

- **node-id3** (npm): recommended for MP3 files — reads/writes ID3v2 tags, supports custom TXXX frames for `series`/`series-part` (non-standard tags Audiobookshelf reads), supports APIC frame for cover art embedding, pure Node.js no native deps
- **ffmpeg** (via child_process): best for M4B/M4A files — reads via `ffprobe`, writes via `-metadata key=value` flag, supports custom metadata keys including `series` and `series-part`, covers both read and write in one tool
- **fluent-ffmpeg**: Node.js wrapper around ffmpeg, but adds complexity; direct `child_process` exec is simpler for metadata operations
- **jsmediatags**: read-only for MP3, no write support
- **musicmetadata**: read-only, uses ffprobe under the hood

Recommended architecture:
- **MP3 files:** use `node-id3` for both reading current tags and writing corrected tags (including custom TXXX series/series-part frames and APIC cover art)
- **M4B/M4A files:** use `child_process` to call `ffprobe` (read) and `ffmpeg -metadata key=value` (write)
- Both approaches handle all the Audiobookshelf tag mappings needed
- `node-id3` for MP3 and ffmpeg for M4B provide complete coverage of the two formats in your library

