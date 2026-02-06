import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RunConfig } from "./schemas/run-config.js";
import type { RunMetadata, StageName } from "./schemas/run-metadata.js";
import type { RunContext } from "./schemas/stage.js";
import { createRunLogger } from "./logger.js";

/**
 * PipelineStage is the type-erased stage contract used by the orchestrator.
 * Individual stages are authored with Stage<I, O> for type safety,
 * then wrapped into PipelineStage for orchestrator consumption.
 */
export interface PipelineStage {
  readonly name: StageName;
  readonly run: (input: unknown, ctx: RunContext) => Promise<unknown>;
  readonly outputSchema: z.ZodType;
  readonly outputFilename: string;
}

const MAX_RETRIES = 2; // 3 total attempts (1 initial + 2 retries)

/** Mutable working copy — avoids casting readonly arrays from Zod-inferred types. */
interface MutableRunMetadata {
  run_id: string;
  assignment_id: string;
  started_at: string;
  completed_at?: string;
  stages_completed: StageName[];
  status: "running" | "completed" | "failed";
  error?: string;
}

function writeRunMetadata(outputDir: string, metadata: MutableRunMetadata): void {
  writeFileSync(
    join(outputDir, "run.json"),
    JSON.stringify(metadata, null, 2),
  );
}

export async function runPipeline(
  config: RunConfig,
  stages: PipelineStage[],
  initialInput?: unknown,
): Promise<RunMetadata> {
  const run_id = randomUUID();
  mkdirSync(config.output_dir, { recursive: true });

  const metadata: MutableRunMetadata = {
    run_id,
    assignment_id: config.assignment_id,
    started_at: new Date().toISOString(),
    stages_completed: [],
    status: "running",
  };

  const ctx: RunContext = { config, run_id };
  const logger = createRunLogger(join(config.output_dir, "run.log"));

  writeRunMetadata(config.output_dir, metadata);
  logger.log(
    `Pipeline started for assignment '${config.assignment_id}' with ${stages.length} stages`,
  );

  let currentInput: unknown = initialInput;

  for (const stage of stages) {
    logger.log(`Stage '${stage.name}' started`);

    let attempts = 0;
    let validatedOutput: unknown;

    while (true) {
      attempts++;

      let output: unknown;
      try {
        output = await stage.run(currentInput, ctx);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.log(`Stage '${stage.name}' threw error: ${message}`);
        metadata.status = "failed";
        metadata.error = message;
        writeRunMetadata(config.output_dir, metadata);
        return metadata;
      }

      const validationResult = stage.outputSchema.safeParse(output);

      if (validationResult.success) {
        validatedOutput = validationResult.data;
        break;
      }

      if (attempts > MAX_RETRIES) {
        const errorMessage = validationResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        logger.log(
          `Stage '${stage.name}' output validation failed after ${attempts} attempts`,
        );
        metadata.status = "failed";
        metadata.error = errorMessage;
        writeRunMetadata(config.output_dir, metadata);
        return metadata;
      }

      logger.log(
        `Stage '${stage.name}' output validation failed (attempt ${attempts}/${MAX_RETRIES + 1}), retrying...`,
      );
    }

    // Loop only exits via break (success) or return (failure), so
    // reaching here means validation passed.
    let outputContent: string;
    if (stage.outputFilename.endsWith(".json")) {
      outputContent = JSON.stringify(validatedOutput, null, 2);
    } else {
      if (typeof validatedOutput !== "string") {
        const message = `Stage '${stage.name}' output must be a string for non-JSON filename '${stage.outputFilename}', got ${typeof validatedOutput}`;
        logger.log(message);
        metadata.status = "failed";
        metadata.error = message;
        writeRunMetadata(config.output_dir, metadata);
        return metadata;
      }
      outputContent = validatedOutput;
    }
    writeFileSync(
      join(config.output_dir, stage.outputFilename),
      outputContent,
    );
    logger.log(
      `Stage '${stage.name}' completed, output written to ${stage.outputFilename}`,
    );
    metadata.stages_completed.push(stage.name);
    writeRunMetadata(config.output_dir, metadata);
    currentInput = validatedOutput;
  }

  metadata.status = "completed";
  metadata.completed_at = new Date().toISOString();
  writeRunMetadata(config.output_dir, metadata);
  logger.log("Pipeline completed successfully");

  return metadata;
}
