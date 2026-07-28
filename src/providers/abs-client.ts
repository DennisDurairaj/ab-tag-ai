import fs from "node:fs";
import path from "node:path";

export interface AbsClientConfig {
  url: string;
  apiToken: string;
  libraryId: string;
}

export interface AbsUploadResult {
  id: string;
  libraryItemId: string;
}

export interface AbsSearchItem {
  libraryItem: {
    id: string;
    media: {
      metadata: {
        title?: string;
        author?: string;
        authorName?: string;
        series?: Array<{ name: string }>;
        seriesName?: string;
        asin?: string;
      };
    };
  };
}

export interface AbsSearchResult {
  book: AbsSearchItem[];
}

export interface AbsMediaUpdatePayload {
  asin?: string;
  series?: string;
  seriesPart?: string;
}

export interface AbsMatchPayload {
  provider: string;
  asin: string;
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
}

function authHeaders(apiToken: string): Record<string, string> {
  return { Authorization: `Bearer ${apiToken}` };
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
      const formData = new FormData();
      formData.append("library", libraryId);
      formData.append("folder", folderId);
      formData.append("title", title);
      formData.append("author", author);
      if (series) formData.append("series", series);

      for (let i = 0; i < files.length; i++) {
        const buffer = await fs.promises.readFile(files[i]);
        const name = fileNames?.[i] ?? path.basename(files[i]);
        formData.append(String(i), new File([buffer], name));
      }

      const response = await fetchFn(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: authHeaders(config.apiToken),
        body: formData,
      });

      await checkResponse(response);

      // The ABS upload endpoint returns 200 with an empty body on success.
      // No IDs are returned — we must poll/lookup the item after upload.
      return { id: "", libraryItemId: "" };
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
  };
}
