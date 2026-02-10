import { describe, test, expect, mock, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunContext } from "../../schemas/stage.js";
import type { Chunk } from "../../schemas/chunk.js";
import type { StorageReader, RetrievalOptions } from "../../storage.js";
import { RequirementsOutputSchema } from "../../schemas/requirement.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeStorage(chunks: Chunk[]): StorageReader {
  return {
    retrieve(_options: RetrievalOptions): Chunk[] {
      return chunks;
    },
    close(): void {},
  };
}

function makeChunk(id: string, fileId: string, text: string): Chunk {
  return {
    chunk_id: id,
    file_id: fileId,
    text,
    source_ref: { file_id: fileId, section: "Test Section" },
  };
}

function makeCtx(storage?: StorageReader): RunContext {
  return {
    config: {
      assignment_id: "test",
      input_paths: ["/tmp/test"],
      output_dir: "/tmp/test-output",
      draft_enabled: false,
    },
    run_id: "test-run",
    storage,
  };
}

// ── parseJSON Tests ─────────────────────────────────────────────────

describe("parseJSON", () => {
  test("parses clean JSON", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    const result = parseJSON('{"requirements": []}');
    expect(result).toEqual({ requirements: [] });
  });

  test("parses JSON with leading/trailing whitespace", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    const result = parseJSON('  \n  {"key": "value"}  \n  ');
    expect(result).toEqual({ key: "value" });
  });

  test("strips markdown code fences (```json)", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    const result = parseJSON('```json\n{"key": "value"}\n```');
    expect(result).toEqual({ key: "value" });
  });

  test("strips markdown code fences (``` without language)", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    const result = parseJSON('```\n{"key": "value"}\n```');
    expect(result).toEqual({ key: "value" });
  });

  test("returns null on invalid JSON", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    expect(parseJSON("not json at all")).toBeNull();
  });

  test("returns null on empty string", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    expect(parseJSON("")).toBeNull();
  });

  test("returns null on truncated JSON", async () => {
    const { parseJSON } = await import("../extract-requirements.js");
    expect(parseJSON('{"requirements": [')).toBeNull();
  });
});

// ── buildUserMessage Tests ──────────────────────────────────────────

describe("buildUserMessage", () => {
  test("formats chunks with file_id and section", async () => {
    const { buildUserMessage } = await import("../extract-requirements.js");
    const chunks: Chunk[] = [
      makeChunk("c1", "spec.md", "Implement BST"),
    ];
    const msg = buildUserMessage(chunks);
    expect(msg).toContain("Chunk 1");
    expect(msg).toContain("file: spec.md");
    expect(msg).toContain("section: Test Section");
    expect(msg).toContain("Implement BST");
  });

  test("includes line numbers when present", async () => {
    const { buildUserMessage } = await import("../extract-requirements.js");
    const chunks: Chunk[] = [{
      chunk_id: "c1",
      file_id: "spec.md",
      text: "Some requirement",
      source_ref: { file_id: "spec.md", line_start: 10, line_end: 20 },
    }];
    const msg = buildUserMessage(chunks);
    expect(msg).toContain("lines: 10-20");
  });

  test("includes page number when present", async () => {
    const { buildUserMessage } = await import("../extract-requirements.js");
    const chunks: Chunk[] = [{
      chunk_id: "c1",
      file_id: "doc.pdf",
      text: "Page content",
      source_ref: { file_id: "doc.pdf", page: 3 },
    }];
    const msg = buildUserMessage(chunks);
    expect(msg).toContain("page: 3");
  });

  test("numbers chunks sequentially", async () => {
    const { buildUserMessage } = await import("../extract-requirements.js");
    const chunks: Chunk[] = [
      makeChunk("c1", "a.md", "First"),
      makeChunk("c2", "b.md", "Second"),
      makeChunk("c3", "c.md", "Third"),
    ];
    const msg = buildUserMessage(chunks);
    expect(msg).toContain("Chunk 1");
    expect(msg).toContain("Chunk 2");
    expect(msg).toContain("Chunk 3");
  });

  test("uses line_start as line_end when line_end is missing", async () => {
    const { buildUserMessage } = await import("../extract-requirements.js");
    const chunks: Chunk[] = [{
      chunk_id: "c1",
      file_id: "spec.md",
      text: "Single line",
      source_ref: { file_id: "spec.md", line_start: 5 },
    }];
    const msg = buildUserMessage(chunks);
    expect(msg).toContain("lines: 5-5");
  });
});

// ── Stage Metadata Tests ────────────────────────────────────────────

describe("extract-requirements stage metadata", () => {
  test("stage name is extract_requirements", async () => {
    const { extractRequirementsStage } = await import("../extract-requirements.js");
    expect(extractRequirementsStage.name).toBe("extract_requirements");
  });

  test("output filename is requirements.json", async () => {
    const { extractRequirementsStage } = await import("../extract-requirements.js");
    expect(extractRequirementsStage.outputFilename).toBe("requirements.json");
  });

  test("output schema matches RequirementsOutputSchema", async () => {
    const { extractRequirementsStage } = await import("../extract-requirements.js");
    expect(extractRequirementsStage.outputSchema).toBe(RequirementsOutputSchema);
  });
});

// ── Stage Error Path Tests ──────────────────────────────────────────

describe("extract-requirements stage error paths", () => {
  test("throws when storage is not available in context", async () => {
    const { extractRequirementsStage } = await import("../extract-requirements.js");
    const ctx = makeCtx(undefined);

    await expect(
      extractRequirementsStage.run(undefined, ctx)
    ).rejects.toThrow("requires storage");
  });

  test("throws when storage returns zero chunks", async () => {
    const { extractRequirementsStage } = await import("../extract-requirements.js");
    const emptyStorage = makeStorage([]);
    const ctx = makeCtx(emptyStorage);

    await expect(
      extractRequirementsStage.run(undefined, ctx)
    ).rejects.toThrow("No chunks retrieved");
  });
});

// ── Mock LLM Integration Tests ──────────────────────────────────────

describe("extract-requirements with mocked LLM", () => {
  const validResponse = JSON.stringify({
    requirements: [
      {
        id: "REQ-001",
        text: "Implement binary search tree",
        type: "functional",
        source_ref: { file_id: "spec.md", section: "Requirements" },
      },
      {
        id: "REQ-002",
        text: "Must use C99 or later",
        type: "constraint",
        source_ref: { file_id: "spec.md", section: "Constraints" },
      },
    ],
  });

  test("returns parsed output when LLM returns valid JSON", async () => {
    // Path is ../../llm.js from this test file to resolve to src/llm.ts
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../extract-requirements.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST in C")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.extractRequirementsStage.run(undefined, ctx);

    expect(result).toEqual(JSON.parse(validResponse));
    const parsed = RequirementsOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  test("returns empty object when LLM returns invalid JSON (enables retry)", async () => {
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: "This is not JSON at all, sorry!",
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../extract-requirements.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.extractRequirementsStage.run(undefined, ctx);

    // Should return {} (not throw), allowing orchestrator retry
    expect(result).toEqual({});

    // {} should fail RequirementsOutputSchema validation (triggering retry)
    const parsed = RequirementsOutputSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  test("handles markdown-fenced JSON response from LLM", async () => {
    const fencedResponse = "```json\n" + validResponse + "\n```";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: fencedResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../extract-requirements.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.extractRequirementsStage.run(undefined, ctx);

    expect(result).toEqual(JSON.parse(validResponse));
  });
});

// ── Live Integration Tests ──────────────────────────────────────────
// Gated on RUN_LIVE_LLM_TESTS=1 (not just ANTHROPIC_API_KEY) so that
// `bun test` stays fast, deterministic, and free by default.
// Run with: RUN_LIVE_LLM_TESTS=1 bun test
const runLive = process.env.RUN_LIVE_LLM_TESTS === "1";

describe("extract-requirements integration", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  (runLive ? test : test.skip)(
    "full pipeline: ingest → extract_requirements produces valid requirements.json",
    async () => {
      const { runPipeline } = await import("../../orchestrator.js");
      const { ingestStage } = await import("../ingest.js");
      const { extractRequirementsStage } = await import("../extract-requirements.js");
      const { readFileSync, existsSync } = await import("node:fs");

      tempDir = mkdtempSync(join(tmpdir(), "extract-req-e2e-"));
      const inputDir = join(tempDir, "input");
      const outputDir = join(tempDir, "output");
      mkdirSync(inputDir);

      // Write a simple spec file
      writeFileSync(
        join(inputDir, "spec.md"),
        `# Assignment: Binary Search Tree

## Requirements

1. Implement a binary search tree (BST) data structure in C.
2. The BST must support insert, search, and delete operations.
3. All operations must run in O(h) time where h is the height of the tree.

## Interface

- \`bst_insert(tree, key)\` — inserts a key into the tree
- \`bst_search(tree, key)\` — returns true if key exists
- \`bst_delete(tree, key)\` — removes the key from the tree

## Constraints

- You must use C99 or later.
- No external libraries allowed.
- Memory must be freed on program exit (no leaks).

## Grading

- Correctness: 60%
- Memory management: 20%
- Code style: 20%
`,
      );

      const config = {
        assignment_id: "bst-test",
        input_paths: [inputDir],
        output_dir: outputDir,
        draft_enabled: false,
      };

      const metadata = await runPipeline(config, [ingestStage, extractRequirementsStage]);

      expect(metadata.status).toBe("completed");
      expect(metadata.stages_completed).toContain("extract_requirements");

      // requirements.json exists and validates
      const reqPath = join(outputDir, "requirements.json");
      expect(existsSync(reqPath)).toBe(true);
      const reqJson = JSON.parse(readFileSync(reqPath, "utf-8"));
      const parsed = RequirementsOutputSchema.parse(reqJson);

      // Should have extracted multiple requirements
      expect(parsed.requirements.length).toBeGreaterThanOrEqual(3);

      // Each requirement should have the expected fields
      for (const req of parsed.requirements) {
        expect(req.id).toBeTruthy();
        expect(req.text).toBeTruthy();
        expect(["functional", "constraint", "interface", "grading"]).toContain(req.type);
        expect(req.source_ref.file_id).toBeTruthy();
      }
    },
    30_000, // 30s timeout for API call
  );
});
