/**
 * Live integration test for the map-concepts stage.
 * This file is separate from the unit tests to avoid bun's mock.module
 * polluting the module cache — once a module is mocked in bun, already-loaded
 * importers keep the mocked binding even after "restoring" it.
 *
 * Gated on RUN_LIVE_LLM_TESTS=1 so that `bun test` stays fast and free by default.
 * Run with: RUN_LIVE_LLM_TESTS=1 bun test src/stages/__tests__/map-concepts.integration.test.ts
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPipeline } from "../../orchestrator.js";
import { ingestStage } from "../ingest.js";
import { extractRequirementsStage } from "../extract-requirements.js";
import { mapConceptsStage } from "../map-concepts.js";
import { ConceptsOutputSchema } from "../../schemas/concept.js";
import { RequirementsOutputSchema } from "../../schemas/requirement.js";

const runLive = process.env.RUN_LIVE_LLM_TESTS === "1";

describe("map-concepts integration", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  (runLive ? test : test.skip)(
    "full pipeline: ingest → extract_requirements → map_concepts produces valid concepts.json",
    async () => {
      tempDir = mkdtempSync(join(tmpdir(), "map-concepts-e2e-"));
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

      const metadata = await runPipeline(config, [
        ingestStage,
        extractRequirementsStage,
        mapConceptsStage,
      ]);

      expect(metadata.status).toBe("completed");
      expect(metadata.stages_completed).toContain("map_concepts");

      // concepts.json exists and validates
      const conceptsPath = join(outputDir, "concepts.json");
      expect(existsSync(conceptsPath)).toBe(true);
      const conceptsJson = JSON.parse(readFileSync(conceptsPath, "utf-8"));
      const parsed = ConceptsOutputSchema.parse(conceptsJson);

      // Should have identified at least one concept
      expect(parsed.concepts.length).toBeGreaterThanOrEqual(1);

      // Load requirements to cross-check requirement_ids
      const reqPath = join(outputDir, "requirements.json");
      const reqJson = JSON.parse(readFileSync(reqPath, "utf-8"));
      const reqs = RequirementsOutputSchema.parse(reqJson);
      const validReqIds = new Set(reqs.requirements.map((r) => r.id));

      // Each concept should have valid fields and reference real requirement IDs
      for (const concept of parsed.concepts) {
        expect(concept.id).toBeTruthy();
        expect(concept.name).toBeTruthy();
        expect(concept.description).toBeTruthy();
        expect(concept.requirement_ids.length).toBeGreaterThanOrEqual(1);
        for (const reqId of concept.requirement_ids) {
          expect(validReqIds.has(reqId)).toBe(true);
        }
        expect(concept.source_refs.length).toBeGreaterThanOrEqual(1);
        for (const ref of concept.source_refs) {
          expect(ref.file_id).toBeTruthy();
        }
      }
    },
    60_000, // 60s timeout — two LLM calls
  );
});
