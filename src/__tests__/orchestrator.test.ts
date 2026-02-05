import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { runPipeline } from "../orchestrator.js";
import type { PipelineStage } from "../orchestrator.js";
import type { StageName } from "../schemas/run-metadata.js";
import { RunMetadataSchema } from "../schemas/run-metadata.js";
import type { RunConfig } from "../schemas/run-config.js";

function mockStage(
  name: StageName,
  outputFilename: string,
  schema: z.ZodType,
  fn: (input: unknown) => unknown,
): PipelineStage {
  return {
    name,
    outputFilename,
    outputSchema: schema,
    run: async (input, _ctx) => fn(input),
  };
}

function makeConfig(outputDir: string): RunConfig {
  return {
    assignment_id: "test-assignment",
    input_paths: ["/tmp/test-input"],
    output_dir: outputDir,
    draft_enabled: false,
  };
}

describe("runPipeline", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("happy path — single stage", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const stage = mockStage(
      "ingest",
      "chunks.json",
      z.object({ items: z.array(z.string()) }),
      () => ({ items: ["a", "b"] }),
    );

    const metadata = await runPipeline(config, [stage]);

    expect(metadata.status).toBe("completed");
    expect(metadata.stages_completed).toEqual(["ingest"]);
    expect(metadata.completed_at).toBeDefined();

    // run.json on disk matches returned metadata
    const runJson = JSON.parse(
      readFileSync(join(outputDir, "run.json"), "utf-8"),
    );
    expect(runJson).toEqual(metadata);

    // Stage output file exists with correct content
    const outputFile = JSON.parse(
      readFileSync(join(outputDir, "chunks.json"), "utf-8"),
    );
    expect(outputFile).toEqual({ items: ["a", "b"] });

    // run.log exists and has relevant entries
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).toContain("Stage 'ingest' started");
    expect(log).toContain("Stage 'ingest' completed");
    expect(log).toContain("Pipeline completed successfully");
  });

  test("happy path — multiple stages chained", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const stage1 = mockStage(
      "ingest",
      "chunks.json",
      z.object({ value: z.number() }),
      () => ({ value: 10 }),
    );

    const stage2 = mockStage(
      "extract_requirements",
      "requirements.json",
      z.object({ doubled: z.number() }),
      (input) => {
        const { value } = input as { value: number };
        return { doubled: value * 2 };
      },
    );

    const metadata = await runPipeline(config, [stage1, stage2]);

    expect(metadata.status).toBe("completed");
    expect(metadata.stages_completed).toEqual([
      "ingest",
      "extract_requirements",
    ]);

    const reqOutput = JSON.parse(
      readFileSync(join(outputDir, "requirements.json"), "utf-8"),
    );
    expect(reqOutput).toEqual({ doubled: 20 });
  });

  test("stage throws an error", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const stage = mockStage(
      "ingest",
      "chunks.json",
      z.object({ items: z.array(z.string()) }),
      () => {
        throw new Error("stage exploded");
      },
    );

    const metadata = await runPipeline(config, [stage]);

    expect(metadata.status).toBe("failed");
    expect(metadata.error).toBe("stage exploded");
    expect(metadata.stages_completed).toEqual([]);

    // run.json reflects failure
    const runJson = JSON.parse(
      readFileSync(join(outputDir, "run.json"), "utf-8"),
    );
    expect(runJson.status).toBe("failed");
    expect(runJson.error).toBe("stage exploded");

    // run.log records the error
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).toContain("Stage 'ingest' threw error: stage exploded");
  });

  test("validation failure — retries succeed", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    let callCount = 0;
    const stage = mockStage(
      "ingest",
      "chunks.json",
      z.object({ valid: z.boolean() }),
      () => {
        callCount++;
        if (callCount === 1) return { invalid: true }; // fails validation
        return { valid: true }; // passes on retry
      },
    );

    const metadata = await runPipeline(config, [stage]);

    expect(metadata.status).toBe("completed");
    expect(metadata.stages_completed).toEqual(["ingest"]);
    expect(callCount).toBe(2);

    // run.log records the retry
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).toContain("output validation failed (attempt 1/3), retrying");
  });

  test("validation failure — all retries exhausted", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    let callCount = 0;
    const stage = mockStage(
      "ingest",
      "chunks.json",
      z.object({ required_field: z.string() }),
      () => {
        callCount++;
        return { wrong: "data" }; // always invalid
      },
    );

    const metadata = await runPipeline(config, [stage]);

    expect(metadata.status).toBe("failed");
    expect(metadata.error).toBeDefined();
    expect(metadata.stages_completed).toEqual([]);
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  test("empty stages array", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const metadata = await runPipeline(config, []);

    expect(metadata.status).toBe("completed");
    expect(metadata.stages_completed).toEqual([]);
    expect(existsSync(join(outputDir, "run.json"))).toBe(true);
  });

  test("output directory created recursively", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "deep", "nested", "output");
    const config = makeConfig(outputDir);

    expect(existsSync(outputDir)).toBe(false);

    const metadata = await runPipeline(config, []);

    expect(existsSync(outputDir)).toBe(true);
    expect(metadata.status).toBe("completed");
  });

  test("RunMetadata validates against RunMetadataSchema", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const stage = mockStage(
      "ingest",
      "chunks.json",
      z.object({ data: z.string() }),
      () => ({ data: "hello" }),
    );

    const metadata = await runPipeline(config, [stage]);

    // Should not throw — metadata conforms to the schema
    const parsed = RunMetadataSchema.parse(metadata);
    expect(parsed.status).toBe("completed");
    expect(parsed.run_id).toBe(metadata.run_id);
  });

  test("second stage receives validated (parsed) output", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    // Schema that applies a default value
    const stage1Schema = z.object({
      value: z.number(),
      extra: z.string().default("added-by-zod"),
    });

    const stage1 = mockStage(
      "ingest",
      "stage1.json",
      stage1Schema,
      () => ({ value: 42 }), // does NOT include 'extra'
    );

    let receivedInput: unknown;
    const stage2 = mockStage(
      "extract_requirements",
      "stage2.json",
      z.object({ received: z.boolean() }),
      (input) => {
        receivedInput = input;
        return { received: true };
      },
    );

    await runPipeline(config, [stage1, stage2]);

    // Stage 2 should receive the Zod-parsed output with the default applied
    expect(receivedInput).toEqual({ value: 42, extra: "added-by-zod" });
  });

  test("partial failure preserves earlier stages", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "orch-test-"));
    const outputDir = join(tempDir, "output");
    const config = makeConfig(outputDir);

    const stage1 = mockStage(
      "ingest",
      "chunks.json",
      z.object({ items: z.array(z.string()) }),
      () => ({ items: ["a"] }),
    );

    const stage2 = mockStage(
      "extract_requirements",
      "requirements.json",
      z.object({ data: z.string() }),
      () => {
        throw new Error("stage 2 failed");
      },
    );

    const metadata = await runPipeline(config, [stage1, stage2]);

    expect(metadata.status).toBe("failed");
    expect(metadata.stages_completed).toEqual(["ingest"]);

    // Stage 1 output file exists
    expect(existsSync(join(outputDir, "chunks.json"))).toBe(true);
    const chunks = JSON.parse(
      readFileSync(join(outputDir, "chunks.json"), "utf-8"),
    );
    expect(chunks).toEqual({ items: ["a"] });

    // Stage 2 output file does NOT exist
    expect(existsSync(join(outputDir, "requirements.json"))).toBe(false);
  });
});
