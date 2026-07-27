import { describe, it, expect } from "vitest";
import { loadConfig, mergeCliOverrides, validateConfig } from "../src/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-test-"));
}

describe("loadConfig", () => {
  it("returns defaults when config file does not exist", () => {
    const tmpDir = makeTmpDir();
    const config = loadConfig(path.join(tmpDir, "missing.yaml"));
    expect(config.input).toBe("");
    expect(config.output).toBe("");
    expect(config.dry_run).toBe(false);
    expect(config.log_level).toBe("info");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads values from a valid YAML config file", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /mnt/audiobooks\noutput: /mnt/output\ndry_run: true\n");
    const config = loadConfig(configPath);
    expect(config.input).toBe("/mnt/audiobooks");
    expect(config.output).toBe("/mnt/output");
    expect(config.dry_run).toBe(true);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preserves default values when not overridden by config file", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /mnt/audible\n");
    const config = loadConfig(configPath);
    expect(config.output).toBe("");
    expect(config.log_level).toBe("info");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("mergeCliOverrides", () => {
  it("CLI flags override config file values", () => {
    const config = { input: "/config/input", output: "/config/output", dry_run: false, log_level: "info" as const, hardcover_api_key: "", llm_model: "" };
    const merged = mergeCliOverrides(config, { input: "/cli/input", dry_run: true });
    expect(merged.input).toBe("/cli/input");
    expect(merged.dry_run).toBe(true);
    expect(merged.output).toBe("/config/output");
  });

  it("does not override values not provided in CLI", () => {
    const config = { input: "/config/input", output: "/config/output", dry_run: false, log_level: "info" as const, hardcover_api_key: "", llm_model: "" };
    const merged = mergeCliOverrides(config, { input: "/cli/input" });
    expect(merged.output).toBe("/config/output");
    expect(merged.log_level).toBe("info");
  });
});

describe("validateConfig", () => {
  it("returns no errors for a valid config", () => {
    const config = { input: "/input", output: "/output", hardcover_api_key: "", dry_run: false, llm_model: "", log_level: "info" as const };
    expect(validateConfig(config)).toEqual([]);
  });

  it("returns errors when input is missing", () => {
    const config = { input: "", output: "/output", hardcover_api_key: "", dry_run: false, llm_model: "", log_level: "info" as const };
    expect(validateConfig(config)).toContain("input path is required");
  });

  it("returns errors when output is missing", () => {
    const config = { input: "/input", output: "", hardcover_api_key: "", dry_run: false, llm_model: "", log_level: "info" as const };
    expect(validateConfig(config)).toContain("output path is required");
  });

  it("returns both errors when input and output are missing", () => {
    const config = { input: "", output: "", hardcover_api_key: "", dry_run: false, llm_model: "", log_level: "info" as const };
    const errors = validateConfig(config);
    expect(errors).toContain("input path is required");
    expect(errors).toContain("output path is required");
  });
});