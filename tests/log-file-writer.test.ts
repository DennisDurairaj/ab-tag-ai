import { describe, it, expect, afterEach, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { LogFileWriter } from "../src/log-file-writer.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("LogFileWriter", () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("startup creates logs directory", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T12:00:00Z"));

    expect(fs.existsSync(path.join(tmpDir, "logs"))).toBe(true);
  });

  it("writes a line with timestamp to the daily log file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    const now = new Date("2026-07-30T12:34:56Z");
    writer.startup(now);
    writer.write(now, "test message");

    const logPath = path.join(tmpDir, "logs", "2026-07-30.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toBe("[2026-07-30 12:34:56] test message\n");
  });

  it("appends subsequent messages to the same daily log file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T10:00:00Z"));
    writer.write(new Date("2026-07-30T10:00:01Z"), "first");
    writer.write(new Date("2026-07-30T10:00:02Z"), "second");

    const logPath = path.join(tmpDir, "logs", "2026-07-30.log");
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[2026-07-30 10:00:01] first");
    expect(lines[1]).toBe("[2026-07-30 10:00:02] second");
  });

  it("creates a new file when the day changes", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T23:59:00Z"));
    writer.write(new Date("2026-07-30T23:59:00Z"), "day one");

    writer.write(new Date("2026-07-31T00:01:00Z"), "day two");

    const log1 = path.join(tmpDir, "logs", "2026-07-30.log");
    const log2 = path.join(tmpDir, "logs", "2026-07-31.log");
    expect(fs.existsSync(log1)).toBe(true);
    expect(fs.existsSync(log2)).toBe(true);
    expect(fs.readFileSync(log1, "utf-8")).toBe("[2026-07-30 23:59:00] day one\n");
    expect(fs.readFileSync(log2, "utf-8")).toBe("[2026-07-31 00:01:00] day two\n");
  });

  it("cleans up log files older than 7 days on startup", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const logsDir = path.join(tmpDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(path.join(logsDir, "2026-07-20.log"), "old content");   // 10 days old
    fs.writeFileSync(path.join(logsDir, "2026-07-25.log"), "recent content"); // 5 days old
    fs.writeFileSync(path.join(logsDir, "2026-07-29.log"), "even newer");     // 1 day old
    fs.writeFileSync(path.join(logsDir, "not-a-log.txt"), "other");

    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T12:00:00Z"));

    expect(fs.existsSync(path.join(logsDir, "2026-07-20.log"))).toBe(false);
    expect(fs.existsSync(path.join(logsDir, "2026-07-25.log"))).toBe(true);
    expect(fs.existsSync(path.join(logsDir, "2026-07-29.log"))).toBe(true);
    expect(fs.existsSync(path.join(logsDir, "not-a-log.txt"))).toBe(true);
  });

  it("preserves files exactly at the 7-day boundary", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const logsDir = path.join(tmpDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    fs.writeFileSync(path.join(logsDir, "2026-07-23.log"), "exactly 7 days");  // at boundary
    fs.writeFileSync(path.join(logsDir, "2026-07-22.log"), "older");            // >7 days

    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T12:00:00Z"));

    expect(fs.existsSync(path.join(logsDir, "2026-07-23.log"))).toBe(true);
    expect(fs.existsSync(path.join(logsDir, "2026-07-22.log"))).toBe(false);
  });

  it("handles empty logs directory on startup", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    expect(() => writer.startup(new Date("2026-07-30"))).not.toThrow();
  });

  it("survives startup on unwritable destination gracefully", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
      fs.chmodSync(tmpDir, 0o555); // read+execute only

      const writer = new LogFileWriter(path.join(tmpDir, "sub"));
      writer.startup(new Date("2026-07-30"));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("unable to create logs directory"),
      );

      warnSpy.mockClear();
      writer.write(new Date("2026-07-30"), "should not throw");
      expect(warnSpy).not.toHaveBeenCalled();

      fs.chmodSync(tmpDir, 0o755);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("survives write to unwritable file without throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
      const logsDir = path.join(tmpDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });

      const logPath = path.join(logsDir, "2026-07-30.log");
      fs.writeFileSync(logPath, "");
      fs.chmodSync(logPath, 0o444); // read-only

      const writer = new LogFileWriter(tmpDir);
      writer.startup(new Date("2026-07-30"));

      writer.write(new Date("2026-07-30"), "should survive");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Log file writer: write failed"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not attempt to write after first failure", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
      const logsDir = path.join(tmpDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });

      const logPath = path.join(logsDir, "2026-07-30.log");
      fs.writeFileSync(logPath, "");
      fs.chmodSync(logPath, 0o444);

      const writer = new LogFileWriter(tmpDir);
      writer.startup(new Date("2026-07-30"));

      writer.write(new Date("2026-07-30"), "first");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      writer.write(new Date("2026-07-30"), "second");
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("correctly formats timestamps with leading zeros", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    const now = new Date("2026-01-05T03:04:09Z");
    writer.startup(now);
    writer.write(now, "padded");

    const logPath = path.join(tmpDir, "logs", "2026-01-05.log");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toBe("[2026-01-05 03:04:09] padded\n");
  });

  it("startup without write call does not create a log file", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30"));

    const logFiles = fs.readdirSync(path.join(tmpDir, "logs"));
    expect(logFiles.filter((f) => f.endsWith(".log"))).toHaveLength(0);
  });

  it("returns same date key across calls but only one file after startup", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    writer.startup(new Date("2026-07-30T10:00:00Z"));

    const logsDir = path.join(tmpDir, "logs");
    writer.write(new Date("2026-07-30T10:01:00Z"), "m1");
    expect(fs.readdirSync(logsDir).filter((f) => f.endsWith(".log"))).toHaveLength(1);

    writer.write(new Date("2026-07-30T10:02:00Z"), "m2");
    expect(fs.readdirSync(logsDir).filter((f) => f.endsWith(".log"))).toHaveLength(1);
  });
});

describe("LogFileWriter — line content", () => {
  let tmpDir: string;

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes empty message as timestamped line", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    const now = new Date("2026-07-30T12:00:00Z");
    writer.startup(now);
    writer.write(now, "");

    const logPath = path.join(tmpDir, "logs", "2026-07-30.log");
    expect(fs.readFileSync(logPath, "utf-8")).toBe("[2026-07-30 12:00:00] \n");
  });

  it("writes multiline message on a single line", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logwriter-test-"));
    const writer = new LogFileWriter(tmpDir);
    const now = new Date("2026-07-30T12:00:00Z");
    writer.startup(now);
    writer.write(now, "line1\nline2");

    const logPath = path.join(tmpDir, "logs", "2026-07-30.log");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("line1");
    expect(content).toContain("line2");
  });
});
