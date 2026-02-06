import { existsSync, readFileSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { RunConfigSchema } from "../schemas/run-config.js";
import { runPipeline } from "../orchestrator.js";
import { ingestStage } from "../stages/ingest.js";
import type { BuildArgs, IngestArgs, PacketArgs } from "./parse-args.js";

export async function runBuild(args: BuildArgs): Promise<void> {
  const assignmentDir = resolve(args.assignmentDir);

  if (!existsSync(assignmentDir)) {
    console.error(
      `Error: assignment directory does not exist: ${assignmentDir}`,
    );
    process.exit(1);
  }

  const assignmentId = basename(assignmentDir);
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : resolve("workpacket_runs", assignmentId);

  const configResult = RunConfigSchema.safeParse({
    assignment_id: assignmentId,
    input_paths: [assignmentDir],
    output_dir: outputDir,
    draft_enabled: args.draft,
  });

  if (!configResult.success) {
    console.error("Error: invalid configuration:");
    for (const issue of configResult.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const config = configResult.data;

  console.log(`[workpacket] build`);
  console.log(`  assignment_id:  ${config.assignment_id}`);
  console.log(`  input_paths:    ${config.input_paths.join(", ")}`);
  console.log(`  output_dir:     ${config.output_dir}`);
  console.log(`  draft_enabled:  ${config.draft_enabled}`);
  console.log();

  // TODO: add later stages as they are implemented
  const stages = [ingestStage];
  const metadata = await runPipeline(config, stages);

  if (metadata.status === "failed") {
    console.error(`Build failed: ${metadata.error}`);
    process.exit(1);
  }

  console.log(
    `Done. Completed stages: ${metadata.stages_completed.join(", ")}`,
  );
  console.log(`  output_dir: ${config.output_dir}`);
}

export async function runIngest(args: IngestArgs): Promise<void> {
  const assignmentDir = resolve(args.assignmentDir);

  if (!existsSync(assignmentDir)) {
    console.error(
      `Error: assignment directory does not exist: ${assignmentDir}`,
    );
    process.exit(1);
  }

  const assignmentId = basename(assignmentDir);
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : resolve("workpacket_runs", assignmentId);

  const configResult = RunConfigSchema.safeParse({
    assignment_id: assignmentId,
    input_paths: [assignmentDir],
    output_dir: outputDir,
  });

  if (!configResult.success) {
    console.error("Error: invalid configuration:");
    for (const issue of configResult.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const config = configResult.data;

  console.log(`[workpacket] ingest`);
  console.log(`  assignment_id:  ${config.assignment_id}`);
  console.log(`  input_paths:    ${config.input_paths.join(", ")}`);
  console.log(`  output_dir:     ${config.output_dir}`);
  console.log();

  const metadata = await runPipeline(config, [ingestStage]);

  if (metadata.status === "failed") {
    console.error(`Ingest failed: ${metadata.error}`);
    process.exit(1);
  }

  const chunksPath = join(config.output_dir, "chunks.json");
  const chunks = JSON.parse(readFileSync(chunksPath, "utf-8")) as {
    chunks: unknown[];
  };

  console.log(`Done. ${chunks.chunks.length} chunks written to ${chunksPath}`);
}

export async function runPacket(args: PacketArgs): Promise<void> {
  const assignmentId = args.assignmentId;
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : resolve("workpacket_runs", assignmentId);

  const configResult = RunConfigSchema.safeParse({
    assignment_id: assignmentId,
    input_paths: [outputDir],
    output_dir: outputDir,
  });

  if (!configResult.success) {
    console.error("Error: invalid configuration:");
    for (const issue of configResult.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(`[workpacket] packet`);
  console.log(`  assignment_id:  ${configResult.data.assignment_id}`);
  console.log(`  output_dir:     ${configResult.data.output_dir}`);
  console.log();
  console.log("TODO: orchestrator not yet implemented");
}
