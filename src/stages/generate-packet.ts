import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "../schemas/stage.js";
import {
  RequirementsOutputSchema,
  type RequirementsOutput,
} from "../schemas/requirement.js";
import {
  ConceptsOutputSchema,
  type ConceptsOutput,
} from "../schemas/concept.js";
import { PacketOutputSchema } from "../schemas/packet-output.js";
import { callLLM } from "../llm.js";
import type { PipelineStage } from "../orchestrator.js";

const SYSTEM_PROMPT = `You are a precise execution packet generator. Your job is to synthesize a complete, actionable execution packet from extracted requirements, mapped concepts, and a concept primer.

Output a Markdown document with EXACTLY these 9 sections as level-2 headings (##), in this order:

## What You Are Building
A clear, concise summary of the project/assignment. What is the end deliverable?

## Acceptance Criteria
Specific, testable criteria that define "done." Each criterion should be verifiable.

## Requirements Checklist
A table or checklist of all extracted requirements with their IDs (REQ-xxx), types, and text.
Every requirement from the input MUST appear here.

## Required Concepts
A summary of each concept the student needs to understand, with brief descriptions.

## System / Component Breakdown
How the system should be organized: modules, classes, data structures, and their relationships.

## Execution Plan
Step-by-step implementation order. What to build first, second, etc. Include dependencies between steps.

## Common Pitfalls and Edge Cases
Specific mistakes students commonly make on this type of assignment. Include edge cases to watch for.

## Validation and Testing Plan
How to verify the implementation is correct. Include specific test cases or testing strategies.

## Open Questions
Any ambiguities, unclear requirements, or decisions the student needs to make. If there are none, write "None identified."

Rules:
- Use the exact heading names listed above (## level)
- Do NOT leave any section empty — every section must have substantive content
- Do NOT use "TBD" or "TODO" placeholders anywhere
- Reference requirement IDs (REQ-xxx) where relevant
- Include source citations in [file_id, locator] format where available
- Do NOT wrap the output in code fences
- Do NOT include any preamble before the first heading`;

const REQUIRED_HEADINGS = [
  "What You Are Building",
  "Acceptance Criteria",
  "Requirements Checklist",
  "Required Concepts",
  "System / Component Breakdown",
  "Execution Plan",
  "Common Pitfalls and Edge Cases",
  "Validation and Testing Plan",
  "Open Questions",
];

/**
 * Read and validate requirements.json and concepts.json from the output directory.
 */
export function readPriorOutputs(outputDir: string): {
  requirements: RequirementsOutput;
  concepts: ConceptsOutput;
} {
  let requirementsRaw: string;
  try {
    requirementsRaw = readFileSync(join(outputDir, "requirements.json"), "utf-8");
  } catch {
    throw new Error(
      `generate_packet stage requires requirements.json in output directory '${outputDir}'. ` +
        "Ensure the extract_requirements stage runs before this stage.",
    );
  }

  let conceptsRaw: string;
  try {
    conceptsRaw = readFileSync(join(outputDir, "concepts.json"), "utf-8");
  } catch {
    throw new Error(
      `generate_packet stage requires concepts.json in output directory '${outputDir}'. ` +
        "Ensure the map_concepts stage runs before this stage.",
    );
  }

  const requirementsParse = RequirementsOutputSchema.safeParse(
    JSON.parse(requirementsRaw),
  );
  if (!requirementsParse.success) {
    throw new Error(
      "generate_packet stage found invalid requirements.json. " +
        `Validation errors: ${requirementsParse.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const conceptsParse = ConceptsOutputSchema.safeParse(
    JSON.parse(conceptsRaw),
  );
  if (!conceptsParse.success) {
    throw new Error(
      "generate_packet stage found invalid concepts.json. " +
        `Validation errors: ${conceptsParse.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  return {
    requirements: requirementsParse.data,
    concepts: conceptsParse.data,
  };
}

/**
 * Build the user message from all prior stage outputs.
 */
export function buildPacketUserMessage(
  requirements: RequirementsOutput,
  concepts: ConceptsOutput,
  primer: string,
): string {
  const reqLines = requirements.requirements.map(
    (r) => `- ${r.id} [${r.type}]: ${r.text} (source: ${r.source_ref.file_id}, ${r.source_ref.section ?? r.source_ref.page ?? "unknown"})`,
  );
  const reqSection = `=== REQUIREMENTS ===\n${reqLines.join("\n")}`;

  const conceptLines = concepts.concepts.map(
    (c) =>
      `- ${c.id}: "${c.name}" — ${c.description} (linked to: ${c.requirement_ids.join(", ")})`,
  );
  const conceptSection = `=== CONCEPTS ===\n${conceptLines.join("\n")}`;

  const primerSection = `=== CONCEPT PRIMER ===\n${primer}`;

  return (
    `Generate a complete execution packet from the following inputs.\n\n` +
    `${reqSection}\n\n${conceptSection}\n\n${primerSection}`
  );
}

/**
 * Post-LLM validation: check packet invariants.
 * Returns the text as-is if valid, or "" to trigger retry.
 */
export function validatePacketInvariants(text: string): string {
  // Extract all headings (# or ##) from the Markdown
  const headingPattern = /^#{1,2}\s+(.+)$/gm;
  const headings = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(text)) !== null) {
    headings.add(match[1]!.trim().toLowerCase());
  }

  // Check all 9 required headings are present (case-insensitive)
  for (const required of REQUIRED_HEADINGS) {
    if (!headings.has(required.toLowerCase())) {
      return "";
    }
  }

  // No TBD placeholders (word boundary match to avoid false positives like "STDOUT")
  if (/\bTBD\b/i.test(text)) {
    return "";
  }

  // Requirements table/list must contain at least one REQ- reference
  if (!/REQ-/.test(text)) {
    return "";
  }

  // Acceptance criteria section must have content after heading
  const acPattern = /^#{1,2}\s+Acceptance Criteria\s*$([\s\S]*?)(?=^#{1,2}\s|\z)/im;
  const acMatch = acPattern.exec(text);
  if (!acMatch || acMatch[1]!.trim().length === 0) {
    return "";
  }

  // Open questions section must exist (already checked via heading, content can be "None")

  return text;
}

async function run(input: unknown, ctx: RunContext): Promise<unknown> {
  // Validate input is a valid primer string (non-empty)
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(
      "generate_packet stage requires a non-empty primer string as input. " +
        "Ensure the explain_concepts stage runs before this stage.",
    );
  }

  const { requirements, concepts } = readPriorOutputs(ctx.config.output_dir);
  const userMessage = buildPacketUserMessage(requirements, concepts, input);

  const response = await callLLM({
    system: SYSTEM_PROMPT,
    user: userMessage,
    maxTokens: 8192,
  });

  let text = response.text.trim();

  // Strip markdown code fences if the LLM wrapped the output
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
  }

  // Post-LLM validation: check packet invariants.
  // Returns "" if any check fails, which fails z.string().min(1) and triggers retry.
  return validatePacketInvariants(text);
}

export const generatePacketStage: PipelineStage = {
  name: "generate_packet",
  run,
  outputSchema: PacketOutputSchema,
  outputFilename: "packet.md",
};
