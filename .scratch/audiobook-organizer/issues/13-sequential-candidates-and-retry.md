# 13 — Sequential candidates + retry across the fallback chain

**What to build:** Extend the verifier flow to feed provider candidates one at a time in the ticket-005 fallback order (Audnexus → Open Library → Hardcover): on `retry`, advance to the next provider; max 1 retry per book, then auto-flag with the LLM's reason. Fix the broken fallback when an ASIN is known but Audnexus returns null — currently `enrichWithAudnexus` returns an identity stub instead of falling through to Open Library/Hardcover, so books never get flagged for review. After this ticket, an Audnexus miss on a known-ASIN book falls through to Open Library, then Hardcover, then review.

**Blocked by:** 12 — LLM verifier + single-candidate verification path

**Status:** done

- [x] Fallback chain feeds candidates to the LLM one at a time: Audnexus → Open Library → Hardcover
- [x] `retry` verdict advances to the next provider; max 1 retry, then auto-flag
- [x] Known-ASIN + Audnexus-null now falls through to Open Library/Hardcover instead of returning a stub
- [x] `flag` on second miss writes review JSON with the LLM's reason from the last candidate
- [x] Tests cover: trust on first candidate, retry-then-trust, retry-then-flag, all-providers-fail
