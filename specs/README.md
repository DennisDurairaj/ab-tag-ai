# Specs

Like database migrations: each file is a numbered change applied sequentially. Read them in order to reconstruct the current design.

## Convention

- Files are `NNN-short-name.md`, numbered 000+ in application order.
- Each file declares its `STATUS` in an HTML comment header.
- Strikethrough in 000 (and earlier specs) marks sections superseded by later specs.
- When an earlier spec contradicts a later one with `STATUS: implemented`, the later one wins.

## States

| Status        | Meaning                                         |
| ------------- | ----------------------------------------------- |
| `implemented` | Merged into the codebase. The current truth.    |
| `proposed`    | Drafted but not yet built.                      |
| `rejected`    | Considered and declined. Preserved for context. |
| `superseded`  | An older spec marked obsolete by a later one.   |

## Authority order (highest wins)

1. The codebase (final source of truth)
2. Most recent `STATUS: implemented` spec in `specs/`
3. Earlier `STATUS: implemented` specs (partially stale)

## Index

| #   | Name                                         | Status                                            |
| --- | -------------------------------------------- | ------------------------------------------------- |
| 000 | Baseline                                     | implemented (partially superseded by 001 and 002) |
| 001 | Audiobookshelf Upload Mode                   | implemented                                       |
| 002 | Reduce LLM calls — Verifier Not Orchestrator | implemented                                       |
