import { describe, test, expect, afterEach, mock } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runIngest, runBuild } from "../commands.js";

/**
 * Integration tests for CLI commands.
 * These exercise the full vertical slice: config → orchestrator → disk output.
 *
 * Note: runIngest/runBuild call process.exit(1) on failure, which would kill the
 * test runner. We test the happy path here; error paths are covered by the
 * orchestrator and parse-args unit tests.
 */

describe("runIngest", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("produces chunks.json, run.json, and run.log", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cmd-ingest-"));
    const inputDir = join(tempDir, "assignment");
    const outputDir = join(tempDir, "output");
    mkdirSync(inputDir);

    writeFileSync(
      join(inputDir, "spec.md"),
      "# Overview\n\nThis is the spec.\n\n# Requirements\n\nDo the thing.\n",
    );

    await runIngest({
      command: "ingest",
      assignmentDir: inputDir,
      outputDir,
    });

    // chunks.json exists and has chunks
    const chunksPath = join(outputDir, "chunks.json");
    expect(existsSync(chunksPath)).toBe(true);
    const chunks = JSON.parse(readFileSync(chunksPath, "utf-8"));
    expect(chunks.chunks.length).toBeGreaterThan(0);

    // Each chunk has required fields
    for (const chunk of chunks.chunks) {
      expect(chunk.chunk_id).toBeDefined();
      expect(chunk.file_id).toBeDefined();
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.source_ref.line_start).toBeGreaterThanOrEqual(1);
    }

    // run.json exists and shows completed
    const runJsonPath = join(outputDir, "run.json");
    expect(existsSync(runJsonPath)).toBe(true);
    const runJson = JSON.parse(readFileSync(runJsonPath, "utf-8"));
    expect(runJson.status).toBe("completed");
    expect(runJson.stages_completed).toEqual(["ingest"]);

    // run.log exists and has pipeline log entries
    const runLogPath = join(outputDir, "run.log");
    expect(existsSync(runLogPath)).toBe(true);
    const runLog = readFileSync(runLogPath, "utf-8");
    expect(runLog).toContain("Stage 'ingest' started");
    expect(runLog).toContain("Stage 'ingest' completed");
    expect(runLog).toContain("Pipeline completed successfully");
  });

  test("handles multiple files in directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "cmd-ingest-"));
    const inputDir = join(tempDir, "assignment");
    const outputDir = join(tempDir, "output");
    mkdirSync(inputDir);

    writeFileSync(join(inputDir, "spec.md"), "# Spec\n\nSpec content.\n");
    writeFileSync(join(inputDir, "notes.txt"), "Some plain text notes.\n");

    await runIngest({
      command: "ingest",
      assignmentDir: inputDir,
      outputDir,
    });

    const chunks = JSON.parse(
      readFileSync(join(outputDir, "chunks.json"), "utf-8"),
    );
    const fileIds = new Set(chunks.chunks.map((c: { file_id: string }) => c.file_id));
    expect(fileIds.has("spec.md")).toBe(true);
    expect(fileIds.has("notes.txt")).toBe(true);
  });
});

describe("runBuild", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runs full pipeline (ingest + extract_requirements) and produces output artifacts", async () => {
    // Mock the LLM so the extract_requirements stage works without an API key
    const mockRequirements = JSON.stringify({
      requirements: [
        {
          id: "REQ-001",
          text: "Build the widget",
          type: "functional",
          source_ref: { file_id: "spec.md", section: "Requirements" },
        },
      ],
    });
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: mockRequirements,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    tempDir = mkdtempSync(join(tmpdir(), "cmd-build-"));
    const inputDir = join(tempDir, "assignment");
    const outputDir = join(tempDir, "output");
    mkdirSync(inputDir);

    // Use content that matches the FTS5 retrieval query keywords
    writeFileSync(
      join(inputDir, "spec.md"),
      "# Requirements\n\nYou must build the widget.\n\n# Constraints\n\nUse TypeScript.\n",
    );

    await runBuild({
      command: "build",
      assignmentDir: inputDir,
      outputDir,
      draft: false,
    });

    // chunks.json exists (ingest stage ran)
    expect(existsSync(join(outputDir, "chunks.json"))).toBe(true);

    // requirements.json exists (extract_requirements stage ran)
    expect(existsSync(join(outputDir, "requirements.json"))).toBe(true);

    // run.json shows completed with both stages
    const runJson = JSON.parse(
      readFileSync(join(outputDir, "run.json"), "utf-8"),
    );
    expect(runJson.status).toBe("completed");
    expect(runJson.stages_completed).toContain("ingest");
    expect(runJson.stages_completed).toContain("extract_requirements");

    // run.log exists
    expect(existsSync(join(outputDir, "run.log"))).toBe(true);
  });
});
