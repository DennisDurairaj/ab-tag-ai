## Question

What should the cover art download behavior look like — what resolution to fetch, what filename convention to use, and how to handle fallback when no cover art exists?

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Resolution**: targeted square (500×500), resized via `sharp`
- **Filename**: `cover.jpg` in each book folder
- **Fallback when no cover art**: skip silently
- **Fetch timing**: during metadata discovery pass (ASIN-independent — covers can come from Open Library and Hardcover searches without an ASIN)