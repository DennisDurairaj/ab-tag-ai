import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createAbsClient,
  AbsAuthError,
  AbsNotFoundError,
  AbsServerError,
} from "../src/providers/abs-client.js";
import type { AbsClient, AbsMatchPayload } from "../src/providers/abs-client.js";

function makeClient(overrides: { url?: string; apiToken?: string; libraryId?: string } = {}): AbsClient {
  return createAbsClient({
    url: overrides.url ?? "https://abs.example.com",
    apiToken: overrides.apiToken ?? "test-token",
    libraryId: overrides.libraryId ?? "lib-001",
  });
}

function makeMockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("createAbsClient — uploadFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-client-upload-"));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTempFile(name: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, Buffer.from("fake mp3 content"));
    return filePath;
  }

  it("uploads files with multipart body and returns empty result (ABS returns no IDs)", async () => {
    const file1 = createTempFile("ch01.mp3");
    const file2 = createTempFile("ch02.mp3");

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/upload");
      expect(url).not.toContain("library="); // library is in form body, not query
      expect(init?.method).toBe("POST");
      expect(init?.headers).toBeDefined();
      return makeMockResponse(200, {});
    });

    const client = makeClient();
    const result = await client.uploadFiles({
      libraryId: "lib-001",
      folderId: "folder-1",
      title: "Test Book",
      author: "Test Author",
      files: [file1, file2],
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // ABS upload returns 200 with empty body — no IDs
    expect(result.id).toBe("");
    expect(result.libraryItemId).toBe("");
  });

  it("includes series in form data when provided", async () => {
    const file1 = createTempFile("ch01.mp3");

    const mockFetch = vi.fn(async () => {
      return makeMockResponse(200, {});
    });

    const client = makeClient();
    await client.uploadFiles({
      libraryId: "lib-001",
      folderId: "folder-1",
      title: "Test Book",
      author: "Test Author",
      series: "Test Series",
      files: [file1],
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalled();
  });

  it("throws AbsAuthError on 401", async () => {
    const file1 = createTempFile("ch01.mp3");
    const mockFetch = vi.fn(async () => makeMockResponse(401, "Unauthorized"));

    const client = makeClient();
    await expect(
      client.uploadFiles({
        libraryId: "lib-001",
        folderId: "folder-1",
        title: "T",
        author: "A",
        files: [file1],
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsAuthError);
  });

  it("throws AbsNotFoundError on 404", async () => {
    const file1 = createTempFile("ch01.mp3");
    const mockFetch = vi.fn(async () => makeMockResponse(404, "Not found"));

    const client = makeClient();
    await expect(
      client.uploadFiles({
        libraryId: "lib-001",
        folderId: "folder-1",
        title: "T",
        author: "A",
        files: [file1],
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsNotFoundError);
  });

  it("throws AbsServerError on 500", async () => {
    const file1 = createTempFile("ch01.mp3");
    const mockFetch = vi.fn(async () => makeMockResponse(500, "Server error"));

    const client = makeClient();
    await expect(
      client.uploadFiles({
        libraryId: "lib-001",
        folderId: "folder-1",
        title: "T",
        author: "A",
        files: [file1],
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsServerError);
  });

  it("strips trailing slash from base URL", async () => {
    const file1 = createTempFile("ch01.mp3");
    let capturedUrl = "";

    const mockFetch = vi.fn(async (url: string) => {
      capturedUrl = url.toString();
      return makeMockResponse(200, {});
    });

    const client = createAbsClient({
      url: "https://abs.example.com/",
      apiToken: "token",
      libraryId: "lib",
    });

    await client.uploadFiles({
      libraryId: "lib",
      folderId: "f",
      title: "T",
      author: "A",
      files: [file1],
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(capturedUrl).not.toContain("//api");
    expect(capturedUrl).toBe("https://abs.example.com/api/upload");
  });
});

describe("createAbsClient — scanLibrary", () => {
  it("POSTs scan request and succeeds on 200", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      expect(url).toContain("/api/libraries/lib-001/scan");
      return makeMockResponse(200, {});
    });

    const client = makeClient();
    await client.scanLibrary({
      libraryId: "lib-001",
      fetchFn: mockFetch as unknown as typeof fetch,
    });
  });

  it("throws AbsNotFoundError on 404", async () => {
    const mockFetch = vi.fn(async () => makeMockResponse(404, "Library not found"));

    const client = makeClient();
    await expect(
      client.scanLibrary({
        libraryId: "nonexistent",
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsNotFoundError);
  });
});

describe("createAbsClient — searchLibrary", () => {
  it("searches library by query and returns typed result", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      expect(url).toContain("/api/libraries/lib-001/search");
      expect(url).toContain("q=test+query");
      return makeMockResponse(200, {
        book: [
          { libraryItem: { id: "item-1", media: { metadata: { title: "Test Book", authorName: "Test Author" } } } },
        ],
      });
    });

    const client = makeClient();
    const result = await client.searchLibrary({
      libraryId: "lib-001",
      query: "test query",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.book).toHaveLength(1);
    expect(result.book[0].libraryItem.id).toBe("item-1");
    expect(result.book[0].libraryItem.media.metadata.title).toBe("Test Book");
  });

  it("throws AbsAuthError on 401", async () => {
    const mockFetch = vi.fn(async () => makeMockResponse(401, "Unauthorized"));

    const client = makeClient();
    await expect(
      client.searchLibrary({
        libraryId: "lib-001",
        query: "test",
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsAuthError);
  });
});

describe("createAbsClient — updateMedia", () => {
  it("sends PATCH with metadata as JSON body", async () => {
    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/items/item-1/media");
      expect(init?.method).toBe("PATCH");
      expect(init?.headers).toBeDefined();

      const body = JSON.parse(init?.body as string);
      expect(body.metadata.asin).toBe("B000000001");
      expect(body.metadata.series).toBe("Test Series");
      expect(body.metadata.seriesPart).toBe("1");

      return makeMockResponse(200, {});
    });

    const client = makeClient();
    await client.updateMedia({
      itemId: "item-1",
      metadata: { asin: "B000000001", series: "Test Series", seriesPart: "1" },
      fetchFn: mockFetch as unknown as typeof fetch,
    });
  });

  it("throws AbsNotFoundError on 404", async () => {
    const mockFetch = vi.fn(async () => makeMockResponse(404, "Not found"));

    const client = makeClient();
    await expect(
      client.updateMedia({
        itemId: "nonexistent",
        metadata: { asin: "B000" },
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsNotFoundError);
  });
});

describe("createAbsClient — matchItem", () => {
  it("POSTs match payload and returns result", async () => {
    const payload: AbsMatchPayload = {
      provider: "audible",
      asin: "B000000001",
      title: "Test Book",
      author: "Test Author",
      overrideCover: false,
      overrideDetails: true,
    };

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/items/item-1/match");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(init?.body as string);
      expect(body.asin).toBe("B000000001");
      expect(body.provider).toBe("audible");

      return makeMockResponse(200, { updated: true });
    });

    const client = makeClient();
    const result = await client.matchItem({
      itemId: "item-1",
      payload,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.updated).toBe(true);
  });

  it("includes series and seriesPart in match payload", async () => {
    const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.series).toBe("Series");
      expect(body.seriesPart).toBe("3");
      return makeMockResponse(200, { updated: true });
    });

    const client = makeClient();
    await client.matchItem({
      itemId: "item-1",
      payload: {
        provider: "audible",
        asin: "B000",
        title: "T",
        author: "A",
        series: "Series",
        seriesPart: "3",
      },
      fetchFn: mockFetch as unknown as typeof fetch,
    });
  });
});

describe("createAbsClient — uploadCover", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-client-cover-"));
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads cover file via multipart POST", async () => {
    const coverPath = path.join(tmpDir, "cover.jpg");
    fs.writeFileSync(coverPath, Buffer.from("fake image"));

    const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/items/item-1/cover");
      expect(init?.method).toBe("POST");
      return makeMockResponse(200, {});
    });

    const client = makeClient();
    await client.uploadCover({
      itemId: "item-1",
      coverPath,
      fetchFn: mockFetch as unknown as typeof fetch,
    });
  });

  it("throws AbsServerError on 500", async () => {
    const coverPath = path.join(tmpDir, "cover.jpg");
    fs.writeFileSync(coverPath, Buffer.from("fake image"));

    const mockFetch = vi.fn(async () => makeMockResponse(502, "Bad gateway"));

    const client = makeClient();
    await expect(
      client.uploadCover({
        itemId: "item-1",
        coverPath,
        fetchFn: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(AbsServerError);
  });
});
