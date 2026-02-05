import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { RunConfigSchema } from "../schemas/run-config.js";
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

  console.log(`[workpacket] build`);
  console.log(`  assignment_id:  ${configResult.data.assignment_id}`);
  console.log(`  input_paths:    ${configResult.data.input_paths.join(", ")}`);
  console.log(`  output_dir:     ${configResult.data.output_dir}`);
  console.log(`  draft_enabled:  ${configResult.data.draft_enabled}`);
  console.log();
  console.log("TODO: orchestrator not yet implemented");
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

  console.log(`[workpacket] ingest`);
  console.log(`  assignment_id:  ${configResult.data.assignment_id}`);
  console.log(`  input_paths:    ${configResult.data.input_paths.join(", ")}`);
  console.log(`  output_dir:     ${configResult.data.output_dir}`);
  console.log();
  console.log("TODO: orchestrator not yet implemented");
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
