# 005 — Interactive CLI Folder Picker for --include

<!-- STATUS: proposed -->
<!-- ISSUE: https://github.com/DennisDurairaj/ab-tag-ai/issues/11 -->
<!-- MAP: https://github.com/DennisDurairaj/ab-tag-ai/issues/6 -->

## Problem Statement

Users must manually edit `config.yaml` to select which subdirectories of `input/` to process. The `include` field takes exact folder names — no autocomplete, no browse, no preview of what's available. Copy-pasting or retyping folder names from a file listing is error-prone and slow, especially for users with dozens of author folders.

The `--include "foo,bar"` CLI flag lets users pass comma-separated names without editing YAML, but still requires the user to already know the exact folder names.

## Solution

Repurpose the `--include` CLI flag as an interactive folder picker. Running `abmeta --include` scans the immediate subdirectories of `input/`, presents them as a searchable multi-select list, and wires the user's selections into the existing `include` pipeline.

For Docker users and non-interactive environments, `config.yaml`'s `include` field continues to work unchanged.

## User Stories

1. As a CLI user, I want to run `abmeta --include` and see a list of all my author folders, so I can pick which ones to process without opening a text editor.
2. As a CLI user, I want to type a few characters to filter the folder list, so I can quickly find a specific author among dozens of folders.
3. As a CLI user, I want to select multiple folders with the space bar and confirm with enter, so the selection is fast and keyboard-driven.
4. As a CLI user, I want the folders shown in alphabetical order every time, so I can predictably find what I'm looking for.
5. As a CLI user, I want to see which folders I selected before processing starts, so I can abort if I made a mistake.
6. As a CI user running `abmeta --include` in a non-interactive shell, I want the tool to warn me and fall back to scanning everything, so my script doesn't hang.
7. As a Docker user, I want the `config.yaml` include field to keep working, so I can select folders when running headless.
8. As a user who accidentally runs `--include` without selecting anything, I want to be told to drop the flag (or pick at least one folder), so I understand that `--include` means "pick some."
9. As a user with an input directory that has no subdirectories, I want a clear message instead of an empty picker, so I know the tool can't help me select.
10. As a user running in dry-run mode with `--include`, I want the picker to still appear, so dry-run previews the same selection flow as a real run.
11. As a user with exactly one subdirectory in `input/`, I want the picker to still appear (consistent UX), so the tool behaves the same way regardless of folder count.

## Implementation Decisions

### New module: interactive picker

A single new module exports one function:

```
runInteractivePicker(inputDir: string): Promise<string[]>
```

- Uses `fs.readdirSync` to list immediate subdirectories of `inputDir`, sorted alphabetically
- Uses `@clack/prompts` `autocompleteMultiselect` for the interactive UI
- Returns the selected folder names, or an empty array if the user cancels (Esc / Ctrl+C)
- If `inputDir` has no subdirectories, errors immediately before showing the picker
- The prompt title is: `"Select folders to process (space to select, enter to confirm):"`
- The `required: true` option enforces at-least-one selection with a re-prompt message: `"No folders selected. Run without --include to process all folders."`
- All folders are unchecked by default (no pre-selection)

### CLI flag repurposing

The `--include` flag in `src/index.ts` changes from a value-taking flag to a boolean flag:

```
.option("--include", "Interactively select folders to process")
```

The old `--include "foo,bar"` comma-separated behavior is removed. Running this would now error (unexpected argument).

### Integration flow

```
1. loadConfig(configPath)                    → YAML + env overrides
2. Build CLI overrides (non-include fields)  → input, output, keys, dry-run, etc.
3. If --include flag:
   a. Merge non-include CLI overrides into config to get effective input path
   b. If TTY:
      - Validate input path exists and is a directory
      - Call runInteractivePicker(effectiveInputPath)
      - Set cliOverrides.include = result
      - Print summary: "Processing N folders: FolderA / FolderB / FolderC"
   c. If non-TTY:
      - Log warning: "--include requires an interactive terminal. Processing all folders instead."
      - cliOverrides.include stays unset → config.yaml include or scan-all applies
4. mergeCliOverrides(config, cliOverrides)
5. validateConfig(config)
6. processLibrary(config)
```

### No changes to existing modules

- `src/agent.ts` — `scanFilteredFiles()` receives folder names as before; `processLibrary()` logic unchanged
- `src/config.ts` — `Config` interface, `mergeCliOverrides`, `validateConfig` unchanged
- `src/scanner.ts` — unchanged
- `src/orchestrator.ts` and all providers — unchanged

### Library choice

`@clack/prompts` v1.7.0 — MIT license, 17M weekly downloads, actively maintained. Provides `autocompleteMultiselect` which combines search-as-you-type filtering with space-to-toggle multi-select in a single component. This is the same library used by `npx skills` (the Verce labs skills CLI).

Note: `@clack/prompts` does not support page-up/page-down navigation. The `autocompleteMultiselect` search bar mitigates this — typing a few characters collapses even large lists to a handful of matches.

### Non-TTY detection

`process.stdin.isTTY` is checked before opening the picker. If false, the picker is skipped and a warning logged. The existing include resolution (YAML → scan-all) takes over.

### Dry-run

The `--dry-run` flag does not affect the picker. The picker always appears when `--include` is passed, regardless of dry-run mode.

## Testing Decisions

### What makes a good test

Tests verify external behavior through injected seams. The new module's seam is the `@clack/prompts` import — tests should mock `autocompleteMultiselect` at the module level to control the returned selection without requiring a real TTY.

### Seams

- `runInteractivePicker` is the single new seam. It takes an `inputDir` string and returns a `Promise<string[]>`. The `@clack/prompts` call is internal to the function.
- The integration seam is the `--include` flag in the CLI — test that the flag triggers the picker path and wires its result into `config.include` before `processLibrary`.

### What to test

- **Picker function** (`tests/interactive-picker.test.ts`): Unit tests with mocked `@clack/prompts`. Verify: alphabetical sort, empty-dir error, correct prompt title and options passed to `autocompleteMultiselect`, result return, cancel return (empty array).
- **Index integration** (`tests/index.test.ts`): Integration tests verifying the `--include` flag path. Non-TTY fallback logs warning and does not set `include`. TTY path runs picker and wires result into `cliOverrides.include`.

### Prior art

- `tests/config.test.ts` — tests for config loading and CLI override merging
- `tests/utils.test.ts` — unit tests for utility functions with file system dependencies
- `tests/deterministic-search.test.ts` — orchestration tests with mocked provider modules

## Out of Scope

- Docker web UI for folder selection (deferred; noted in README roadmap)
- `config.yaml` include field changes (stays as-is for Docker users and CI)
- Persistence of selections across runs
- Exclude/filter logic beyond the folder selection mechanism
- Page-up/page-down keyboard navigation in the picker
- Pre-selection of folders from previous runs or config

## Further Notes

The wayfinder map [Map: Interactive CLI folder picker for --include](https://github.com/DennisDurairaj/ab-tag-ai/issues/6) and its 3 resolved tickets ([#7](https://github.com/DennisDurairaj/ab-tag-ai/issues/7), [#8](https://github.com/DennisDurairaj/ab-tag-ai/issues/8), [#10](https://github.com/DennisDurairaj/ab-tag-ai/issues/10)) contain the full decision record.

This is a CLI-only change. The Docker image continues to use `config.yaml` for folder selection. A future spec can address interactive folder selection in headless Docker deployments (browser-based UI served from the container).
