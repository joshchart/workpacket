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

  test("runs full pipeline and produces output artifacts", async () => {
    // Mock the LLM so LLM-powered stages work without an API key.
    // The mock returns different responses depending on which stage calls it:
    // call 1 = extract_requirements, call 2 = map_concepts, call 3 = explain_concepts.
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
    const mockConcepts = JSON.stringify({
      concepts: [
        {
          id: "CON-001",
          name: "Widget Construction",
          description: "Understanding how to build the widget",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "Requirements" }],
        },
      ],
    });
    const mockPrimer = `## Widget Construction

The widget is constructed by... [spec.md, Requirements]`;
    const mockPacket = `## What You Are Building

Build the widget as specified in the requirements. [spec.md, Requirements]

## Acceptance Criteria

- Widget is fully functional and passes all tests
- REQ-001 is satisfied

## Requirements Checklist

| ID | Type | Requirement |
|----|------|-------------|
| REQ-001 | functional | Build the widget |

## Required Concepts

- Widget Construction: Understanding how to build the widget

## System / Component Breakdown

The system consists of a single widget module.

## Execution Plan

1. Set up the project structure
2. Implement the widget

## Common Pitfalls and Edge Cases

- Forgetting to handle edge cases in widget initialization

## Validation and Testing Plan

- Unit test the widget module

## Open Questions

None identified.`;
    let llmCallCount = 0;
    mock.module("../../llm.js", () => ({
      callLLM: async () => {
        llmCallCount++;
        const responses = [mockRequirements, mockConcepts, mockPrimer, mockPacket];
        return {
          text: responses[llmCallCount - 1] ?? mockPacket,
          inputTokens: 100,
          outputTokens: 50,
        };
      },
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
    });

    // chunks.json exists (ingest stage ran)
    expect(existsSync(join(outputDir, "chunks.json"))).toBe(true);

    // requirements.json exists (extract_requirements stage ran)
    expect(existsSync(join(outputDir, "requirements.json"))).toBe(true);

    // concepts.json exists (map_concepts stage ran)
    expect(existsSync(join(outputDir, "concepts.json"))).toBe(true);

    // primer.md exists (explain_concepts stage ran)
    expect(existsSync(join(outputDir, "primer.md"))).toBe(true);
    const primer = readFileSync(join(outputDir, "primer.md"), "utf-8");
    expect(primer).toContain("## Widget Construction");

    // packet.md exists (generate_packet stage ran)
    expect(existsSync(join(outputDir, "packet.md"))).toBe(true);
    const packet = readFileSync(join(outputDir, "packet.md"), "utf-8");
    expect(packet).toContain("## What You Are Building");

    // run.json shows completed with all five stages
    const runJson = JSON.parse(
      readFileSync(join(outputDir, "run.json"), "utf-8"),
    );
    expect(runJson.status).toBe("completed");
    expect(runJson.stages_completed).toContain("ingest");
    expect(runJson.stages_completed).toContain("extract_requirements");
    expect(runJson.stages_completed).toContain("map_concepts");
    expect(runJson.stages_completed).toContain("explain_concepts");
    expect(runJson.stages_completed).toContain("generate_packet");

    // run.log exists
    expect(existsSync(join(outputDir, "run.log"))).toBe(true);
  });
});
