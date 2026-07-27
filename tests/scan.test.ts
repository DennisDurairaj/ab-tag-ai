import { describe, it, expect, afterEach } from "vitest";
import { scanForAudioFiles, detectMultiFileSets } from "../src/scanner.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-scan-test-"));
}

function touchFile(filePath: string, content: string = ""): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("scanForAudioFiles", () => {
  it("returns empty array for non-existent directory", () => {
    const result = scanForAudioFiles("/nonexistent/path/12345");
    expect(result).toEqual([]);
  });

  it("finds MP3 files recursively", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "book1", "chapter01.mp3"));
    touchFile(path.join(tmpDir, "book1", "chapter02.mp3"));
    touchFile(path.join(tmpDir, "other.txt"));

    const result = scanForAudioFiles(tmpDir);
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.format === "mp3")).toBe(true);
    expect(result.map((f) => f.path)).toContain(path.join(tmpDir, "book1", "chapter01.mp3"));
    expect(result.map((f) => f.path)).toContain(path.join(tmpDir, "book1", "chapter02.mp3"));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds M4B files recursively", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "book1", "audiobook.m4b"));

    const result = scanForAudioFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeDefined();
    expect(result[0].format).toBe("m4b");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ignores non-audio files", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "readme.txt"));
    touchFile(path.join(tmpDir, "cover.jpg"));

    const result = scanForAudioFiles(tmpDir);
    expect(result).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("infers metadata from filename when no ID3 tags present", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "book", "track.mp3"));

    const result = scanForAudioFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].existingMetadata).toEqual({ title: "track" });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("infers author and title from filename with dash separator", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "Stephen King - It.mp3"));

    const result = scanForAudioFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].existingMetadata).toEqual({ artist: "Stephen King", title: "It" });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("detectMultiFileSets", () => {
  it("returns empty array when no files", () => {
    expect(detectMultiFileSets([])).toEqual([]);
  });

  it("returns empty array when only single files in a directory", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "book1.mp3"));

    const files = scanForAudioFiles(tmpDir);
    expect(detectMultiFileSets(files)).toEqual([]);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects files sharing a common prefix in the same directory", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "The Hobbit - 01.mp3"));
    touchFile(path.join(tmpDir, "The Hobbit - 02.mp3"));

    const files = scanForAudioFiles(tmpDir);
    const sets = detectMultiFileSets(files);

    expect(sets).toHaveLength(1);
    expect(sets[0].commonStem).toBe("The Hobbit -");
    expect(sets[0].files).toHaveLength(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not group files from different directories", () => {
    const tmpDir = makeTmpDir();
    touchFile(path.join(tmpDir, "book1", "chapter01.mp3"));
    touchFile(path.join(tmpDir, "book2", "chapter01.mp3"));

    const files = scanForAudioFiles(tmpDir);
    const sets = detectMultiFileSets(files);

    expect(sets).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});