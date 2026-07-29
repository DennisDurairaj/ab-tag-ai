import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("@clack/prompts");

import { autocompleteMultiselect, isCancel } from "@clack/prompts";
import { runInteractivePicker } from "../src/interactive-picker.js";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "picker-test-"));
}

describe("runInteractivePicker", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = makeTmpDir();
    vi.mocked(isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("subdirectories listing and sort", () => {
    it("lists immediate subdirectories alphabetically", async () => {
      fs.mkdirSync(path.join(tmpDir, "Zelda"));
      fs.mkdirSync(path.join(tmpDir, "apple"));
      fs.mkdirSync(path.join(tmpDir, "Banana"));
      fs.writeFileSync(path.join(tmpDir, "file.txt"), "text");

      vi.mocked(autocompleteMultiselect).mockResolvedValue(["apple", "Banana", "Zelda"]);

      const result = await runInteractivePicker(tmpDir);
      expect(result).toEqual(["apple", "Banana", "Zelda"]);

      const callArgs = vi.mocked(autocompleteMultiselect).mock.calls[0][0];
      expect(callArgs.message).toBe(
        "Select folders to process (space to select, enter to confirm):",
      );
      expect(callArgs.required).toBe(true);
      expect(callArgs.options).toEqual([
        { value: "apple", label: "apple" },
        { value: "Banana", label: "Banana" },
        { value: "Zelda", label: "Zelda" },
      ]);
    });

    it("sorts with locale-aware comparison", async () => {
      fs.mkdirSync(path.join(tmpDir, "ą"));
      fs.mkdirSync(path.join(tmpDir, "a"));
      fs.mkdirSync(path.join(tmpDir, "z"));
      fs.mkdirSync(path.join(tmpDir, "b"));

      vi.mocked(autocompleteMultiselect).mockResolvedValue(["a", "ą", "b", "z"]);

      const result = await runInteractivePicker(tmpDir);
      expect(result).toEqual(["a", "ą", "b", "z"]);

      const options = vi.mocked(autocompleteMultiselect).mock.calls[0][0].options;
      expect(options.map((o: { value: string }) => o.value)).toEqual(["a", "ą", "b", "z"]);
    });
  });

  describe("prompt options structure", () => {
    it("uses the correct prompt title", async () => {
      fs.mkdirSync(path.join(tmpDir, "Foo"));
      vi.mocked(autocompleteMultiselect).mockResolvedValue(["Foo"]);

      await runInteractivePicker(tmpDir);

      expect(vi.mocked(autocompleteMultiselect).mock.calls[0][0].message).toBe(
        "Select folders to process (space to select, enter to confirm):",
      );
    });

    it("passes required: true", async () => {
      fs.mkdirSync(path.join(tmpDir, "Foo"));
      vi.mocked(autocompleteMultiselect).mockResolvedValue(["Foo"]);

      await runInteractivePicker(tmpDir);

      expect(vi.mocked(autocompleteMultiselect).mock.calls[0][0].required).toBe(true);
    });

    it("no initialValues — all folders unchecked by default", async () => {
      fs.mkdirSync(path.join(tmpDir, "Foo"));
      vi.mocked(autocompleteMultiselect).mockResolvedValue(["Foo"]);

      await runInteractivePicker(tmpDir);

      expect(vi.mocked(autocompleteMultiselect).mock.calls[0][0].initialValues).toBeUndefined();
    });
  });

  describe("empty directory", () => {
    it("throws when inputDir has no subdirectories", async () => {
      await expect(runInteractivePicker(tmpDir)).rejects.toThrow(
        "No subdirectories found in the input path. Nothing to select.",
      );
    });

    it("ignores files, throws when only files exist", async () => {
      fs.writeFileSync(path.join(tmpDir, "file.txt"), "text");
      fs.writeFileSync(path.join(tmpDir, "another.log"), "log");

      await expect(runInteractivePicker(tmpDir)).rejects.toThrow(
        "No subdirectories found in the input path. Nothing to select.",
      );
    });
  });

  describe("cancel returns empty array", () => {
    it("returns empty array when user cancels", async () => {
      fs.mkdirSync(path.join(tmpDir, "Foo"));
      const cancelSymbol = Symbol("cancel");
      vi.mocked(autocompleteMultiselect).mockResolvedValue(cancelSymbol as unknown as string[]);
      vi.mocked(isCancel).mockReturnValue(true);

      const result = await runInteractivePicker(tmpDir);

      expect(result).toEqual([]);
      expect(isCancel).toHaveBeenCalledWith(cancelSymbol);
    });
  });

  describe("selection returns chosen folder names", () => {
    it("returns the selected folder names", async () => {
      fs.mkdirSync(path.join(tmpDir, "Alpha"));
      fs.mkdirSync(path.join(tmpDir, "Beta"));
      fs.mkdirSync(path.join(tmpDir, "Gamma"));

      vi.mocked(autocompleteMultiselect).mockResolvedValue(["Alpha", "Gamma"]);

      const result = await runInteractivePicker(tmpDir);

      expect(result).toEqual(["Alpha", "Gamma"]);
    });

    it("returns single selection", async () => {
      fs.mkdirSync(path.join(tmpDir, "Alpha"));
      fs.mkdirSync(path.join(tmpDir, "Beta"));

      vi.mocked(autocompleteMultiselect).mockResolvedValue(["Alpha"]);

      const result = await runInteractivePicker(tmpDir);

      expect(result).toEqual(["Alpha"]);
    });
  });
});
