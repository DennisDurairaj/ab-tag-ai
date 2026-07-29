import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export interface AbsClientConfig {
  url: string;
  apiToken: string;
  libraryId: string;
}

export interface AbsUploadResult {
  id: string;
  libraryItemId: string;
}

export interface AbsItemMetadata {
  [key: string]: unknown;
  title?: string;
  author?: string;
  authorName?: string;
  series?: Array<{ name: string; sequence?: string }>;
  seriesName?: string;
  asin?: string;
  description?: string;
  genres?: string[];
  publisher?: string;
  language?: string;
  isbn?: string;
  narratorName?: string;
}

export interface AbsSearchItem {
  libraryItem: {
    id: string;
    media: {
      metadata: AbsItemMetadata;
    };
  };
}

export interface AbsSearchResult {
  book: AbsSearchItem[];
}

export interface AbsMediaUpdatePayload {
  asin?: string;
  title?: string;
  authors?: Array<{ name: string }>;
  isbn?: string;
  narrators?: string[];
  description?: string;
  genres?: string[];
  publisher?: string;
  language?: string;
  series?: Array<{ name: string; sequence?: string }>;
}

export interface AbsMatchPayload {
  provider: string;
  asin?: string;
  title: string;
  author: string;
  series?: string;
  seriesPart?: string;
  overrideCover?: boolean;
  overrideDetails?: boolean;
}

export interface AbsMatchResult {
  updated: boolean;
}

export interface AbsLibraryFolder {
  id: string;
  fullPath: string;
}

export interface AbsLibraryInfo {
  id: string;
  name: string;
  folders: AbsLibraryFolder[];
}

export class AbsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbsAuthError";
  }
}

export class AbsNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbsNotFoundError";
  }
}

export class AbsServerError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AbsServerError";
  }
}

export class AbsRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbsRateLimitError";
  }
}

export interface AbsClient {
  getLibrary(params: {
    libraryId: string;
    fetchFn?: typeof fetch;
  }): Promise<AbsLibraryInfo>;

  uploadFiles(params: {
    libraryId: string;
    folderId: string;
    title: string;
    author: string;
    series?: string;
    files: string[];
    fileNames?: string[];
    fetchFn?: typeof fetch;
  }): Promise<AbsUploadResult>;

  scanLibrary(params: {
    libraryId: string;
    fetchFn?: typeof fetch;
  }): Promise<void>;

  searchLibrary(params: {
    libraryId: string;
    query: string;
    fetchFn?: typeof fetch;
  }): Promise<AbsSearchResult>;

  updateMedia(params: {
    itemId: string;
    metadata: AbsMediaUpdatePayload;
    fetchFn?: typeof fetch;
  }): Promise<void>;

  matchItem(params: {
    itemId: string;
    payload: AbsMatchPayload;
    fetchFn?: typeof fetch;
  }): Promise<AbsMatchResult>;

  uploadCover(params: {
    itemId: string;
    coverPath: string;
    fetchFn?: typeof fetch;
  }): Promise<void>;

  getItem(params: {
    itemId: string;
    fetchFn?: typeof fetch;
  }): Promise<AbsSearchItem>;
}

function authHeaders(apiToken: string): Record<string, string> {
  return { Authorization: `Bearer ${apiToken}` };
}

function mimeForFile(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4b") return "audio/mp4";
  return "application/octet-stream";
}

function buildMultipartBody(
  fields: Array<[string, string]>,
  fileEntries: Array<{ path: string; name: string; fieldName: string }>,
  boundary: string,
): ReadableStream<Uint8Array> {
  async function* generate(): AsyncGenerator<Uint8Array> {
    const enc = new TextEncoder();
    const crlf = enc.encode("\r\n");

    for (const [name, value] of fields) {
      yield enc.encode(`--${boundary}\r\n`);
      yield enc.encode(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
      yield enc.encode(value);
      yield crlf;
    }

    for (const file of fileEntries) {
      yield enc.encode(`--${boundary}\r\n`);
      yield enc.encode(
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.name}"\r\n`,
      );
      yield enc.encode(`Content-Type: ${mimeForFile(file.name)}\r\n\r\n`);

      const stream = fs.createReadStream(file.path, { highWaterMark: 256 * 1024 });
      for await (const chunk of stream) {
        yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      }

      yield crlf;
    }

    yield enc.encode(`--${boundary}--\r\n`);
  }

  return Readable.toWeb(Readable.from(generate())) as ReadableStream<Uint8Array>;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;

  const body = await response.text().catch(() => "");
  if (response.status === 401) {
    throw new AbsAuthError(body || "Unauthorized — check your ABS_API_TOKEN");
  }
  if (response.status === 404) {
    throw new AbsNotFoundError(body || "Not found");
  }
  if (response.status === 429) {
    throw new AbsRateLimitError(body || "Rate limited");
  }
  if (response.status >= 500) {
    throw new AbsServerError(body || "Audiobookshelf server error", response.status);
  }
  throw new Error(`Unexpected response ${response.status}: ${body}`);
}

export function createAbsClient(config: AbsClientConfig): AbsClient {
  const baseUrl = stripTrailingSlash(config.url);

  return {
    async getLibrary({ libraryId, fetchFn = fetch }) {
      const response = await fetchFn(
        `${baseUrl}/api/libraries/${encodeURIComponent(libraryId)}`,
        { headers: authHeaders(config.apiToken) },
      );

      await checkResponse(response);
      return (await response.json()) as AbsLibraryInfo;
    },

    async uploadFiles({ libraryId, folderId, title, author, series, files, fileNames, fetchFn = fetch }) {
      const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

      const body = buildMultipartBody(
        [
          ["library", libraryId],
          ["folder", folderId],
          ["title", title],
          ["author", author],
          ...(series ? [["series", series] as [string, string]] : []),
        ],
        files.map((fp, i) => ({
          path: fp,
          name: fileNames?.[i] ?? path.basename(fp),
          fieldName: String(i),
        })),
        boundary,
      );

      const response = await fetchFn(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: {
          ...authHeaders(config.apiToken),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
        duplex: "half",
      } as Parameters<typeof fetchFn>[1]);

      await checkResponse(response);

      try {
        const data = (await response.json()) as { id?: string; libraryItemId?: string };
        return { id: data.id || "", libraryItemId: data.libraryItemId || "" };
      } catch {
        return { id: "", libraryItemId: "" };
      }
    },

    async scanLibrary({ libraryId, fetchFn = fetch }) {
      const response = await fetchFn(
        `${baseUrl}/api/libraries/${encodeURIComponent(libraryId)}/scan`,
        {
          method: "POST",
          headers: authHeaders(config.apiToken),
        },
      );

      // scan returns 200 even if already scanning; 404 if library not found
      if (response.status === 404) {
        throw new AbsNotFoundError(`Library ${libraryId} not found`);
      }

      if (!response.ok) {
        await checkResponse(response);
      }
    },

    async searchLibrary({ libraryId, query, fetchFn = fetch }) {
      const params = new URLSearchParams({ q: query });
      const response = await fetchFn(
        `${baseUrl}/api/libraries/${encodeURIComponent(libraryId)}/search?${params.toString()}`,
        { headers: authHeaders(config.apiToken) },
      );

      await checkResponse(response);
      return (await response.json()) as AbsSearchResult;
    },

    async updateMedia({ itemId, metadata, fetchFn = fetch }) {
      const response = await fetchFn(
        `${baseUrl}/api/items/${encodeURIComponent(itemId)}/media`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders(config.apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ metadata }),
        },
      );

      await checkResponse(response);
    },

    async matchItem({ itemId, payload, fetchFn = fetch }) {
      const response = await fetchFn(
        `${baseUrl}/api/items/${encodeURIComponent(itemId)}/match`,
        {
          method: "POST",
          headers: {
            ...authHeaders(config.apiToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      await checkResponse(response);
      return (await response.json()) as AbsMatchResult;
    },

    async uploadCover({ itemId, coverPath, fetchFn = fetch }) {
      const buffer = await fs.promises.readFile(coverPath);
      const formData = new FormData();
      formData.append("cover", new File([buffer], path.basename(coverPath)));

      const response = await fetchFn(
        `${baseUrl}/api/items/${encodeURIComponent(itemId)}/cover`,
        {
          method: "POST",
          headers: authHeaders(config.apiToken),
          body: formData,
        },
      );

      await checkResponse(response);
    },

    async getItem({ itemId, fetchFn = fetch }) {
      const response = await fetchFn(
        `${baseUrl}/api/items/${encodeURIComponent(itemId)}?expanded=1`,
        { headers: authHeaders(config.apiToken) },
      );

      await checkResponse(response);
      return (await response.json()) as AbsSearchItem;
    },
  };
}
