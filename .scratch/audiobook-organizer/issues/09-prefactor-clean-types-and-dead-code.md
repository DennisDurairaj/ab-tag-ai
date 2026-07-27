# 09 — Prefactor: clean types, dedupe, remove dead code

**What to build:** A no-behaviour-change refactor that cleans the type model and removes duplication/dead code so the LLM verifier and new tools have a clean base. Specifically: `Book` becomes its own small type instead of extending `ResolvedMetadata` (it only ever sets 4 fields); the inline ASIN regex in `agent.ts` is replaced by the existing `validateAsin`; the dead `providers/index.ts` placeholder and unused `slugify`/`formatBytes` utilities are removed; provider functions take `BookIdentity` instead of bare `(title, author)` string pairs.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `Book` is its own type (path, title, author, asin) — no longer extends `ResolvedMetadata`
- [ ] `agent.ts` uses `validateAsin` instead of an inline `/^[A-Za-z0-9]{10}$/` regex
- [ ] `providers/index.ts` placeholder removed; unused `slugify` and `formatBytes` removed from `utils.ts`
- [ ] `searchOpenLibraryAsin`, `searchHardcoverAsin`, and related provider signatures take `BookIdentity` instead of two string params
- [ ] All existing tests still pass; typecheck and lint clean
