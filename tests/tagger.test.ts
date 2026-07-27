import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import id3 from "node-id3";
import {
  tagMultiFileSet,
  writeId3Tags,
  writeFfmetadata,
  assignTrackNumbers,
} from "../src/taggers/index.js";
import type { AudioFile, ResolvedMetadata } from "../src/types.js";

let tmpDir: string;

function setupTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-tagger-test-"));
  return tmpDir;
}

function createDummyMp3(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const minimalMp3 = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  fs.writeFileSync(filePath, minimalMp3);
}

function makeAudioFile(filePath: string): AudioFile {
  return {
    path: filePath,
    format: "mp3",
    existingMetadata: {},
  };
}

function makeResolvedMetadata(overrides: Partial<ResolvedMetadata> = {}): ResolvedMetadata {
  return {
    title: "Test Book",
    author: "Test Author",
    asin: "B000000001",
    ...overrides,
  };
}

function expectSeriesTags(tags: Record<string, unknown>, series: string, seriesPart: string): void {
  const txxx = (tags.raw as Record<string, unknown>)?.TXXX as Array<{ description: string; value: string }>;
  expect(Array.isArray(txxx)).toBe(true);
  const seriesFrame = txxx.find((f) => f.description === "series");
  const seriesPartFrame = txxx.find((f) => f.description === "series-part");
  expect(seriesFrame?.value).toBe(series);
  expect(seriesPartFrame?.value).toBe(seriesPart);
}

function createTestMp3Files(dir: string, names: string[]): AudioFile[] {
  return names.map((name) => {
    const filePath = path.join(dir, name);
    createDummyMp3(filePath);
    return makeAudioFile(filePath);
  });
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("assignTrackNumbers", () => {
  it("assigns sequential track numbers alphabetically by filename", () => {
    setupTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "chapter03.mp3")),
      makeAudioFile(path.join(tmpDir, "chapter01.mp3")),
      makeAudioFile(path.join(tmpDir, "chapter02.mp3")),
    ];

    const result = assignTrackNumbers(files);

    expect(result[0].trackNumber).toBe(1);
    expect(result[1].trackNumber).toBe(2);
    expect(result[2].trackNumber).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(assignTrackNumbers([])).toEqual([]);
  });

  it("handles single file", () => {
    setupTmpDir();
    const files = [makeAudioFile(path.join(tmpDir, "single.mp3"))];

    const result = assignTrackNumbers(files);

    expect(result).toHaveLength(1);
    expect(result[0].trackNumber).toBe(1);
  });
});

describe("writeId3Tags", () => {
  it("writes basic tags to an MP3 file", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "test.mp3");
    createDummyMp3(filePath);

    const result = writeId3Tags(filePath, {
      title: "Chapter One",
      album: "Test Book",
      artist: "Test Author",
      trackNumber: "1",
    });

    expect(result).toBe(true);

    const tags = id3.read(filePath);
    expect(tags.title).toBe("Chapter One");
    expect(tags.album).toBe("Test Book");
    expect(tags.artist).toBe("Test Author");
    expect(tags.trackNumber).toBe("1");
  });

  it("writes TXXX custom frames for series", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "test.mp3");
    createDummyMp3(filePath);

    const result = writeId3Tags(filePath, {
      title: "Chapter One",
      album: "Test Book",
      artist: "Test Author",
      trackNumber: "1",
      series: "Test Series",
      seriesPart: "2",
    });

    expect(result).toBe(true);

    const tags = id3.read(filePath);
    expect(tags.title).toBe("Chapter One");
    expectSeriesTags(tags, "Test Series", "2");
  });

  it("writes APIC cover art when provided", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "test.mp3");
    createDummyMp3(filePath);

    const coverBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    const result = writeId3Tags(filePath, {
      title: "Chapter One",
      album: "Test Book",
      artist: "Test Author",
      trackNumber: "1",
      coverArt: coverBuffer,
    });

    expect(result).toBe(true);

    const tags = id3.read(filePath);
    expect(tags.image).toBeDefined();
    expect(tags.image?.imageBuffer).toBeDefined();
  });

  it("returns false for non-existent file", () => {
    const result = writeId3Tags("/nonexistent/file.mp3", {
      title: "Test",
      album: "Test",
      artist: "Test",
      trackNumber: "1",
    });

    expect(result).toBe(false);
  });
});

describe("tagMultiFileSet", () => {
  it("tags all files with shared album and individual titles", () => {
    setupTmpDir();
    const files = createTestMp3Files(tmpDir, ["Book - 01.mp3", "Book - 02.mp3", "Book - 03.mp3"]);

    const metadata = makeResolvedMetadata({
      title: "The Great Book",
      author: "Great Author",
      series: "Great Series",
      seriesPart: "1",
    });

    tagMultiFileSet(files, metadata);

    for (const file of files) {
      const tags = id3.read(file.path);
      expect(tags.album).toBe("The Great Book");
      expect(tags.artist).toBe("Great Author");
    }

    const tags1 = id3.read(files[0].path);
    const tags2 = id3.read(files[1].path);
    const tags3 = id3.read(files[2].path);

    expect(tags1.trackNumber).toBe("1");
    expect(tags2.trackNumber).toBe("2");
    expect(tags3.trackNumber).toBe("3");
  });

  it("writes series TXXX frames to all files", () => {
    setupTmpDir();
    const files = createTestMp3Files(tmpDir, ["Book - 01.mp3", "Book - 02.mp3"]);

    const metadata = makeResolvedMetadata({
      series: "My Series",
      seriesPart: "3",
    });

    tagMultiFileSet(files, metadata);

    for (const file of files) {
      const tags = id3.read(file.path);
      expectSeriesTags(tags, "My Series", "3");
    }
  });

  it("embeds cover art in all files when provided", () => {
    setupTmpDir();
    const files = createTestMp3Files(tmpDir, ["Book - 01.mp3", "Book - 02.mp3"]);

    const coverBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const metadata = makeResolvedMetadata();

    tagMultiFileSet(files, metadata, coverBuffer);

    for (const file of files) {
      const tags = id3.read(file.path);
      expect(tags.image).toBeDefined();
      expect(tags.image?.imageBuffer).toBeDefined();
    }
  });

  it("handles files without series metadata", () => {
    setupTmpDir();
    const files = createTestMp3Files(tmpDir, ["Book - 01.mp3"]);

    const metadata = makeResolvedMetadata();

    tagMultiFileSet(files, metadata);

    const tags = id3.read(files[0].path);
    expect(tags.album).toBe(metadata.title);
    expect(tags.artist).toBe(metadata.author);
  });

  it("uses per-file titles from existing metadata when available", () => {
    setupTmpDir();
    const files: AudioFile[] = [
      {
        path: path.join(tmpDir, "Book - 01.mp3"),
        format: "mp3",
        existingMetadata: { title: "Chapter One: The Beginning" },
      },
      {
        path: path.join(tmpDir, "Book - 02.mp3"),
        format: "mp3",
        existingMetadata: { title: "Chapter Two: The Middle" },
      },
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

    const metadata = makeResolvedMetadata({ title: "The Complete Book" });

    tagMultiFileSet(files, metadata);

    const tags1 = id3.read(files[0].path);
    const tags2 = id3.read(files[1].path);

    expect(tags1.album).toBe("The Complete Book");
    expect(tags2.album).toBe("The Complete Book");
    expect(tags1.title).toBe("Chapter One: The Beginning");
    expect(tags2.title).toBe("Chapter Two: The Middle");
  });

  it("falls back to filename-based title when no existing title", () => {
    setupTmpDir();
    const files: AudioFile[] = [
      {
        path: path.join(tmpDir, "Book - 01.mp3"),
        format: "mp3",
        existingMetadata: {},
      },
    ];

    createDummyMp3(files[0].path);

    const metadata = makeResolvedMetadata({ title: "The Complete Book" });

    tagMultiFileSet(files, metadata);

    const tags = id3.read(files[0].path);
    expect(tags.album).toBe("The Complete Book");
    expect(tags.title).toBe("Book - 01");
  });
});

function createDummyM4b(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  execSync(
    `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -c:a aac "${filePath}" -y`,
    { stdio: "ignore" },
  );
}

function readM4bTags(filePath: string): Record<string, string> {
  const output = execSync(
    `ffprobe -v quiet -print_format json -show_format "${filePath}"`,
    { encoding: "utf-8" },
  );
  const parsed = JSON.parse(output);
  return (parsed.format?.tags || {}) as Record<string, string>;
}

function makeM4bFile(filePath: string): AudioFile {
  return {
    path: filePath,
    format: "m4b" as const,
    existingMetadata: {},
  };
}

describe("writeFfmetadata", () => {
  it("writes basic tags to an M4B file", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "test.m4b");
    createDummyM4b(filePath);

    const result = writeFfmetadata(filePath, {
      title: "Chapter One",
      album: "Test Book",
      artist: "Test Author",
      trackNumber: "1",
    });

    expect(result).toBe(true);

    const tags = readM4bTags(filePath);
    expect(tags.title).toBe("Chapter One");
    expect(tags.album).toBe("Test Book");
    expect(tags.artist).toBe("Test Author");
    expect(tags.track).toBe("1");
  });

  it("returns false for non-existent file", () => {
    const result = writeFfmetadata("/nonexistent/file.m4b", {
      title: "Test",
      album: "Test",
      artist: "Test",
      trackNumber: "1",
    });

    expect(result).toBe(false);
  });
});

describe("tagMultiFileSet — M4B dispatch", () => {
  it("tags M4B files via ffmpeg instead of node-id3", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "audiobook.m4b");
    createDummyM4b(filePath);

    const files: AudioFile[] = [makeM4bFile(filePath)];
    const metadata = makeResolvedMetadata({
      title: "The Great Book",
      author: "Great Author",
    });

    tagMultiFileSet(files, metadata);

    const tags = readM4bTags(filePath);
    expect(tags.album).toBe("The Great Book");
    expect(tags.artist).toBe("Great Author");
  });

  it("tags multi-file M4B set with shared album and sequential track numbers", () => {
    setupTmpDir();
    const file1 = path.join(tmpDir, "book-01.m4b");
    const file2 = path.join(tmpDir, "book-02.m4b");
    createDummyM4b(file1);
    createDummyM4b(file2);

    const files: AudioFile[] = [makeM4bFile(file1), makeM4bFile(file2)];
    const metadata = makeResolvedMetadata({
      title: "The Complete Book",
      author: "Test Author",
    });

    tagMultiFileSet(files, metadata);

    const tags1 = readM4bTags(file1);
    const tags2 = readM4bTags(file2);

    expect(tags1.album).toBe("The Complete Book");
    expect(tags2.album).toBe("The Complete Book");
    expect(tags1.track).toBe("1");
    expect(tags2.track).toBe("2");
  });

  it("uses per-file titles from existing metadata for M4B", () => {
    setupTmpDir();
    const filePath = path.join(tmpDir, "audiobook.m4b");
    createDummyM4b(filePath);

    const files: AudioFile[] = [
      {
        path: filePath,
        format: "m4b",
        existingMetadata: { title: "Chapter One: The Beginning" },
      },
    ];

    const metadata = makeResolvedMetadata({ title: "The Complete Book" });

    tagMultiFileSet(files, metadata);

    const tags = readM4bTags(filePath);
    expect(tags.title).toBe("Chapter One: The Beginning");
    expect(tags.album).toBe("The Complete Book");
  });
});
