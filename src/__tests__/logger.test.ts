import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRunLogger } from "../logger.js";

describe("createRunLogger", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("creates a file at the given path", () => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    const logPath = join(tempDir, "run.log");

    createRunLogger(logPath);

    expect(existsSync(logPath)).toBe(true);
  });

  test("log() appends a line with ISO timestamp format", () => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    const logPath = join(tempDir, "run.log");
    const logger = createRunLogger(logPath);

    logger.log("test message");

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    // Match: [YYYY-MM-DDTHH:mm:ss.sssZ] test message
    expect(lines[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] test message$/,
    );
  });

  test("multiple log() calls append multiple lines", () => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    const logPath = join(tempDir, "run.log");
    const logger = createRunLogger(logPath);

    logger.log("first");
    logger.log("second");
    logger.log("third");

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    expect(lines[2]).toContain("third");
  });

  test("creating a new logger for the same path truncates the file", () => {
    tempDir = mkdtempSync(join(tmpdir(), "logger-test-"));
    const logPath = join(tempDir, "run.log");

    const logger1 = createRunLogger(logPath);
    logger1.log("old message");

    // Creating a new logger should truncate
    const logger2 = createRunLogger(logPath);
    logger2.log("new message");

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("new message");
    expect(content).not.toContain("old message");
  });
});
