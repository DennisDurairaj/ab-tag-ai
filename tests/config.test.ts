import { describe, it, expect, afterEach } from "vitest";
import { loadConfig, mergeCliOverrides, validateConfig } from "../src/config.js";
import { flagForReview } from "../src/agent.js";
import type { Config } from "../src/config.js";
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
    const config = { input: "/input", output: "/output", hardcover_api_key: "test-key", dry_run: false, llm_model: "", log_level: "info" as const };
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
    expect(errors).toContain("hardcover_api_key is required");
  });

  it("returns error when hardcover_api_key is empty", () => {
    const config = { input: "/input", output: "/output", hardcover_api_key: "", dry_run: false, llm_model: "", log_level: "info" as const };
    expect(validateConfig(config)).toContain("hardcover_api_key is required");
  });

  it("returns no hardcover error when key is set", () => {
    const config = { input: "/input", output: "/output", hardcover_api_key: "my-key", dry_run: false, llm_model: "", log_level: "info" as const };
    expect(validateConfig(config)).not.toContain("hardcover_api_key is required");
  });
});

describe("loadConfig — env var override", () => {
  const originalEnv = process.env.HARDCOVER_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HARDCOVER_API_KEY;
    } else {
      process.env.HARDCOVER_API_KEY = originalEnv;
    }
  });

  it("reads HARDCOVER_API_KEY env var when config file has no key", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\n");
    process.env.HARDCOVER_API_KEY = "env-key";
    const config = loadConfig(configPath);
    expect(config.hardcover_api_key).toBe("env-key");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("env var overrides config file value", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\nhardcover_api_key: file-key\n");
    process.env.HARDCOVER_API_KEY = "env-key";
    const config = loadConfig(configPath);
    expect(config.hardcover_api_key).toBe("env-key");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("config file value used when env var not set", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\nhardcover_api_key: file-key\n");
    delete process.env.HARDCOVER_API_KEY;
    const config = loadConfig(configPath);
    expect(config.hardcover_api_key).toBe("file-key");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CLI flag overrides env var end-to-end", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\n");
    process.env.HARDCOVER_API_KEY = "env-key";
    const loaded = loadConfig(configPath);
    expect(loaded.hardcover_api_key).toBe("env-key");
    const merged = mergeCliOverrides(loaded, { hardcover_api_key: "cli-key" });
    expect(merged.hardcover_api_key).toBe("cli-key");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("mergeCliOverrides — hardcover key", () => {
  it("CLI flag overrides env-derived hardcover_api_key", () => {
    const config = { input: "/in", output: "/out", dry_run: false, log_level: "info" as const, hardcover_api_key: "env-key", llm_model: "" };
    const merged = mergeCliOverrides(config, { hardcover_api_key: "cli-key" });
    expect(merged.hardcover_api_key).toBe("cli-key");
  });
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    input: "/tmp/in",
    output: "/tmp/out",
    hardcover_api_key: "key",
    dry_run: false,
    llm_model: "test-model",
    llm_api_key: "",
    llm_api_base_url: "",
    concurrency: 1,
    include: [],
    log_level: "info",
    output_mode: "local",
    abs_url: "",
    abs_api_token: "",
    abs_library_id: "",
    ...overrides,
  };
}

describe("dry-run enforcement", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flagForReview writes file when dry_run is false", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-dryrun-test-"));
    const config = makeConfig({ output: tmpDir, dry_run: false });
    const reviewDir = path.join(tmpDir, "review");

    flagForReview(
      { path: "/tmp", title: "Test Book", author: "Author", asin: "B000" },
      ["/tmp/test.mp3"],
      config,
      "Test reason",
    );

    expect(fs.existsSync(reviewDir)).toBe(true);
    const files = fs.readdirSync(reviewDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("Test_Book");
  });

  it("flagForReview does not write file when dry_run is true", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-dryrun-test-"));
    const config = makeConfig({ output: tmpDir, dry_run: true });

    flagForReview(
      { path: "/tmp", title: "Test Book", author: "Author", asin: "B000" },
      ["/tmp/test.mp3"],
      config,
      "Test reason",
    );

    const reviewDir = path.join(tmpDir, "review");
    expect(fs.existsSync(reviewDir)).toBe(false);
  });
});

describe("loadConfig — ABS_API_TOKEN env var", () => {
  const originalEnv = process.env.ABS_API_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ABS_API_TOKEN;
    } else {
      process.env.ABS_API_TOKEN = originalEnv;
    }
  });

  it("reads ABS_API_TOKEN env var when config file has no token", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\n");
    process.env.ABS_API_TOKEN = "env-abs-token";
    const config = loadConfig(configPath);
    expect(config.abs_api_token).toBe("env-abs-token");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("env var overrides config file abs_api_token", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\nabs_api_token: file-token\n");
    process.env.ABS_API_TOKEN = "env-token";
    const config = loadConfig(configPath);
    expect(config.abs_api_token).toBe("env-token");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("config file value used when ABS_API_TOKEN not set", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /in\noutput: /out\nabs_api_token: file-token\n");
    delete process.env.ABS_API_TOKEN;
    const config = loadConfig(configPath);
    expect(config.abs_api_token).toBe("file-token");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("validateConfig — ABS mode", () => {
  it("validates successfully when output_mode is local with no ABS keys", () => {
    const config = makeConfig({ output_mode: "local", abs_url: "", abs_api_token: "", abs_library_id: "" });
    expect(validateConfig(config)).toEqual([]);
  });

  it("returns errors when output_mode is audiobookshelf and abs_url is missing", () => {
    const config = makeConfig({
      output_mode: "audiobookshelf",
      abs_url: "",
      abs_api_token: "token",
      abs_library_id: "lib-1",
    });
    expect(validateConfig(config)).toContain("abs_url is required when output_mode is 'audiobookshelf'");
  });

  it("returns errors when output_mode is audiobookshelf and abs_api_token is missing", () => {
    const config = makeConfig({
      output_mode: "audiobookshelf",
      abs_url: "https://abs.example.com",
      abs_api_token: "",
      abs_library_id: "lib-1",
    });
    expect(validateConfig(config)).toContain("abs_api_token is required when output_mode is 'audiobookshelf'");
  });

  it("returns errors when output_mode is audiobookshelf and abs_library_id is missing", () => {
    const config = makeConfig({
      output_mode: "audiobookshelf",
      abs_url: "https://abs.example.com",
      abs_api_token: "token",
      abs_library_id: "",
    });
    expect(validateConfig(config)).toContain("abs_library_id is required when output_mode is 'audiobookshelf'");
  });

  it("returns all three abs errors when all missing in audiobookshelf mode", () => {
    const config = makeConfig({
      output_mode: "audiobookshelf",
      abs_url: "",
      abs_api_token: "",
      abs_library_id: "",
    });
    const errors = validateConfig(config);
    expect(errors).toContain("abs_url is required when output_mode is 'audiobookshelf'");
    expect(errors).toContain("abs_api_token is required when output_mode is 'audiobookshelf'");
    expect(errors).toContain("abs_library_id is required when output_mode is 'audiobookshelf'");
  });

  it("returns no ABS errors when all abs_* keys are set in audiobookshelf mode", () => {
    const config = makeConfig({
      output_mode: "audiobookshelf",
      abs_url: "https://abs.example.com",
      abs_api_token: "token",
      abs_library_id: "lib-1",
    });
    expect(validateConfig(config)).toEqual([]);
  });
});

describe("loadConfig — backward compatibility", () => {
  it("existing config without ABS keys loads with defaults", () => {
    const tmpDir = makeTmpDir();
    const configPath = path.join(tmpDir, "config.yaml");
    fs.writeFileSync(configPath, "input: /mnt/audiobooks\noutput: /mnt/output\ndry_run: false\n");
    const config = loadConfig(configPath);
    expect(config.output_mode).toBe("local");
    expect(config.abs_url).toBe("");
    expect(config.abs_api_token).toBe("");
    expect(config.abs_library_id).toBe("");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
