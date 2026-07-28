import path from "node:path";
import { Command } from "commander";
import { loadConfig, mergeCliOverrides, validateConfig } from "./config.js";
import { processLibrary } from "./agent.js";
import { setLogLevel, error as logErr, dryRun } from "./logger.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("audiobook-organizer")
    .description("Organize audiobook files with metadata, cover art, and proper directory structure")
    .version("0.1.0")
    .option("-c, --config <path>", "Path to YAML config file", "config.yaml")
    .option("-i, --input <path>", "Input directory containing audiobook files")
    .option("-o, --output <path>", "Output directory for organized audiobooks")
    .option("--hardcover-key <key>", "Hardcover API key")
    .option("--llm-key <key>", "LLM API key")
    .option("--llm-base-url <url>", "LLM API base URL")
    .option("--concurrency <n>", "Number of books to process in parallel", "4")
    .option("--include <patterns>", "Comma-separated author names or patterns to include")
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
  if (options.include) cliOverrides.include = options.include.split(",").map((s: string) => s.trim());
  if (options.absUrl) cliOverrides.abs_url = options.absUrl;
  if (options.absToken) cliOverrides.abs_api_token = options.absToken;
  if (options.absLibraryId) cliOverrides.abs_library_id = options.absLibraryId;

  config = mergeCliOverrides(config, cliOverrides as Partial<typeof config>);

  setLogLevel(config.log_level);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    logErr("Configuration errors:");
    for (const e of errors) {
      logErr(`  - ${e}`);
    }
    program.help({ error: true });
  }

  if (config.dry_run) {
    dryRun("DRY RUN mode — no files will be modified.");
  }

  await processLibrary(config);
}

main().catch((err: unknown) => {
  logErr(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});