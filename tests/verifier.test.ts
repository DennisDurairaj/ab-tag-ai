import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type { BookSet, AudioFile, ResolvedMetadata } from "../src/types.js";
import { createAsinCache } from "../src/providers/asin.js";
import { createVerifier } from "../src/verifier.js";

vi.mock("../src/utils.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils.js")>("../src/utils.js");
  return { ...actual, delay: vi.fn(() => Promise.resolve()) };
});

vi.mock("../src/providers/cover-art.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/cover-art.js")>("../src/providers/cover-art.js");
  return {
    ...actual,
    downloadAndResizeCover: vi.fn(() => Promise.resolve(null)),
    findLocalCoverArt: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock("../src/orchestrator.js", async () => {
  const actual = await vi.importActual<typeof import("../src/orchestrator.js")>("../src/orchestrator.js");
  return {
    ...actual,
    writeOutputForBook: vi.fn(),
  };
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

function mkMetadata(overrides: Partial<ResolvedMetadata> = {}): ResolvedMetadata {
  return {
    title: "Test Book",
    author: "Author Name",
    asin: "B001TEST01",
    ...overrides,
  };
}

let tmpDir: string;
let outputDir: string;
let asinCache: ReturnType<typeof createAsinCache>;

beforeEach(() => {
  vi.resetAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verifier-test-"));
  outputDir = path.join(tmpDir, "output");
  asinCache = createAsinCache(tmpDir);
});

function createTempFile(dir: string, name: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from("fake mp3 data"));
  return filePath;
}

function setupVerifier(overrides: Partial<Parameters<typeof createVerifier>[0]> = {}) {
  return createVerifier({
    model: "test-model",
    apiKey: "test-key",
    outputDir,
    dryRun: false,
    hardcoverApiKey: "test-hc",
    cache: asinCache,
    outputMode: "local",
    absUrl: "",
    absApiToken: "",
    absLibraryId: "",
    ...overrides,
  });
}

function setupInput(
  dir: string,
  metadata: ResolvedMetadata | null = mkMetadata(),
  reason = "Fuzzy match failed",
  title = "Test Book",
  author = "Author Name",
) {
  const bookDir = path.join(tmpDir, ...dir.split("/"));
  fs.mkdirSync(bookDir, { recursive: true });
  createTempFile(bookDir, "chapter.mp3");
  const filePath = path.join(bookDir, "chapter.mp3");
  const bookSet = mkBookSet([mkFile(filePath)], title, author);

  return {
    bookSet,
    inferredTitle: title,
    inferredAuthor: author,
    metadata,
    reason,
    localCover: null,
  };
}

import { writeOutputForBook } from "../src/orchestrator.js";
const mockWriteOutput = vi.mocked(writeOutputForBook);

describe("verifyBook", () => {
  it("writes output when LLM calls write_output with valid args", async () => {
    const input = setupInput("Author/Test Book");

    mockWriteOutput.mockResolvedValueOnce({
      content: "Written 1 file(s) to /tmp/test",
      terminal: { status: "written", outputDir: "/tmp/test", filesWritten: 1 },
    });

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author Name", asin: "B001TEST01" } },
      ]),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("written");
    expect(mockWriteOutput).toHaveBeenCalledOnce();
    const callMeta = mockWriteOutput.mock.calls[0][0];
    expect(callMeta.title).toBe("Test Book");
    expect(callMeta.author).toBe("Author Name");
    expect(callMeta.asin).toBe("B001TEST01");
  });

  it("writes output with optional series and narrator fields", async () => {
    const input = setupInput("Author/Test Book", mkMetadata({
      series: "The Test Series",
      seriesPart: "3",
      narrator: "Narrator Name",
      coverUrl: "https://example.com/cover.jpg",
    }));

    mockWriteOutput.mockResolvedValueOnce({
      content: "Written 1 file(s) to /tmp/test",
      terminal: { status: "written", outputDir: "/tmp/test", filesWritten: 1 },
    });

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        {
          id: "call_1",
          name: "write_output",
          args: {
            title: "Test Book",
            author: "Author Name",
            asin: "B001TEST01",
            series: "The Test Series",
            seriesPart: "3",
            narrator: "Narrator Name",
            coverUrl: "https://example.com/cover.jpg",
          },
        },
      ]),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("written");
    expect(mockWriteOutput).toHaveBeenCalledOnce();
    const callMeta = mockWriteOutput.mock.calls[0][0];
    expect(callMeta.series).toBe("The Test Series");
    expect(callMeta.seriesPart).toBe("3");
    expect(callMeta.narrator).toBe("Narrator Name");
    expect(callMeta.coverUrl).toBe("https://example.com/cover.jpg");
  });

  it("flags via flag_for_review and writes review file", async () => {
    const input = setupInput("Author/Test Book");

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "flag_for_review", args: { reason: "Provider metadata does not match" } },
      ]),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("Provider metadata does not match");
    }

    const reviewPath = path.join(outputDir, "review", "Test_Book.json");
    expect(fs.existsSync(reviewPath)).toBe(true);
    const reviewData = JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
    expect(reviewData.reason).toBe("Provider metadata does not match");
  });

  it("flag_for_review in dry-run mode should not write file", async () => {
    const input = setupInput("Author/Test Book");

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "flag_for_review", args: { reason: "Cannot verify" } },
      ]),
    }));

    const verifyBook = setupVerifier({
      dryRun: true,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await verifyBook(input);
    expect(result.status).toBe("flagged");

    const reviewPath = path.join(outputDir, "review", "Test_Book.json");
    expect(fs.existsSync(reviewPath)).toBe(false);
  });

  it("auto-flags when no metadata is provided (no ASIN case)", async () => {
    const input = setupInput("Author/Test Book", null, "No ASIN found from any provider");

    const verifyBook = setupVerifier();

    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("No ASIN found from any provider");
    }

    const reviewPath = path.join(outputDir, "review", "Test_Book.json");
    expect(fs.existsSync(reviewPath)).toBe(true);
  });

  it("auto-flags when LLM returns no tool calls", async () => {
    const input = setupInput("Author/Test Book");

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => ({ choices: [{ message: { content: "I am not sure about this one." } }] }),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toBe("I am not sure about this one.");
    }
  });

  it("auto-flags after max iterations without terminal call", async () => {
    const input = setupInput("Author/Test Book");

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "write_output", args: { title: "", author: "", asin: "" } },
      ]),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("Exceeded max iterations");
    }
    expect(fakeFetch).toHaveBeenCalledTimes(5);
  });

  it("returns flagged when API key is missing", async () => {
    const input = setupInput("Author/Test Book");

    vi.stubEnv("LLM_API_KEY", "");

    const verifyBook = setupVerifier({ apiKey: "" });
    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("API key");
    }

    vi.unstubAllEnvs();
  });

  it("auto-flags on LLM HTTP error", async () => {
    const input = setupInput("Author/Test Book");

    const fakeFetch = vi.fn(async () => ({ ok: false, status: 500 }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("flagged");
    if (result.status === "flagged") {
      expect(result.reason).toContain("500");
    }
  });

  it("respects apiBaseUrl config", async () => {
    const input = setupInput("Author/Test Book");

    mockWriteOutput.mockResolvedValueOnce({
      content: "Written 1 file(s) to /tmp/test",
      terminal: { status: "written", outputDir: "/tmp/test", filesWritten: 1 },
    });

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author Name", asin: "B001TEST01" } },
      ]),
    }));

    const verifyBook = setupVerifier({
      apiBaseUrl: "https://custom-llm.example.com/v1",
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    await verifyBook(input);
    const url = fakeFetch.mock.calls[0][0];
    expect(url).toContain("custom-llm.example.com");
  });

  it("write_output in dry-run mode returns DRY-RUN result", async () => {
    const input = setupInput("Author/Test Book");

    mockWriteOutput.mockResolvedValueOnce({
      content: "[DRY-RUN] Would write 1 files to /tmp/test",
      terminal: { status: "written", outputDir: "/tmp/test", filesWritten: 1 },
    });

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author Name", asin: "B001TEST01" } },
      ]),
    }));

    const verifyBook = setupVerifier({
      dryRun: true,
      fetchFn: fakeFetch as unknown as typeof fetch,
    });

    const result = await verifyBook(input);

    expect(result.status).toBe("written");
    expect(mockWriteOutput).toHaveBeenCalledOnce();
  });

  it("handles skipped result from write_output", async () => {
    const input = setupInput("Author/Test Book");

    mockWriteOutput.mockResolvedValueOnce({
      content: "Skipped: duplicate",
      terminal: { status: "skipped", outputDir: "/tmp/test", reason: "Duplicate title+author" },
    });

    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: () => mockChatResponse(null, [
        { id: "call_1", name: "write_output", args: { title: "Test Book", author: "Author Name", asin: "B001TEST01" } },
      ]),
    }));

    const verifyBook = setupVerifier({ fetchFn: fakeFetch as unknown as typeof fetch });
    const result = await verifyBook(input);

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toBe("Duplicate title+author");
    }
  });
});
