import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const mocks = vi.hoisted(() => ({
  mockProcessLibrary: vi.fn(),
  mockRunInteractivePicker: vi.fn(),
}));

vi.mock("../src/agent.js", () => ({
  processLibrary: mocks.mockProcessLibrary,
}));

vi.mock("../src/interactive-picker.js", () => ({
  runInteractivePicker: mocks.mockRunInteractivePicker,
}));

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

import { loadConfig } from "../src/config.js";
import { main } from "../src/index.js";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "index-test-"));
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    input: "/tmp/in",
    output: "/tmp/out",
    hardcover_api_key: "test-key",
    dry_run: false,
    llm_model: "test",
    llm_api_key: "",
    llm_api_base_url: "",
    concurrency: 1,
    include: [] as string[],
    log_level: "info",
    output_mode: "local",
    abs_url: "",
    abs_api_token: "",
    abs_library_id: "",
    ...overrides,
  };
}

describe("--include flag integration", () => {
  let tmpDir: string;
  let origArgv: string[];
  let origIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    origArgv = process.argv;
    tmpDir = makeTmpDir();
    vi.mocked(loadConfig).mockReturnValue(makeConfig({ input: tmpDir }));

    origIsTTY = (process.stdin as { isTTY?: boolean }).isTTY;
  });

  afterEach(() => {
    process.argv = origArgv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
  });

  function setIsTTY(value: boolean) {
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      configurable: true,
    });
  }

  function setArgv(args: string[]) {
    process.argv = ["/usr/bin/node", "/path/to/abmeta", ...args];
  }

  describe("TTY path", () => {
    it("calls runInteractivePicker with the resolved input path", async () => {
      setIsTTY(true);
      mocks.mockRunInteractivePicker.mockResolvedValue(["Alpha", "Beta"]);

      setArgv(["--include"]);
      await main();

      expect(mocks.mockRunInteractivePicker).toHaveBeenCalledWith(tmpDir);
    });

    it("wires selected folders into config.include and calls processLibrary", async () => {
      setIsTTY(true);
      mocks.mockRunInteractivePicker.mockResolvedValue(["Alpha", "Beta"]);
      mocks.mockProcessLibrary.mockResolvedValue(undefined);

      setArgv(["--include"]);
      await main();

      expect(mocks.mockProcessLibrary).toHaveBeenCalledTimes(1);
      const passedConfig = mocks.mockProcessLibrary.mock.calls[0][0];
      expect(passedConfig.include).toEqual(["Alpha", "Beta"]);
    });

    it("does not set include when user cancels (returns empty array)", async () => {
      setIsTTY(true);
      mocks.mockRunInteractivePicker.mockResolvedValue([]);

      setArgv(["--include"]);
      await main();

      expect(mocks.mockProcessLibrary).toHaveBeenCalledTimes(1);
      const passedConfig = mocks.mockProcessLibrary.mock.calls[0][0];
      expect(passedConfig.include).toEqual([]);
    });

    it("does not block on --dry-run (picker still appears)", async () => {
      setIsTTY(true);
      mocks.mockRunInteractivePicker.mockResolvedValue(["Alpha"]);
      vi.mocked(loadConfig).mockReturnValue(makeConfig({ input: tmpDir, dry_run: true }));

      setArgv(["--include", "--dry-run"]);
      await main();

      expect(mocks.mockRunInteractivePicker).toHaveBeenCalledWith(tmpDir);
    });

    it("honors --input CLI override for the picker directory", async () => {
      const altDir = path.join(tmpDir, "alt");
      fs.mkdirSync(altDir);

      setIsTTY(true);
      mocks.mockRunInteractivePicker.mockResolvedValue(["Foo"]);

      setArgv(["--include", "--input", altDir]);
      await main();

      expect(mocks.mockRunInteractivePicker).toHaveBeenCalledWith(altDir);
    });
  });

  describe("non-TTY path", () => {
    it("does not call runInteractivePicker", async () => {
      setIsTTY(false);

      setArgv(["--include"]);
      await main();

      expect(mocks.mockRunInteractivePicker).not.toHaveBeenCalled();
    });

    it("does not set include in config", async () => {
      setIsTTY(false);

      setArgv(["--include"]);
      await main();

      expect(mocks.mockProcessLibrary).toHaveBeenCalledTimes(1);
      const passedConfig = mocks.mockProcessLibrary.mock.calls[0][0];
      expect(passedConfig.include).toEqual([]);
    });
  });

  describe("flag not passed", () => {
    it("skips the picker entirely", async () => {
      setIsTTY(true);

      setArgv([]);
      await main();

      expect(mocks.mockRunInteractivePicker).not.toHaveBeenCalled();
    });
  });
});
