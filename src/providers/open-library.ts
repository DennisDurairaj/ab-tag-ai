import { validateAsin } from "./asin.js";
import { delay } from "../utils.js";
import type { BookIdentity } from "../types.js";

const OPEN_LIBRARY_DELAY_MS = 1100;
const OPEN_LIBRARY_SEARCH_FIELDS = "key,title,author_name,isbn,cover_i";
const OPEN_LIBRARY_SEARCH_LIMIT = 5;
const OPEN_LIBRARY_EDITIONS_LIMIT = 5;

interface OpenLibrarySearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
}

interface OpenLibraryEdition {
  isbn_10?: string[];
  isbn_13?: string[];
}

export interface OpenLibraryBook {
  key: string;
  title: string;
  authorName: string[];
  firstPublishYear: number;
  coverId: number;
  isbn: string[];
  publisher: string[];
  language: string[];
  subject: string[];
  editionCount: number;
}

export async function searchOpenLibraryAsin(
  identity: BookIdentity,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const query = `${identity.title} ${identity.author}`;
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=${OPEN_LIBRARY_SEARCH_FIELDS}&limit=${OPEN_LIBRARY_SEARCH_LIMIT}`;

    const response = await fetchFn(url);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      numFound: number;
      docs?: OpenLibrarySearchDoc[];
    };

    if (!data.docs || data.docs.length === 0) return null;

    for (const doc of data.docs) {
      const asin = await tryEditionsEndpoint(doc.key, fetchFn);
      if (asin) return asin;
    }

    for (const doc of data.docs) {
      if (!doc.isbn) continue;
      const found = doc.isbn.find(validateAsin);
      if (found) return found;
    }

    return null;
  } catch {
    return null;
  } finally {
    await delay(OPEN_LIBRARY_DELAY_MS);
  }
}

async function tryEditionsEndpoint(
  workKey: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  try {
    const url = `https://openlibrary.org${workKey}/editions.json?limit=${OPEN_LIBRARY_EDITIONS_LIMIT}`;
    const response = await fetchFn(url);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      entries?: OpenLibraryEdition[];
    };

    if (!data.entries || data.entries.length === 0) return null;

    for (const entry of data.entries) {
      if (entry.isbn_10) {
        const found = entry.isbn_10.find(validateAsin);
        if (found) return found;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    await delay(OPEN_LIBRARY_DELAY_MS);
  }
}

export async function searchOpenLibraryByIsbn(
  isbn: string,
  fetchFn: typeof fetch = fetch,
): Promise<OpenLibraryBook | null> {
  try {
    const url = `https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=key,title,author_name,first_publish_year,cover_i,isbn,publisher,language,subject,edition_count`;
    const response = await fetchFn(url);

    if (!response.ok) return null;

    const data = (await response.json()) as {
      numFound: number;
      docs?: Array<{
        key: string;
        title: string;
        author_name?: string[];
        first_publish_year?: number;
        cover_i?: number;
        isbn?: string[];
        publisher?: string[];
        language?: string[];
        subject?: string[];
        edition_count?: number;
      }>;
    };

    if (!data.docs || data.docs.length === 0) return null;

    const doc = data.docs[0];
    return {
      key: doc.key,
      title: doc.title,
      authorName: doc.author_name || [],
      firstPublishYear: doc.first_publish_year || 0,
      coverId: doc.cover_i || 0,
      isbn: doc.isbn || [],
      publisher: doc.publisher || [],
      language: doc.language || [],
      subject: doc.subject || [],
      editionCount: doc.edition_count || 0,
    };
  } catch {
    return null;
  }
}
