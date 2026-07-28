import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, AudioFile } from "../src/types.js";
import { createPathInterpreter } from "../src/path-interpreter.js";

vi.mock("../src/utils.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils.js")>("../src/utils.js");
  return { ...actual, delay: vi.fn(() => Promise.resolve()) };
});

function mkFile(filePath: string, meta: Record<string, string> = {}): AudioFile {
  return { path: filePath, format: "mp3", existingMetadata: meta };
}

function mkBookSet(files: AudioFile[], title = "Unknown Book", author = ""): BookSet {
  return { books: [{ path: files[0].path, title, author, asin: "" }], files };
}

function mockChatResponse(content: string | null, toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
  const message: Record<string, unknown> = {};
  if (content) message.content = content;
  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
  }
  return { choices: [{ message }] };
}

let tmpDir: string;
let outputDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-interpreter-test-"));
  outputDir = path.join(tmpDir, "output");
});

function createTempFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from("fake mp3 data"));
  return filePath;
}

describe("interpretPath", () => {
  it("resolves title and author via set_title_author", async () => {
    const bookDir = path.join(tmpDir, "Pratchett, Terry", "Discworld", "Guards! Guards!");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "set_title_author", args: { title: "Guards! Guards!", author: "Terry Pratchett" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.title).toBe("Guards! Guards!");
      expect(result.author).toBe("Terry Pratchett");
    }
  });

  it("resolves title and author with ID3 hint when path is sparse", async () => {
    const bookDir = path.join(tmpDir, "Unknown Author");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"), {
      title: "Some Book Title",
      artist: "Famous Author",
    })]);

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "set_title_author", args: { title: "Some Book Title", author: "Famous Author" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.title).toBe("Some Book Title");
      expect(result.author).toBe("Famous Author");
    }
  });

  it("flags via flag_for_review and writes review file", async () => {
    const bookDir = path.join(tmpDir, "garbage");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))], "garbage");

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "flag_for_review", args: { reason: "Cannot determine title or author from path" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("Cannot determine title or author from path");
    }

    const reviewPath = path.join(outputDir, "review", "garbage.json");
    expect(fs.existsSync(reviewPath)).toBe(true);
    const reviewData = JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
    expect(reviewData.reason).toBe("Cannot determine title or author from path");
    expect(reviewData.title).toBe("garbage");
  });

  it("flag_for_review in dry-run mode should not write file", async () => {
    const bookDir = path.join(tmpDir, "garbage");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))], "garbage");

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "flag_for_review", args: { reason: "Cannot interpret" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: true,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");

    const reviewPath = path.join(outputDir, "review", "garbage.json");
    expect(fs.existsSync(reviewPath)).toBe(false);
  });

  it("auto-flags when LLM returns no tool calls", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return { ok: true, json: () => ({ choices: [{ message: { content: "Done!" } }] }) };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("Done!");
    }
  });

  it("auto-flags after max iterations without terminal call", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "set_title_author", args: { title: "", author: "" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("Exceeded max iterations");
    }
    expect(fakeFetch).toHaveBeenCalledTimes(5);
  });

  it("returns flagged when API key is missing", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    vi.stubEnv("LLM_API_KEY", "");

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "",
      outputDir,
      dryRun: false,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("API key");
    }

    vi.unstubAllEnvs();
  });

  it("returns flagged on LLM HTTP error", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return { ok: false, status: 500 };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await interpretPath(bookSet);
    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("500");
    }
  });

  it("respects apiBaseUrl config", async () => {
    const bookDir = path.join(tmpDir, "Author", "Book");
    fs.mkdirSync(bookDir, { recursive: true });
    createTempFile(bookDir, "chapter.mp3");
    const bookSet = mkBookSet([mkFile(path.join(bookDir, "chapter.mp3"))]);

    const fakeFetch = vi.fn(async () => {
      return {
        ok: true,
        json: () => mockChatResponse(null, [
          { id: "call_1", name: "set_title_author", args: { title: "Book", author: "Author" } },
        ]),
      };
    });

    const interpretPath = createPathInterpreter({
      model: "test-model",
      apiKey: "test-key",
      apiBaseUrl: "https://custom-llm.example.com/v1",
      outputDir,
      dryRun: false,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    await interpretPath(bookSet);
    const url = fakeFetch.mock.calls[0][0];
    expect(url).toContain("custom-llm.example.com");
  });
});
