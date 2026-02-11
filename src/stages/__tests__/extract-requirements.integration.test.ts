/**
 * Live integration test for the extract-requirements stage.
 * This file is separate from the unit tests to avoid bun's mock.module
 * polluting the module cache — once a module is mocked in bun, already-loaded
 * importers keep the mocked binding even after "restoring" it.
 *
 * Gated on RUN_LIVE_LLM_TESTS=1 so that `bun test` stays fast and free by default.
 * Run with: RUN_LIVE_LLM_TESTS=1 bun test src/stages/__tests__/extract-requirements.integration.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPipeline } from "../../orchestrator.js";
import { ingestStage } from "../ingest.js";
import { extractRequirementsStage } from "../extract-requirements.js";
import { RequirementsOutputSchema } from "../../schemas/requirement.js";

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
