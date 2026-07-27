## Question

Is it acceptable for the Hardcover API to require a user-provided Bearer token? How should the agent handle the API key — CLI flag, config file, env var, or some other mechanism?

## Status

- [x] Claimed
- [x] Resolved via /grilling

## Resolved

- **API key requirement**: acceptable — Hardcover API is free, Bearer token is easy to obtain from hardcover.app/account/api
- **Input mechanism**: layered approach — config file as default, env var (`HARDACOVER_API_KEY`) as secrets layer, CLI flag (`--hardcover-key`) for temporary overrides