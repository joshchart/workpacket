import type { RunContext } from "../schemas/stage.js";
import type { Chunk } from "../schemas/chunk.js";
import {
  ConceptsOutputSchema,
  type ConceptsOutput,
} from "../schemas/concept.js";
import { PrimerOutputSchema } from "../schemas/primer-output.js";
import { callLLM } from "../llm.js";
import { formatChunks } from "./map-concepts.js";
import { buildDynamicQuery } from "../query-builder.js";
import type { PipelineStage } from "../orchestrator.js";

const RETRIEVAL_LIMIT = 30;

const SYSTEM_PROMPT = `You are a precise concept explanation system. Your job is to generate "just enough" explanations for each concept a student needs to understand to complete an assignment.

You will receive:
1. A list of concepts (with IDs, names, descriptions, and source references)
2. Assignment materials (chunks from specs, slides, and notes)

For each concept, write a concise explanation that:
- Explains the concept only as deeply as necessary for the assignment
- Uses concrete examples from the assignment materials where possible
- Includes inline source citations in the format [file_id, locator] (e.g., [spec.md, Section 3] or [slides.pdf, page 5])
- IMPORTANT: Copy citation values (file_id, section, line numbers, page) verbatim from the provided chunk metadata — do NOT invent or guess citations

Output format:
- Output valid Markdown
- Each concept MUST appear as a level-2 heading (## Concept Name)
- Use the exact concept name from the input as the heading text
- Keep explanations focused and actionable — not textbook-length
- Do NOT include any preamble, introduction, or conclusion sections
- Do NOT wrap the output in code fences

Example output structure:
## Binary Search Tree Insertion

A binary search tree (BST) maintains the invariant that... [spec.md, Section 2.1]

To insert a node, compare the value with the current node... [slides.pdf, page 12]

## Memory Management in C

The assignment requires manual memory management using malloc/free... [spec.md, Section 3]`;

/**
 * Build the user message with concepts context and retrieved chunks.
 */
export function buildPrimerUserMessage(
  concepts: ConceptsOutput,
  chunks: Chunk[],
): string {
  const conceptLines = concepts.concepts.map(
    (c) =>
      `- ${c.id}: "${c.name}" — ${c.description} (linked to: ${c.requirement_ids.join(", ")})`,
  );
  const conceptSection = `=== CONCEPTS TO EXPLAIN ===\n${conceptLines.join("\n")}`;
  const chunkSection = formatChunks(chunks);

  return (
    `Generate "just enough" explanations for each concept listed below.\n` +
    `Use the source location metadata shown above each chunk for your citation values — do NOT invent citations.\n\n` +
    `${conceptSection}\n\n=== ASSIGNMENT MATERIALS ===\n${chunkSection}`
  );
}

/**
 * Post-LLM validation: check that each concept name appears as a
 * level-2 heading in the generated Markdown. Returns the text as-is
 * if all headings are present, or an empty string to trigger retry
 * if any concepts are missing.
 */
export function validateConceptHeadings(
  text: string,
  conceptNames: readonly string[],
): string {
  // Extract all ## headings from the Markdown
  const headingPattern = /^##\s+(.+)$/gm;
  const headings = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(text)) !== null) {
    headings.add(match[1]!.trim().toLowerCase());
  }

  // Check every concept name appears as a heading (case-insensitive)
  const missing = conceptNames.filter(
    (name) => !headings.has(name.toLowerCase()),
  );

  if (missing.length > 0) {
    return "";
  }

  return text;
}

async function run(input: unknown, ctx: RunContext): Promise<unknown> {
  // NOTE on error handling: same strategy as extract-requirements and map-concepts.
  // THROW for unrecoverable errors, RETURN malformed output for retryable errors.

  const storage = ctx.storage;
  if (!storage) {
    throw new Error(
      "explain_concepts stage requires storage in RunContext. " +
        "Ensure the ingest stage runs before this stage.",
    );
  }

  // Validate input is ConceptsOutput from the previous stage
  const conceptsParse = ConceptsOutputSchema.safeParse(input);
  if (!conceptsParse.success) {
    throw new Error(
      "explain_concepts stage requires valid ConceptsOutput as input. " +
        "Ensure the map_concepts stage runs before this stage. " +
        `Validation errors: ${conceptsParse.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const concepts = conceptsParse.data;

  // Build a dynamic query from concept names and descriptions.
  // This searches for content related to the actual concepts identified
  // in the previous stage, rather than generic concept keywords.
  const conceptTexts = concepts.concepts.flatMap((c) => [c.name, c.description]);
  const dynamicQuery = buildDynamicQuery(conceptTexts);

  let chunks: Chunk[];
  if (dynamicQuery) {
    chunks = storage.retrieve({
      query: dynamicQuery,
      limit: RETRIEVAL_LIMIT,
      bias: "slides",
    });
  } else {
    chunks = [];
  }

  // Fallback: if no chunks matched, retrieve all slides-tagged chunks.
  if (chunks.length === 0) {
    chunks = storage.retrieveByTag("slides", RETRIEVAL_LIMIT);
  }

  if (chunks.length === 0) {
    throw new Error(
      "No chunks retrieved for concept explanation. " +
        "The storage index may be empty or the assignment materials may not contain explanatory content.",
    );
  }

  const userMessage = buildPrimerUserMessage(concepts, chunks);
  const response = await callLLM({
    system: SYSTEM_PROMPT,
    user: userMessage,
  });

  const text = response.text.trim();

  // Strip markdown code fences if the LLM wrapped the output
  let cleaned = text;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```$/, "");
  }

  // Post-LLM validation: ensure all concepts appear as headings.
  // Returns "" if any are missing, which fails z.string().min(1) and triggers retry.
  const conceptNames = concepts.concepts.map((c) => c.name);
  return validateConceptHeadings(cleaned, conceptNames);
}

export const explainConceptsStage: PipelineStage = {
  name: "explain_concepts",
  run,
  outputSchema: PrimerOutputSchema,
  outputFilename: "primer.md",
};
