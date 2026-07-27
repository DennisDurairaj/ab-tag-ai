import { describe, it, expect, afterEach } from "vitest";
import { slugify, formatBytes, ensureDir } from "../src/utils";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("slugify", () => {
  it("converts a simple title to a slug", () => {
    expect(slugify("The Trial of the Knight")).toBe("the-trial-of-the-knight");
  });

  it("handles non-ASCII characters", () => {
    expect(slugify("Łódź Podróże")).toBe("łódź-podróże");
  });

  it("trims and lowercases", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slugify("one   two  three")).toBe("one-two-three");
  });

  it("removes leading and trailing hyphens", () => {
    expect(slugify("  ---test---  ")).toBe("test");
  });
});

describe("formatBytes", () => {
  it("returns bytes for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });
});

describe("ensureDir", () => {
  const tmpDir = path.join(os.tmpdir(), `audiobook-ensure-${Date.now()}`);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a directory that does not exist", () => {
    const target = path.join(tmpDir, "sub", "dir");
    ensureDir(target);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("does not throw when directory already exists", () => {
    const target = path.join(tmpDir, "existing");
    fs.mkdirSync(target, { recursive: true });
    expect(() => ensureDir(target)).not.toThrow();
  });
});