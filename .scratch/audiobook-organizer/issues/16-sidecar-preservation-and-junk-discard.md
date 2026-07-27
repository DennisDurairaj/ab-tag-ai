# 16 — Sidecar preservation + junk discard during copy

**What to build:** During the copy step, preserve useful sidecar files (`.nfo`, `.cue`, `.json`, synopsis files) by copying them to the output directory alongside the audio, and discard junk files (`.txt` support messages, `desktop.ini`, `Icon.ico`). The useful/junk classification is explicit and testable. Satisfies issue 07 and user story 10.

**Blocked by:** 14 — Copy-then-tag the copy (sidecars travel with the audio copy)

**Status:** done

- [x] Useful sidecars (`.nfo`, `.cue`, `.json`, files matching a synopsis pattern) copied to output
- [x] Junk files (`.txt` support messages, `desktop.ini`, `Icon.ico`) discarded
- [x] Classification is a single explicit rule, easy to extend
- [x] Tests cover a book dir with mixed sidecars: useful ones copied, junk dropped, audio still copied
