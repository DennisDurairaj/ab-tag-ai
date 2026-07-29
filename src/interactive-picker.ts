import fs from "node:fs";
import { autocompleteMultiselect, isCancel } from "@clack/prompts";

const PROMPT_TITLE = "Select folders to process (space to select, enter to confirm):";
const NO_FOLDERS_MSG = "No subdirectories found in the input path. Nothing to select.";

export async function runInteractivePicker(inputDir: string): Promise<string[]> {
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  if (folders.length === 0) {
    throw new Error(NO_FOLDERS_MSG);
  }

  const result = await autocompleteMultiselect({
    message: PROMPT_TITLE,
    options: folders.map((name) => ({ value: name, label: name })),
    required: true,
  });

  if (isCancel(result)) {
    return [];
  }

  return result;
}
