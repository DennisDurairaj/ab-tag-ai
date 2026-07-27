## Question

How should the agent handle foreign-language (non-ASCII) books — specifically Polish and Norwegian titles/authors? Key decisions: how to handle non-ASCII filenames, whether online providers return correct localized data, and how the agent should handle non-English titles when searching providers.

Depends on: 005 (agent architecture)

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **Non-ASCII filenames**: preserve as-is (modern Linux filesystems handle UTF-8 natively; transliteration is lossy)
- **Provider behavior**: Open Library and Hardcover handle Polish/Norwegian/Spanish natively. Audnexus has no title search and lacks `pl`/`no` region support, so it's limited for non-English metadata enrichment
- **Search strategy**: pass original-language titles through to providers as-is, no transliteration needed
- **Agent-level handling**: pass Unicode titles verbatim to providers (pass-through as-is); rely on provider fallback chain if a search returns no results