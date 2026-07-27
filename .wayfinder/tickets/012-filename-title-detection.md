## Question

How should the agent handle books where only a filename hints at the title — e.g., numbered chapters without metadata (like `Chapter 01.mp3`, or files with no title info)? Decisions needed: how to extract a title from filenames, how to search providers with limited metadata, and how to flag unresolvable cases.

Depends on: 005 (agent architecture), 006 (ASIN acquisition)

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Title extraction**: combine directory name (primary) + filename pattern stripping (fallback). Directory name is the most reliable source since audiobook libraries organize files into book-named folders (`Author/Series/Book/` or `Author/Book/`).
- **Author availability**: always present from the folder path — searches always use title+author.
- **No provider results**: flag for manual review immediately in `review/` directory — no alternate strategies, no wasted cycles.