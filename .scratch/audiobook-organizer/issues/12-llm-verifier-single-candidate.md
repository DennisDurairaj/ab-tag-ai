# 12 — LLM verifier + single-candidate verification path

**What to build:** Add an LLM client (model selected from the now-load-bearing `llm_model` config key) and a verifier that, given one provider candidate plus the book's inferred identity and existing tags, returns `{ verdict: "trust" | "flag" | "retry", reason: string, retryHint?: string }`. Wire it into `agent.ts` for the single-candidate case: fetch one candidate, LLM verdicts, `trust` logs resolved metadata (downstream tag/copy still stubbed at this stage), `flag` writes a `review/<safe-name>.json` file containing the LLM's `reason` (replaces the current hardcoded "No ASIN could be acquired" reason that's wrong on metadata failures). Remove the hardcoded 0.7 word-overlap title-matching heuristic in `asin.ts` — the LLM verifier supersedes it; `verifyAsin` becomes a thin check that the candidate exists, with the LLM doing the match judgment.

**Blocked by:** 09 — Prefactor (clean types and `BookIdentity`)

**Status:** ready-for-agent

- [ ] LLM client added; `llm_model` config key read and used to select the model
- [ ] Verifier interface returns `{ verdict, reason, retryHint? }` per the amended ticket 005
- [ ] `agent.ts` single-candidate flow: fetch → LLM verdict → (trust: log | flag: review/ with LLM reason)
- [ ] `flagForReview` writes the LLM's `reason` into `review/<safe-name>.json` instead of a hardcoded string
- [ ] 0.7 word-overlap heuristic removed from `asin.ts`; `verifyAsin` simplified
- [ ] Tests mock the LLM client and cover trust, flag, and retry verdicts
