/**
 * Live integration test for the explain-concepts stage.
 * This file is separate from the unit tests to avoid bun's mock.module
 * polluting the module cache — once a module is mocked in bun, already-loaded
 * importers keep the mocked binding even after "restoring" it.
 *
 * Gated on RUN_LIVE_LLM_TESTS=1 so that `bun test` stays fast and free by default.
 * Run with: RUN_LIVE_LLM_TESTS=1 bun test src/stages/__tests__/explain-concepts.integration.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPipeline } from "../../orchestrator.js";
import { ingestStage } from "../ingest.js";
import { extractRequirementsStage } from "../extract-requirements.js";
import { mapConceptsStage } from "../map-concepts.js";
import { explainConceptsStage } from "../explain-concepts.js";

const runLive = process.env.RUN_LIVE_LLM_TESTS === "1";

describe("explain-concepts integration", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  (runLive ? test : test.skip)(
    "full pipeline: ingest → extract_requirements → map_concepts → explain_concepts produces valid primer.md",
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), "explain-concepts-e2e-"));
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

      const metadata = await runPipeline(config, [
        ingestStage,
        extractRequirementsStage,
        mapConceptsStage,
        explainConceptsStage,
      ]);

      expect(metadata.status).toBe("completed");
      expect(metadata.stages_completed).toContain("explain_concepts");

      // primer.md exists and is non-empty
      const primerPath = join(outputDir, "primer.md");
      expect(existsSync(primerPath)).toBe(true);
      const primer = readFileSync(primerPath, "utf-8");
      expect(primer.length).toBeGreaterThan(0);

      // Should contain level-2 headings (concept names)
      const headingPattern = /^## .+$/gm;
      const headings = primer.match(headingPattern);
      expect(headings).not.toBeNull();
      expect(headings!.length).toBeGreaterThanOrEqual(1);

      // Should contain inline citations
      const citationPattern = /\[.+?, .+?\]/;
      expect(citationPattern.test(primer)).toBe(true);
    },
    90_000, // 90s timeout — three LLM calls
  );
});
