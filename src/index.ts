#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { loadConfig, mergeCliOverrides, validateConfig } from "./config.js";
import { processLibrary } from "./agent.js";
import { setLogLevel, setLogFileWriter, error as logErr, warn as logWarn, dryRun, success } from "./logger.js";
import { LogFileWriter } from "./log-file-writer.js";
import { runInteractivePicker } from "./interactive-picker.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("abmeta")
    .description("Organize audiobook files with metadata, cover art, and proper directory structure")
    .version("0.1.0")
    .option("-c, --config <path>", "Path to YAML config file", "config.yaml")
    .option("-i, --input <path>", "Input directory containing audiobook files")
    .option("-o, --output <path>", "Output directory for organized audiobooks")
    .option("--hardcover-key <key>", "Hardcover API key")
    .option("--llm-key <key>", "LLM API key")
    .option("--llm-base-url <url>", "LLM API base URL")
    .option("--concurrency <n>", "Number of books to process in parallel", "4")
    .option("--include", "Interactively select folders to process")
    .option("--dry-run", "Preview changes without writing to disk", false)
    .option("--log-level <level>", "Logging level (debug, info, warn, error)", "info")
    .option("--abs-url <url>", "Audiobookshelf server URL")
    .option("--abs-token <token>", "Audiobookshelf API token")
    .option("--abs-library-id <id>", "Audiobookshelf library ID")
    .parse(process.argv);

  const options = program.opts();

  const configPath = path.resolve(options.config);
  let config = loadConfig(configPath);

  const cliOverrides: Record<string, unknown> = {};
  if (options.input) cliOverrides.input = options.input;
  if (options.output) cliOverrides.output = options.output;
  if (options.hardcoverKey) cliOverrides.hardcover_api_key = options.hardcoverKey;
  if (options.dryRun !== undefined) cliOverrides.dry_run = options.dryRun;
  if (options.logLevel) cliOverrides.log_level = options.logLevel;
  if (options.llmKey) cliOverrides.llm_api_key = options.llmKey;
  if (options.llmBaseUrl) cliOverrides.llm_api_base_url = options.llmBaseUrl;
  if (options.concurrency) cliOverrides.concurrency = Number(options.concurrency);
  if (options.absUrl) cliOverrides.abs_url = options.absUrl;
  if (options.absToken) cliOverrides.abs_api_token = options.absToken;
  if (options.absLibraryId) cliOverrides.abs_library_id = options.absLibraryId;

  config = mergeCliOverrides(config, cliOverrides as Partial<typeof config>);

  if (options.include) {
    const inputPath = config.input;
    if (!inputPath || !fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
      logErr("--include requires a valid input directory. Set input path via --input or config.yaml.");
      program.help({ error: true });
    }

    if (process.stdin.isTTY) {
      const selected = await runInteractivePicker(inputPath);
      if (selected.length > 0) {
        cliOverrides.include = selected;
        config = mergeCliOverrides(config, cliOverrides as Partial<typeof config>);
        success(`Processing ${selected.length} folder${selected.length === 1 ? "" : "s"}: ${selected.join(" / ")}`);
      } else {
        logWarn("No folders selected. Run without --include to process all folders.");
      }
    } else {
      logWarn("--include requires an interactive terminal. Processing all folders instead.");
    }
  }

  setLogLevel(config.log_level);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    logErr("Configuration errors:");
    for (const e of errors) {
      logErr(`  - ${e}`);
    }
    program.help({ error: true });
  }

  config.output = path.resolve(config.output);

  const logWriter = new LogFileWriter(config.output);
  logWriter.startup(new Date());
  setLogFileWriter(logWriter);

  if (config.dry_run) {
    dryRun("DRY RUN mode — no files will be modified.");
  }

  await processLibrary(config);
}

export { main };

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    logErr(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}