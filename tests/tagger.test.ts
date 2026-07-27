import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import id3 from "node-id3";
import {
  tagMultiFileSet,
  writeId3Tags,
  assignTrackNumbers,
} from "../src/taggers/index.js";
import type { AudioFile, ResolvedMetadata } from "../src/types.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audiobook-tagger-test-"));
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

describe("assignTrackNumbers", () => {
  it("assigns sequential track numbers alphabetically by filename", () => {
    const tmpDir = makeTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "chapter03.mp3")),
      makeAudioFile(path.join(tmpDir, "chapter01.mp3")),
      makeAudioFile(path.join(tmpDir, "chapter02.mp3")),
    ];

    const result = assignTrackNumbers(files);

    expect(result[0].trackNumber).toBe(1);
    expect(result[1].trackNumber).toBe(2);
    expect(result[2].trackNumber).toBe(3);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for empty input", () => {
    expect(assignTrackNumbers([])).toEqual([]);
  });

  it("handles single file", () => {
    const tmpDir = makeTmpDir();
    const files = [makeAudioFile(path.join(tmpDir, "single.mp3"))];

    const result = assignTrackNumbers(files);

    expect(result).toHaveLength(1);
    expect(result[0].trackNumber).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("writeId3Tags", () => {
  it("writes basic tags to an MP3 file", () => {
    const tmpDir = makeTmpDir();
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

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes TXXX custom frames for series", () => {
    const tmpDir = makeTmpDir();
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
    expect(tags.raw?.TXXX).toBeDefined();
    const txxx = tags.raw?.TXXX as Array<{ description: string; value: string }>;
    expect(Array.isArray(txxx)).toBe(true);
    const seriesFrame = txxx.find((f) => f.description === "series");
    const seriesPartFrame = txxx.find((f) => f.description === "series-part");
    expect(seriesFrame?.value).toBe("Test Series");
    expect(seriesPartFrame?.value).toBe("2");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes APIC cover art when provided", () => {
    const tmpDir = makeTmpDir();
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

    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    const tmpDir = makeTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "Book - 01.mp3")),
      makeAudioFile(path.join(tmpDir, "Book - 02.mp3")),
      makeAudioFile(path.join(tmpDir, "Book - 03.mp3")),
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

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

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes series TXXX frames to all files", () => {
    const tmpDir = makeTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "Book - 01.mp3")),
      makeAudioFile(path.join(tmpDir, "Book - 02.mp3")),
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

    const metadata = makeResolvedMetadata({
      series: "My Series",
      seriesPart: "3",
    });

    tagMultiFileSet(files, metadata);

    for (const file of files) {
      const tags = id3.read(file.path);
      const txxx = tags.raw?.TXXX as Array<{ description: string; value: string }>;
      expect(Array.isArray(txxx)).toBe(true);
      const seriesFrame = txxx.find((f) => f.description === "series");
      const seriesPartFrame = txxx.find((f) => f.description === "series-part");
      expect(seriesFrame?.value).toBe("My Series");
      expect(seriesPartFrame?.value).toBe("3");
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("embeds cover art in all files when provided", () => {
    const tmpDir = makeTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "Book - 01.mp3")),
      makeAudioFile(path.join(tmpDir, "Book - 02.mp3")),
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

    const coverBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const metadata = makeResolvedMetadata();

    tagMultiFileSet(files, metadata, coverBuffer);

    for (const file of files) {
      const tags = id3.read(file.path);
      expect(tags.image).toBeDefined();
      expect(tags.image?.imageBuffer).toBeDefined();
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles files without series metadata", () => {
    const tmpDir = makeTmpDir();
    const files = [
      makeAudioFile(path.join(tmpDir, "Book - 01.mp3")),
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

    const metadata = makeResolvedMetadata();

    tagMultiFileSet(files, metadata);

    const tags = id3.read(files[0].path);
    expect(tags.album).toBe(metadata.title);
    expect(tags.artist).toBe(metadata.author);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses per-file titles from existing metadata when available", () => {
    const tmpDir = makeTmpDir();
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

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to filename-based title when no existing title", () => {
    const tmpDir = makeTmpDir();
    const files: AudioFile[] = [
      {
        path: path.join(tmpDir, "Book - 01.mp3"),
        format: "mp3",
        existingMetadata: {},
      },
    ];

    for (const file of files) {
      createDummyMp3(file.path);
    }

    const metadata = makeResolvedMetadata({ title: "The Complete Book" });

    tagMultiFileSet(files, metadata);

    const tags = id3.read(files[0].path);
    expect(tags.album).toBe("The Complete Book");
    expect(tags.title).toBe("Book - 01");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
