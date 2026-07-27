import { describe, it, expect } from "vitest";
import { inferBookIdentity } from "../src/inference.js";
import type { AudioFile } from "../src/types.js";

function mkFile(filePath: string, meta: Record<string, string> = {}): AudioFile {
  return { path: filePath, format: "mp3", existingMetadata: meta };
}

describe("inferBookIdentity", () => {
  it("uses directory name as title over tag title (folder is ground truth)", () => {
    const files = [mkFile("/input/Author/Book/file.mp3", { title: "Tagged Title" })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Book");
  });

  it("uses directory name as title over tag album", () => {
    const files = [mkFile("/input/Author/Book/file.mp3", { album: "Tagged Album" })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Book");
  });

  it("uses directory name as title when no tags present", () => {
    const files = [mkFile("/input/Riordan, Rick/The Lightning Thief/ch01.mp3")];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("The Lightning Thief");
  });

  it("uses filename stem as title when file is directly in input dir", () => {
    const files = [mkFile("/input/Some_Book.mp3")];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Some Book");
  });

  it("prefers folder-path author over tag artist (narrator in tag)", () => {
    const files = [mkFile("/input/Author/Book/file.mp3", { artist: "Narrator Name" })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.author).toBe("Author");
  });

  it("derives author from folder path when no tag artist", () => {
    const files = [mkFile("/input/Riordan, Rick/The Lightning Thief/ch01.mp3")];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.author).toBe("Riordan, Rick");
  });

  it("derives author from top-level folder in Author/Series/Book structure", () => {
    const files = [mkFile("/input/Riordan, Rick/The Trials of Apollo/Book 1/ch01.mp3")];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.author).toBe("Riordan, Rick");
    expect(identity.title).toBe("Book 1");
  });

  it("returns empty author when file is directly in input dir", () => {
    const files = [mkFile("/input/file.mp3")];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.author).toBe("");
  });

  it("skips whitespace-only title and album, uses filename stem for direct input file", () => {
    const files = [mkFile("/input/Some_Book.mp3", { title: "  ", album: "  " })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Some Book");
  });

  it("skips whitespace-only album tag and falls through to trimmed title", () => {
    const files = [mkFile("/input/Some_Book.mp3", { title: "Real Chapter ", album: "  " })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Real Chapter");
  });

  it("skips whitespace-only artist tag", () => {
    const files = [mkFile("/input/file.mp3", { artist: "  " })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.author).toBe("");
  });

  it("uses dirName even when tag has values (folder is ground truth)", () => {
    const files = [mkFile("/input/Author/Book/file.mp3", { title: "  ", album: "Real Title" })];
    const identity = inferBookIdentity(files, "/input");
    expect(identity.title).toBe("Book");
  });
});
