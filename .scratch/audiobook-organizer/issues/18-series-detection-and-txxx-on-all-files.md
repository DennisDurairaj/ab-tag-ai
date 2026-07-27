# 18 — Series detection + TXXX on all files

**What to build:** The Hardcover GraphQL query fetches series and series-part data (currently it fetches only `editions { asin }`); the metadata resolver populates `series` and `seriesPart` on resolved metadata; the tagger writes TXXX custom ID3 frames for `series` and `series-part` on *all* files in a multi-file set. The TXXX gate at `taggers/index.ts` already exists — it just never has data to write. Satisfies user story 18 and issue 06.

**Blocked by:** 14 — Copy-then-tag the copy (TXXX written to the copies)

**Status:** ready-for-agent

- [ ] Hardcover GraphQL query fetches series + series-part for matched books
- [ ] `resolveMetadata` populates `series` and `seriesPart` on the returned metadata
- [ ] TXXX `series` and `series-part` frames written on all files in a multi-file set
- [ ] `Author/Series/Book/` output path used when series is present (already supported by `buildBookFolderPath`)
- [ ] Tests cover a series book: tags read back show TXXX series + series-part on every file in the set
