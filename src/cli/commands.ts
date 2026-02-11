import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { RunConfigSchema } from "../schemas/run-config.js";
import { runPipeline } from "../orchestrator.js";
import { ingestStage } from "../stages/ingest.js";
import { extractRequirementsStage } from "../stages/extract-requirements.js";
import { mapConceptsStage } from "../stages/map-concepts.js";
import { explainConceptsStage } from "../stages/explain-concepts.js";
import { generatePacketStage } from "../stages/generate-packet.js";
import { login } from "../oauth.js";
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
  console.log();

  // Clean previous run artifacts so re-runs don't collide (e.g. SQLite tables)
  if (existsSync(config.output_dir)) {
    rmSync(config.output_dir, { recursive: true });
  }

  const stages = [ingestStage, extractRequirementsStage, mapConceptsStage, explainConceptsStage, generatePacketStage];
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

  // Clean previous run artifacts so re-runs don't collide (e.g. SQLite tables)
  if (existsSync(config.output_dir)) {
    rmSync(config.output_dir, { recursive: true });
  }

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

  const config = configResult.data;

  console.log(`[workpacket] packet`);
  console.log(`  assignment_id:  ${config.assignment_id}`);
  console.log(`  output_dir:     ${config.output_dir}`);
  console.log();

  // Read the primer from disk (explain_concepts output)
  const primerPath = join(config.output_dir, "primer.md");
  if (!existsSync(primerPath)) {
    console.error(
      `Error: primer.md not found in ${config.output_dir}. ` +
        "Run 'workpacket build' first to generate all prior stage outputs.",
    );
    process.exit(1);
  }
  const primer = readFileSync(primerPath, "utf-8");

  const metadata = await runPipeline(config, [generatePacketStage], primer);

  if (metadata.status === "failed") {
    console.error(`Packet generation failed: ${metadata.error}`);
    process.exit(1);
  }

  console.log(
    `Done. Completed stages: ${metadata.stages_completed.join(", ")}`,
  );
  console.log(`  output_dir: ${config.output_dir}`);
}

export async function runLogin(): Promise<void> {
  console.log("[workpacket] login");
  console.log("  Opening browser for ChatGPT authentication...");
  console.log();

  try {
    await login();
    console.log("Authentication successful! Tokens saved.");
    console.log("You can now run 'workpacket build' to process assignments.");
  } catch (err) {
    console.error(`Authentication failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
