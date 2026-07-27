# 10 — Config: env var override + required hardcover_api_key

**What to build:** The config layer reads a `HARDCOVER_API_KEY` environment variable as an override (config file default < env var < `--hardcover-key` CLI flag), and `validateConfig` rejects an empty `hardcover_api_key` with a clear error. Running the tool with no key in any layer produces a helpful configuration error rather than a silent empty-string.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `HARDCOVER_API_KEY` env var read in `loadConfig` or `mergeCliOverrides`; override order is config < env < CLI flag
- [ ] `validateConfig` adds an error when `hardcover_api_key` is empty
- [ ] CLI flag still overrides env var (verified end-to-end)
- [ ] Tests cover all three layers and the empty-key rejection
