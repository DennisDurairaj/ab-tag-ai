## Question

How should the agent handle multi-file mp3 books where all files need matching album/title for grouping but differentiated track numbers for ordering? Decisions needed: how to detect multi-file sets, how to assign album/title/grouping keys vs individual track titles/names, and how to write consistent tags across all files in a set.

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Set detection**: directory-based primary, filename pattern secondary (files sharing a directory and a common filename prefix form a set)
- **Album vs individual title**: shared album per book, individual per-file titles (e.g., chapter names) for Audiobookshelf compatibility
- **Track number assignment**: alphabetical by filename (deterministic, zero user input)
- **Tagging consistency**: all files get full tag set (album, individual title, track number) — every file is self-contained
- **Custom TXXX fields** (`series`, `series-part`, APIC cover art): write to all files in the set for consistency