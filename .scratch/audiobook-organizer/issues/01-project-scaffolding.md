# 01 — Project Scaffolding & Config

**What to build:** A TypeScript CLI project with package.json, tsconfig.json, and the src/ directory structure (index.ts as entry, agent.ts as orchestrator, providers/, taggers/, utils.ts, config.ts). The CLI reads a YAML config file and accepts flags that override config values. Running the tool with no input prints usage help.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Package.json with TypeScript, node-id3, ffmpeg, sharp dependencies
- [ ] tsconfig.json targeting Node.js modern
- [ ] src/index.ts CLI entry with argument parsing
- [ ] src/config.ts loads config.yaml.example and merges CLI flags
- [ ] src/agent.ts empty orchestrator stub with per-book loop
- [ ] src/providers/ taggers/ utils.ts directories created