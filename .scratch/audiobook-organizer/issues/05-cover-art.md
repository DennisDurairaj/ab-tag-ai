# 05 — Cover Art Download + Resize

**What to build:** During metadata discovery, attempt to download cover art from providers (Open Library cover API or Hardcover image URL). Resize to 500×500 via sharp. Name the file `cover.jpg`. Skip silently if no cover art is available from any provider. Embed the cover art as APIC in ID3 tags for MP3s.

**Blocked by:** 04 — Provider Metadata Resolution

**Status:** ready-for-agent

- [ ] Download cover art from provider APIs
- [ ] Resize to 500×500 via sharp
- [ ] Name file `cover.jpg`
- [ ] Skip silently when no cover art available
- [ ] Embed as APIC in MP3 ID3 tags