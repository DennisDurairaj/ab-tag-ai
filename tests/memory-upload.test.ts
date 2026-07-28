import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAbsClient } from "../src/providers/abs-client.js";

function getRssMB(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

function generateTestFile(dir: string, name: string, sizeMB: number): string {
  const filePath = path.join(dir, name);
  const buf = Buffer.alloc(sizeMB * 1024 * 1024, "A");
  fs.writeFileSync(filePath, buf);
  return filePath;
}

describe("memory: uploadFiles", () => {
  it(
    "regression: streaming upload does not buffer all files in memory",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-mem-test-"));
      const testFiles: string[] = [];
      const totalDataMB = 500;

      try {
        const fileCount = 10;
        const perFileMB = totalDataMB / fileCount;
        for (let i = 0; i < fileCount; i++) {
          const f = generateTestFile(tmpDir, `test-${String(i).padStart(2, "0")}.mp3`, perFileMB);
          testFiles.push(f);
        }

        const memBefore = getRssMB();

        const absClient = createAbsClient({
          url: "http://localhost:1",
          apiToken: "test",
          libraryId: "test-lib",
        });

        try {
          await absClient.uploadFiles({
            libraryId: "test",
            folderId: "test",
            title: "Test Book",
            author: "Test Author",
            files: testFiles,
            fileNames: testFiles.map((f) => path.basename(f)),
          });
        } catch {
          // expected — port closed, we only care about memory
        }

        const memAfter = getRssMB();

        console.log(`RSS before: ${memBefore.toFixed(0)} MB, after: ${memAfter.toFixed(0)} MB`);
        console.log(`Total file data on disk: ${totalDataMB} MB`);

        // Streaming upload should NOT increase RSS by the total file size.
        // The old code loaded all files into Buffers + FormData (~2× multiplier).
        // The new streaming code reads files in 256 KB chunks — peak memory
        // should be well under the total file size.
        const memIncrease = memAfter - memBefore;
        expect(memIncrease).toBeLessThan(totalDataMB * 0.2);
      } finally {
        for (const f of testFiles) {
          try { fs.unlinkSync(f); } catch { /* ignore */ }
        }
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    },
    30_000,
  );

  it(
    "regression: memory is stable across varying file counts and sizes",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-mem-test2-"));
      const baselines: number[] = [];

      try {
        const scenarios = [
          { fileCount: 1, perFileMB: 10 },
          { fileCount: 10, perFileMB: 10 },
          { fileCount: 50, perFileMB: 5 },
        ];

        for (const sc of scenarios) {
          const files: string[] = [];
          for (let i = 0; i < sc.fileCount; i++) {
            files.push(generateTestFile(tmpDir, `test-${i}.mp3`, sc.perFileMB));
          }

          const before = getRssMB();
          try {
            await createAbsClient({
              url: "http://localhost:1",
              apiToken: "test",
              libraryId: "test",
            }).uploadFiles({
              libraryId: "test",
              folderId: "test",
              title: "Test",
              author: "Test",
              files,
            });
          } catch { /* expected */ }
          const after = getRssMB();

          const totalMB = sc.fileCount * sc.perFileMB;
          const deltaMB = after - before;
          baselines.push(deltaMB);

          console.log(
            `  ${sc.fileCount} files × ${sc.perFileMB} MB (${totalMB} MB total) → RSS Δ: ${deltaMB.toFixed(1)} MB`,
          );

          for (const f of files) {
            try { fs.unlinkSync(f); } catch { /* ignore */ }
          }
        }

        // All memory deltas should be negligible compared to file sizes.
        // The streaming approach uses < 20 MB peak regardless of total size.
        for (const delta of baselines) {
          expect(delta).toBeLessThan(50);
        }
      } finally {
        for (const f of fs.readdirSync(tmpDir)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch { /* ignore */ }
        }
        try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
      }
    },
    60_000,
  );
});
