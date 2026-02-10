import type { RunContext } from "../schemas/stage.js";
import type { Chunk } from "../schemas/chunk.js";
import { RequirementsOutputSchema } from "../schemas/requirement.js";
import { callLLM } from "../llm.js";
import type { PipelineStage } from "../orchestrator.js";

// FTS5 treats space-separated terms as implicit AND. Use explicit OR so
// chunks matching *any* relevant term are returned rather than only those
// containing every term (which would miss most real-world assignments).
const RETRIEVAL_QUERY = "requirements OR constraints OR interface OR grading OR deliverables OR specification OR must OR shall";
const RETRIEVAL_LIMIT = 30;

const SYSTEM_PROMPT = `You are a precise requirement extraction system. Your job is to extract ALL requirements from assignment specification materials.

For each requirement you identify, produce a JSON object with:
- "id": A short stable identifier like "REQ-001", "REQ-002", etc. (sequential)
- "text": The requirement stated clearly in one sentence
- "type": One of "functional", "constraint", "interface", or "grading"
  - "functional": what the system must do (features, behaviors)
  - "constraint": limitations or rules (performance, memory, language restrictions)
  - "interface": API signatures, function names, file formats, command-line interfaces
  - "grading": how the assignment is scored, point breakdowns, rubric items
- "source_ref": An object with "file_id" and at least one locator. IMPORTANT:
  Each chunk in the input is annotated with its file_id, section, and/or line numbers.
  Copy these values verbatim into the source_ref — do NOT invent or guess locators.
  - "file_id": REQUIRED — the file the requirement came from (copy from chunk metadata)
  - "section": the heading/section name (copy from chunk metadata if provided)
  - "line_start": starting line number (copy from chunk metadata if provided)
  - "line_end": ending line number (copy from chunk metadata if provided)
  - "page": page number (copy from chunk metadata if provided)

Rules:
- Extract EVERY requirement, constraint, and interface specification you can find
- Do NOT invent requirements that are not in the source material
- Do NOT merge multiple distinct requirements into one
- Each requirement MUST have a source_ref — use ONLY the locator values provided in the chunk metadata
- If a requirement is ambiguous, extract it as-is and note the ambiguity in the text
- Output ONLY valid JSON matching the schema below — no commentary, no markdown fences

Output schema:
{
  "requirements": [
    {
      "id": "REQ-001",
      "text": "...",
      "type": "functional" | "constraint" | "interface" | "grading",
      "source_ref": { "file_id": "...", "section": "..." }
    }
  ]
}`;

/**
 * Build the user message by formatting each chunk with its full source_ref
 * metadata. This gives the LLM accurate locator information (file_id,
 * section, line_start, line_end, page) so it can cite sources faithfully
 * rather than inventing locators.
 */
export function buildUserMessage(chunks: Chunk[]): string {
  const sections = chunks.map((chunk, i) => {
    const ref = chunk.source_ref;
    const locators: string[] = [`file: ${ref.file_id}`];
    if (ref.section) locators.push(`section: ${ref.section}`);
    if (ref.line_start != null) locators.push(`lines: ${ref.line_start}-${ref.line_end ?? ref.line_start}`);
    if (ref.page != null) locators.push(`page: ${ref.page}`);

    return `--- Chunk ${i + 1} (${locators.join(", ")}) ---\n${chunk.text}`;
  });

  return `Extract all requirements from the following assignment materials.\nUse the source location metadata shown above each chunk for your source_ref values — do NOT invent locations.\n\n${sections.join("\n\n")}`;
}

/**
 * Parse the LLM response text as JSON.
 * Handles common issues: markdown code fences, leading/trailing whitespace.
 * Returns null if parsing fails (never throws).
 */
export function parseJSON(text: string): unknown | null {
  let cleaned = text.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function run(input: unknown, ctx: RunContext): Promise<unknown> {
  // NOTE on error handling: the orchestrator treats thrown errors as
  // immediate, non-retryable failures (src/orchestrator.ts:82-92).
  // Only Zod safeParse failures trigger retries (src/orchestrator.ts:94-116).
  // Therefore, this stage must THROW for unrecoverable errors (missing
  // storage, empty retrieval) but RETURN malformed output for retryable
  // errors (bad JSON from LLM, schema mismatch) so the orchestrator can
  // re-invoke the stage.

  const storage = ctx.storage;
  if (!storage) {
    throw new Error(
      "extract_requirements stage requires storage in RunContext. " +
      "Ensure the ingest stage runs before this stage."
    );
  }

  // Retrieve spec-biased chunks for requirement extraction
  const chunks = storage.retrieve({
    query: RETRIEVAL_QUERY,
    limit: RETRIEVAL_LIMIT,
    bias: "spec",
  });

  if (chunks.length === 0) {
    throw new Error(
      "No chunks retrieved for requirement extraction. " +
      "The storage index may be empty or the query may not match any content."
    );
  }

  const userMessage = buildUserMessage(chunks);
  const response = await callLLM({
    system: SYSTEM_PROMPT,
    user: userMessage,
  });

  const parsed = parseJSON(response.text);

  // If JSON parsing failed, return an empty object. This will fail the
  // orchestrator's safeParse check and trigger a retry (up to MAX_RETRIES).
  // We do NOT throw here because thrown errors skip the retry loop entirely.
  if (parsed === null) {
    return {};
  }

  // Return the parsed object as-is. The orchestrator validates it against
  // RequirementsOutputSchema via safeParse. If validation fails, the
  // orchestrator retries the stage. We do NOT call .parse() here because
  // that would throw on schema mismatch, bypassing the retry loop.
  return parsed;
}

export const extractRequirementsStage: PipelineStage = {
  name: "extract_requirements",
  run,
  outputSchema: RequirementsOutputSchema,
  outputFilename: "requirements.json",
};
