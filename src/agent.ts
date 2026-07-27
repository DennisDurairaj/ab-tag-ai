import type { Config } from "./config.js";
import type { BookSet, AudioFile } from "./types.js";
import { scanForAudioFiles, detectMultiFileSets } from "./scanner.js";

export async function processLibrary(config: Config): Promise<void> {
  const files = scanForAudioFiles(config.input);
  const bookSets = groupIntoBooks(files);

  printSummary(bookSets);

  for (const bookSet of bookSets) {
    await processBook(bookSet, config);
  }
}

function groupIntoBooks(files: AudioFile[]): BookSet[] {
  const sets = detectMultiFileSets(files);
  const result: BookSet[] = [];

  const multiFilePaths = new Set<string>();
  for (const set of sets) {
    for (const file of set.files) {
      multiFilePaths.add(file.path);
    }
  }

  for (const set of sets) {
    result.push({ books: [], files: set.files });
  }

  for (const file of files) {
    if (!multiFilePaths.has(file.path)) {
      result.push({ books: [], files: [file] });
    }
  }

  return result;
}

function printSummary(bookSets: BookSet[]): void {
  const totalBooks = bookSets.length;
  const totalFiles = bookSets.reduce((sum, set) => sum + set.files.length, 0);
  const filesMissingMetadata = bookSets.flatMap((set) =>
    set.files.filter((f) => Object.keys(f.existingMetadata).length === 0)
  );

  console.log(`Found ${totalBooks} book(s) across ${totalFiles} audio file(s).`);

  if (filesMissingMetadata.length > 0) {
    console.log(`Files missing metadata (${filesMissingMetadata.length}):`);
    for (const file of filesMissingMetadata) {
      console.log(`  - ${file.path}`);
    }
  }
}

async function processBook(_bookSet: BookSet, _config: Config): Promise<void> {
}
