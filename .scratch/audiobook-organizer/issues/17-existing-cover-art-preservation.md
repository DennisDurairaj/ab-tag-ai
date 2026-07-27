# 17 — Existing cover art preservation

**What to build:** During metadata discovery, scan the source directory for existing `.jpg`/`.png` images; if present, use one as the cover (copy to output as `cover.jpg`) instead of downloading from a provider. Provider download becomes truly ASIN-independent and is the fallback only when no local image exists. Satisfies user story 19 and SPEC line 48 ("use existing .jpg/.png if present in the source").

**Blocked by:** 14 — Copy-then-tag the copy (cover is written to the output dir)

**Status:** done

- [x] Source directory scanned for `.jpg`/`.png` before any provider cover download
- [x] Existing image copied to output as `cover.jpg` (resized to 500×500 via sharp, matching provider covers)
- [x] Provider cover download only fires when no local image is found
- [x] Cover art resolution happens during discovery, before the LLM verifier (ASIN-independent)
- [x] Tests cover: existing cover used, no local cover → provider download, embedded APIC uses the resolved cover
