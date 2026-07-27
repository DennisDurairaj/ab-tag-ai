import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { ensureDir, buildBookFolderPath, writeCoverArt, copyFilesToOutput, classifySidecar } from "../src/utils.js";
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

describe("classifySidecar", () => {
  it("returns useful for .nfo files", () => {
    expect(classifySidecar("book.nfo")).toBe("useful");
    expect(classifySidecar("BOOK.NFO")).toBe("useful");
    expect(classifySidecar("My Book.NFO")).toBe("useful");
  });

  it("returns useful for .cue files", () => {
    expect(classifySidecar("book.cue")).toBe("useful");
    expect(classifySidecar("BOOK.cue")).toBe("useful");
  });

  it("returns useful for .json files", () => {
    expect(classifySidecar("book.json")).toBe("useful");
    expect(classifySidecar("metadata.json")).toBe("useful");
  });

  it("returns useful for synopsis files", () => {
    expect(classifySidecar("synopsis.txt")).toBe("useful");
    expect(classifySidecar("Synopsis.pdf")).toBe("useful");
    expect(classifySidecar("my synopsis doc.txt")).toBe("useful");
    expect(classifySidecar("SYNOPSIS")).toBe("useful");
  });

  it("returns junk for .txt files", () => {
    expect(classifySidecar("readme.txt")).toBe("junk");
    expect(classifySidecar("support.txt")).toBe("junk");
  });

  it("returns junk for desktop.ini", () => {
    expect(classifySidecar("desktop.ini")).toBe("junk");
    expect(classifySidecar("Desktop.ini")).toBe("junk");
  });

  it("returns junk for Icon.ico", () => {
    expect(classifySidecar("Icon.ico")).toBe("junk");
    expect(classifySidecar("icon.ico")).toBe("junk");
  });

  it("returns null for unrelated files", () => {
    expect(classifySidecar("book.jpg")).toBe(null);
    expect(classifySidecar("chapter01.mp3")).toBe(null);
    expect(classifySidecar("cover.png")).toBe(null);
    expect(classifySidecar("random.file")).toBe(null);
  });
});

describe("copyFilesToOutput sidecar behavior", () => {
  let tmpDir: string;
  let sourceDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-sidecar-test-"));
    sourceDir = path.join(tmpDir, "input", "Author", "Book");
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies useful sidecar files alongside audio", () => {
    createDummyMp3(path.join(sourceDir, "ch01.mp3"));
    fs.writeFileSync(path.join(sourceDir, "book.nfo"), "NFO content");
    fs.writeFileSync(path.join(sourceDir, "book.cue"), "CUE content");
    fs.writeFileSync(path.join(sourceDir, "metadata.json"), '{"key":"val"}');

    const files: AudioFile[] = [{
      path: path.join(sourceDir, "ch01.mp3"),
      format: "mp3",
      existingMetadata: {},
    }];
    const bookDir = path.join(tmpDir, "output", "Author", "Book");

    copyFilesToOutput(files, bookDir);

    expect(fs.existsSync(path.join(bookDir, "ch01.mp3"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "book.nfo"))).toBe(true);
    expect(fs.readFileSync(path.join(bookDir, "book.nfo"), "utf-8")).toBe("NFO content");
    expect(fs.existsSync(path.join(bookDir, "book.cue"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "metadata.json"))).toBe(true);
  });

  it("does not copy junk sidecar files", () => {
    createDummyMp3(path.join(sourceDir, "ch01.mp3"));
    fs.writeFileSync(path.join(sourceDir, "readme.txt"), "ignore me");
    fs.writeFileSync(path.join(sourceDir, "desktop.ini"), "junk");
    fs.writeFileSync(path.join(sourceDir, "Icon.ico"), "icon bytes");

    const files: AudioFile[] = [{
      path: path.join(sourceDir, "ch01.mp3"),
      format: "mp3",
      existingMetadata: {},
    }];
    const bookDir = path.join(tmpDir, "output", "Author", "Book");

    copyFilesToOutput(files, bookDir);

    expect(fs.existsSync(path.join(bookDir, "ch01.mp3"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "readme.txt"))).toBe(false);
    expect(fs.existsSync(path.join(bookDir, "desktop.ini"))).toBe(false);
    expect(fs.existsSync(path.join(bookDir, "Icon.ico"))).toBe(false);
  });

  it("copies only useful sidecars from a dir with mixed files", () => {
    createDummyMp3(path.join(sourceDir, "ch01.mp3"));
    fs.writeFileSync(path.join(sourceDir, "book.nfo"), "nfo");
    fs.writeFileSync(path.join(sourceDir, "synopsis.txt"), "synopsis text");
    fs.writeFileSync(path.join(sourceDir, "readme.txt"), "readme");
    fs.writeFileSync(path.join(sourceDir, "desktop.ini"), "ini");
    fs.writeFileSync(path.join(sourceDir, "cover.jpg"), "not sidecar");
    fs.writeFileSync(path.join(sourceDir, "random.doc"), "not sidecar");

    const files: AudioFile[] = [{
      path: path.join(sourceDir, "ch01.mp3"),
      format: "mp3",
      existingMetadata: {},
    }];
    const bookDir = path.join(tmpDir, "output", "Author", "Book");

    copyFilesToOutput(files, bookDir);

    expect(fs.existsSync(path.join(bookDir, "ch01.mp3"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "book.nfo"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "synopsis.txt"))).toBe(true);
    expect(fs.existsSync(path.join(bookDir, "readme.txt"))).toBe(false);
    expect(fs.existsSync(path.join(bookDir, "desktop.ini"))).toBe(false);
    expect(fs.existsSync(path.join(bookDir, "cover.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(bookDir, "random.doc"))).toBe(false);
  });

  it("handles source dir with no sidecars", () => {
    createDummyMp3(path.join(sourceDir, "ch01.mp3"));

    const files: AudioFile[] = [{
      path: path.join(sourceDir, "ch01.mp3"),
      format: "mp3",
      existingMetadata: {},
    }];
    const bookDir = path.join(tmpDir, "output", "Author", "Book");

    expect(() => copyFilesToOutput(files, bookDir)).not.toThrow();

    expect(fs.existsSync(path.join(bookDir, "ch01.mp3"))).toBe(true);
    const entries = fs.readdirSync(bookDir);
    expect(entries).toHaveLength(1);
  });
});