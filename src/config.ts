import fs from "node:fs";
import yaml from "js-yaml";
import type { LogLevel } from "./types.js";

export interface Config {
  input: string;
  output: string;
  hardcover_api_key: string;
  dry_run: boolean;
  llm_model: string;
  log_level: LogLevel;
}

const DEFAULT_CONFIG: Config = {
  input: "",
  output: "",
  hardcover_api_key: "",
  dry_run: false,
  llm_model: "",
  log_level: "info",
};

export function loadConfig(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, ...envOverrides() };
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = yaml.load(raw) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...parsed, ...envOverrides() };
}

function envOverrides(): Partial<Config> {
  const overrides: Partial<Config> = {};
  if (process.env.HARDACOVER_API_KEY) {
    overrides.hardcover_api_key = process.env.HARDACOVER_API_KEY;
  }
  return overrides;
}

export function mergeCliOverrides(config: Config, overrides: Partial<Config>): Config {
  return { ...config, ...overrides };
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];
  if (!config.input) {
    errors.push("input path is required");
  }
  if (!config.output) {
    errors.push("output path is required");
  }
  if (!config.hardcover_api_key) {
    errors.push("hardcover_api_key is required");
  }
  return errors;
}