import type { RunContext } from "../schemas/stage.js";
import type { Chunk } from "../schemas/chunk.js";
import {
  RequirementsOutputSchema,
  type RequirementsOutput,
} from "../schemas/requirement.js";
import { ConceptsOutputSchema } from "../schemas/concept.js";
import { callLLM } from "../llm.js";
import { parseJSON } from "./extract-requirements.js";
import { buildDynamicQuery } from "../query-builder.js";
import type { PipelineStage } from "../orchestrator.js";

const RETRIEVAL_LIMIT = 30;

const SYSTEM_PROMPT = `You are a precise concept mapping system. Your job is to identify the key concepts a student needs to understand in order to complete an assignment, and link each concept to specific requirements.

You will receive:
1. A list of extracted requirements (with IDs like REQ-001, REQ-002, etc.)
2. Assignment materials (chunks from specs, slides, and notes)

For each concept you identify, produce a JSON object with:
- "id": A short stable identifier like "CON-001", "CON-002", etc. (sequential)
- "name": A concise name for the concept (e.g., "Binary Search Tree Insertion", "Memory Management in C")
- "description": A one-sentence description of what the student needs to understand about this concept
- "requirement_ids": An array of requirement IDs (e.g., ["REQ-001", "REQ-003"]) that this concept relates to. Every concept MUST link to at least one requirement. Use ONLY IDs from the REQUIREMENTS list provided — do NOT invent requirement IDs.
- "source_refs": An array of source references indicating where this concept appears in the materials. Each source_ref must have "file_id" and at least one locator. IMPORTANT: Copy locator values (file_id, section, line_start, line_end, page) verbatim from the chunk metadata — do NOT invent or guess locators.

Rules:
- Identify concepts that are NECESSARY to complete the assignment — not every topic mentioned
- Each concept MUST link to at least one requirement via requirement_ids — use ONLY IDs from the provided requirements list
- Each concept MUST have at least one source_ref — use ONLY locator values provided in the chunk metadata
- Do NOT invent concepts that are not supported by the source materials
- Do NOT duplicate concepts — if two chunks mention the same concept, merge them into one entry with multiple source_refs
- Keep concept names specific and actionable (not vague like "Programming" or "Computer Science")
- Output ONLY valid JSON matching the schema below — no commentary, no markdown fences

Output schema:
{
  "concepts": [
    {
      "id": "CON-001",
      "name": "...",
      "description": "...",
      "requirement_ids": ["REQ-001", "REQ-002"],
      "source_refs": [{ "file_id": "...", "section": "..." }]
    }
  ]
}`;

/**
 * Format chunks with source metadata for inclusion in an LLM prompt.
 * This is map-concepts' own formatter — we intentionally do NOT reuse
 * buildUserMessage from extract-requirements because that function
 * embeds requirement-extraction-specific instructions in its output.
 */
export function formatChunks(chunks: Chunk[]): string {
  return chunks
    .map((chunk, i) => {
      const ref = chunk.source_ref;
      const locators: string[] = [`file: ${ref.file_id}`];
      if (ref.section) locators.push(`section: ${ref.section}`);
      if (ref.line_start != null)
        locators.push(
          `lines: ${ref.line_start}-${ref.line_end ?? ref.line_start}`,
        );
      if (ref.page != null) locators.push(`page: ${ref.page}`);

      return `--- Chunk ${i + 1} (${locators.join(", ")}) ---\n${chunk.text}`;
    })
    .join("\n\n");
}

/**
 * Build the user message with both requirements context and retrieved chunks.
 * The requirements section lets the LLM link concepts to requirement IDs.
 * The chunks section provides source material for concept identification.
 */
export function buildConceptsUserMessage(
  requirements: RequirementsOutput,
  chunks: Chunk[],
): string {
  const reqLines = requirements.requirements.map(
    (r) => `- ${r.id}: [${r.type}] ${r.text}`,
  );
  const reqSection = `=== REQUIREMENTS ===\n${reqLines.join("\n")}`;
  const chunkSection = formatChunks(chunks);

  return (
    `Identify the key concepts needed to complete this assignment and map each concept to the relevant requirement IDs.\n` +
    `Use the source location metadata shown above each chunk for your source_ref values — do NOT invent locations.\n\n` +
    `${reqSection}\n\n=== ASSIGNMENT MATERIALS ===\n${chunkSection}`
  );
}

/**
 * Post-LLM invariant: verify every requirement_id in the parsed output
 * actually exists in the input requirements. Strips any concepts that
 * reference hallucinated IDs. Returns the filtered output, or {} if
 * all concepts were invalid (triggers orchestrator retry).
 */
export function filterHallucinatedRequirementIds(
  parsed: unknown,
  validIds: ReadonlySet<string>,
): unknown {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("concepts" in parsed) ||
    !Array.isArray((parsed as any).concepts)
  ) {
    return parsed; // Let Zod catch structural issues
  }

  const concepts = (parsed as any).concepts as any[];
  const filtered = concepts
    .map((concept) => {
      if (!Array.isArray(concept.requirement_ids)) return concept;
      const kept = concept.requirement_ids.filter((id: string) =>
        validIds.has(id),
      );
      if (kept.length === 0) return null; // Drop concept — all IDs hallucinated
      return { ...concept, requirement_ids: kept };
    })
    .filter(Boolean);

  if (filtered.length === 0) return {}; // Trigger retry
  return { concepts: filtered };
}

async function run(input: unknown, ctx: RunContext): Promise<unknown> {
  // NOTE on error handling: same strategy as extract-requirements.
  // THROW for unrecoverable errors, RETURN malformed output for retryable errors.

  const storage = ctx.storage;
  if (!storage) {
    throw new Error(
      "map_concepts stage requires storage in RunContext. " +
        "Ensure the ingest stage runs before this stage.",
    );
  }

  // Validate input with the real Zod schema — catches malformed requirement
  // objects that a structural check would miss.
  const reqParse = RequirementsOutputSchema.safeParse(input);
  if (!reqParse.success) {
    throw new Error(
      "map_concepts stage requires valid RequirementsOutput as input. " +
        "Ensure the extract_requirements stage runs before this stage. " +
        `Validation errors: ${reqParse.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const requirements = reqParse.data;

  // Build the set of valid requirement IDs for post-LLM filtering
  const validReqIds = new Set(requirements.requirements.map((r) => r.id));

  // Build a dynamic query from the requirement texts this stage received.
  // This naturally adapts to whatever vocabulary the assignment uses.
  const reqTexts = requirements.requirements.map((r) => r.text);
  const dynamicQuery = buildDynamicQuery(reqTexts);

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

  // Fallback: if no chunks matched (requirements too terse or unusual vocab),
  // retrieve all slides-tagged chunks directly.
  if (chunks.length === 0) {
    chunks = storage.retrieveByTag("slides", RETRIEVAL_LIMIT);
  }

  if (chunks.length === 0) {
    throw new Error(
      "No chunks retrieved for concept mapping. " +
        "The storage index may be empty or the assignment materials may not contain concept-related content.",
    );
  }

  const userMessage = buildConceptsUserMessage(requirements, chunks);
  const response = await callLLM({
    system: SYSTEM_PROMPT,
    user: userMessage,
  });

  const parsed = parseJSON(response.text);

  if (parsed === null) {
    return {};
  }

  // Post-LLM invariant: strip any concepts that reference hallucinated
  // requirement IDs. If all concepts are invalid, returns {} to trigger retry.
  return filterHallucinatedRequirementIds(parsed, validReqIds);
}

export const mapConceptsStage: PipelineStage = {
  name: "map_concepts",
  run,
  outputSchema: ConceptsOutputSchema,
  outputFilename: "concepts.json",
};
