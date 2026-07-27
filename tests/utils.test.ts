import { describe, it, expect, afterEach } from "vitest";
import { ensureDir, buildBookFolderPath } from "../src/utils.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

describe("buildBookFolderPath", () => {
  it("builds Author/Book path without series", () => {
    const result = buildBookFolderPath("/output", "J.K. Rowling", "Harry Potter");
    expect(result).toBe(path.join("/output", "J.K. Rowling", "Harry Potter"));
  });

  it("builds Author/Series/Book path with series", () => {
    const result = buildBookFolderPath("/output", "J.K. Rowling", "Harry Potter", "Harry Potter");
    expect(result).toBe(path.join("/output", "J.K. Rowling", "Harry Potter", "Harry Potter"));
  });

  it("sanitizes invalid path characters from author", () => {
    const result = buildBookFolderPath("/output", "Author: Test", "Book");
    expect(result).toBe(path.join("/output", "Author Test", "Book"));
  });

  it("sanitizes invalid path characters from title", () => {
    const result = buildBookFolderPath("/output", "Author", "Book: Subtitle");
    expect(result).toBe(path.join("/output", "Author", "Book Subtitle"));
  });

  it("uses Unknown Author when author is empty", () => {
    const result = buildBookFolderPath("/output", "", "Book");
    expect(result).toBe(path.join("/output", "Unknown Author", "Book"));
  });

  it("uses Unknown Title when title is empty", () => {
    const result = buildBookFolderPath("/output", "Author", "");
    expect(result).toBe(path.join("/output", "Author", "Unknown Title"));
  });

  it("preserves non-ASCII characters", () => {
    const result = buildBookFolderPath("/output", "Łukasz", "Podróż");
    expect(result).toBe(path.join("/output", "Łukasz", "Podróż"));
  });
});