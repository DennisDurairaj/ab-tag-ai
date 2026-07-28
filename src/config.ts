import fs from "node:fs";
import yaml from "js-yaml";
import type { LogLevel } from "./types.js";

export interface Config {
  input: string;
  output: string;
  hardcover_api_key: string;
  dry_run: boolean;
  llm_model: string;
  llm_api_key: string;
  llm_api_base_url: string;
  concurrency: number;
  include: string[];
  log_level: LogLevel;
  output_mode: "local" | "audiobookshelf";
  abs_url: string;
  abs_api_token: string;
  abs_library_id: string;
}

const DEFAULT_CONFIG: Config = {
  input: "",
  output: "",
  hardcover_api_key: "",
  dry_run: false,
  llm_model: "",
  llm_api_key: "",
  llm_api_base_url: "",
  concurrency: 1,
  include: [],
  log_level: "info",
  output_mode: "local",
  abs_url: "",
  abs_api_token: "",
  abs_library_id: "",
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
  if (process.env.HARDCOVER_API_KEY) {
    overrides.hardcover_api_key = process.env.HARDCOVER_API_KEY;
  }
  if (process.env.LLM_API_KEY) {
    overrides.llm_api_key = process.env.LLM_API_KEY;
  }
  if (process.env.LLM_API_BASE_URL) {
    overrides.llm_api_base_url = process.env.LLM_API_BASE_URL;
  }
  if (process.env.ABS_API_TOKEN) {
    overrides.abs_api_token = process.env.ABS_API_TOKEN;
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
  if (config.output_mode === "audiobookshelf") {
    if (!config.abs_url) {
      errors.push("abs_url is required when output_mode is 'audiobookshelf'");
    }
    if (!config.abs_api_token) {
      errors.push("abs_api_token is required when output_mode is 'audiobookshelf'");
    }
    if (!config.abs_library_id) {
      errors.push("abs_library_id is required when output_mode is 'audiobookshelf'");
    }
  }
  return errors;
}