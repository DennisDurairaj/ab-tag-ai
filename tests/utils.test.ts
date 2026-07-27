import { describe, it, expect, afterEach } from "vitest";
import { ensureDir, buildBookFolderPath, writeCoverArt, copyFilesToOutput } from "../src/utils.js";
import { tagMultiFileSet } from "../src/taggers/index.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import id3 from "node-id3";
import type { AudioFile, ResolvedMetadata } from "../src/types.js";

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

function createDummyMp3(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const minimalMp3 = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  fs.writeFileSync(filePath, minimalMp3);
}

describe("copyFilesToOutput", () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies a standalone book to Author/Book/", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-copy-test-"));
    const inputDir = path.join(tmpDir, "input", "Riordan, Rick", "The Lightning Thief");
    const outputDir = path.join(tmpDir, "output");
    const sourcePath = path.join(inputDir, "ch01.mp3");
    createDummyMp3(sourcePath);

    const files: AudioFile[] = [{ path: sourcePath, format: "mp3", existingMetadata: {} }];
    const bookDir = buildBookFolderPath(outputDir, "Riordan, Rick", "The Lightning Thief");
    const copied = copyFilesToOutput(files, bookDir);

    const expectedPath = path.join(bookDir, "ch01.mp3");
    expect(copied[0].path).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("copies a series book to Author/Series/Book/", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-copy-test-"));
    const inputDir = path.join(tmpDir, "input", "Riordan, Rick", "The Trials of Apollo", "Book 1");
    const outputDir = path.join(tmpDir, "output");
    const sourcePath = path.join(inputDir, "ch01.mp3");
    createDummyMp3(sourcePath);

    const files: AudioFile[] = [{ path: sourcePath, format: "mp3", existingMetadata: {} }];
    const bookDir = buildBookFolderPath(outputDir, "Riordan, Rick", "Book 1", "The Trials of Apollo");
    const copied = copyFilesToOutput(files, bookDir);

    const expectedPath = path.join(bookDir, "ch01.mp3");
    expect(copied[0].path).toBe(expectedPath);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it("preserves source file tags after copy-then-tag", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-copy-test-"));
    const inputDir = path.join(tmpDir, "input", "Author", "Book");
    const outputDir = path.join(tmpDir, "output");
    const sourcePath = path.join(inputDir, "ch01.mp3");
    createDummyMp3(sourcePath);

    id3.write({ title: "Original Title", artist: "Original Artist" }, sourcePath);
    const sourceTagsBefore = id3.read(sourcePath) as Record<string, string>;

    const files: AudioFile[] = [{ path: sourcePath, format: "mp3", existingMetadata: { title: "Original Title", artist: "Original Artist" } }];
    const bookDir = buildBookFolderPath(outputDir, "Author", "Book");
    const copied = copyFilesToOutput(files, bookDir);

    const metadata: ResolvedMetadata = { title: "New Book", author: "New Author", asin: "B000002IX7" };
    tagMultiFileSet(copied, metadata);

    const sourceTagsAfter = id3.read(sourcePath) as Record<string, string>;
    expect(sourceTagsAfter.title).toBe(sourceTagsBefore.title);
    expect(sourceTagsAfter.artist).toBe(sourceTagsBefore.artist);

    const copyTags = id3.read(copied[0].path) as Record<string, string>;
    expect(copyTags.title).toBe("Original Title");
    expect(copyTags.album).toBe("New Book");
    expect(copyTags.artist).toBe("New Author");
  });

  it("copies all files in a multi-file set", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-copy-test-"));
    const inputDir = path.join(tmpDir, "input", "Author", "Book");
    const outputDir = path.join(tmpDir, "output");
    const source1 = path.join(inputDir, "ch01.mp3");
    const source2 = path.join(inputDir, "ch02.mp3");
    createDummyMp3(source1);
    createDummyMp3(source2);

    const files: AudioFile[] = [
      { path: source1, format: "mp3", existingMetadata: {} },
      { path: source2, format: "mp3", existingMetadata: {} },
    ];
    const bookDir = buildBookFolderPath(outputDir, "Author", "Book");
    const copied = copyFilesToOutput(files, bookDir);

    expect(copied).toHaveLength(2);
    expect(fs.existsSync(path.join(bookDir, "ch01.mp3"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "ch02.mp3"))).toBe(true);
  });
});