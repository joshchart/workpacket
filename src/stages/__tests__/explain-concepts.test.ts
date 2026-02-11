import { describe, test, expect, mock, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunContext } from "../../schemas/stage.js";
import type { Chunk } from "../../schemas/chunk.js";
import type { StorageReader, RetrievalOptions } from "../../storage.js";
import type { ConceptsOutput } from "../../schemas/concept.js";
import { PrimerOutputSchema } from "../../schemas/primer-output.js";


// ── Helpers ──────────────────────────────────────────────────────────

function makeStorage(chunks: Chunk[]): StorageReader {
  return {
    retrieve(_options: RetrievalOptions): Chunk[] {
      return chunks;
    },
    retrieveByTag(_tag: string, _limit?: number): Chunk[] {
      return chunks;
    },
    close(): void {},
  };
}

/** Storage that returns empty for the first call, then chunks for the second (fallback). */
function makeFallbackStorage(chunks: Chunk[]): StorageReader {
  let callCount = 0;
  return {
    retrieve(_options: RetrievalOptions): Chunk[] {
      callCount++;
      return callCount === 1 ? [] : chunks;
    },
    retrieveByTag(_tag: string, _limit?: number): Chunk[] {
      return chunks;
    },
    close(): void {},
  };
}

/** Storage that always returns empty (both primary and fallback). */
function makeEmptyStorage(): StorageReader {
  return {
    retrieve(_options: RetrievalOptions): Chunk[] {
      return [];
    },
    retrieveByTag(_tag: string, _limit?: number): Chunk[] {
      return [];
    },
    close(): void {},
  };
}

function makeChunk(id: string, fileId: string, text: string): Chunk {
  return {
    chunk_id: id,
    file_id: fileId,
    text,
    source_ref: { file_id: fileId, section: "Test Section" },
  };
}

function makeCtx(storage?: StorageReader): RunContext {
  return {
    config: {
      assignment_id: "test",
      input_paths: ["/tmp/test"],
      output_dir: "/tmp/test-output",

    },
    run_id: "test-run",
    storage,
  };
}

function makeConcepts(): ConceptsOutput {
  return {
    concepts: [
      {
        id: "CON-001",
        name: "Binary Search Tree",
        description: "Tree data structure with ordered nodes",
        requirement_ids: ["REQ-001"],
        source_refs: [{ file_id: "spec.md", section: "Overview" }],
      },
      {
        id: "CON-002",
        name: "Memory Management",
        description: "Manual memory allocation and deallocation in C",
        requirement_ids: ["REQ-002", "REQ-003"],
        source_refs: [{ file_id: "slides.pdf", page: 5 }],
      },
    ],
  };
}

// ── buildPrimerUserMessage Tests ─────────────────────────────────────

describe("buildPrimerUserMessage", () => {
  test("formats concept list with IDs, names, descriptions, and requirement links", async () => {
    const { buildPrimerUserMessage } = await import("../explain-concepts.js");
    const concepts = makeConcepts();
    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const msg = buildPrimerUserMessage(concepts, chunks);

    expect(msg).toContain("=== CONCEPTS TO EXPLAIN ===");
    expect(msg).toContain('CON-001: "Binary Search Tree"');
    expect(msg).toContain("Tree data structure with ordered nodes");
    expect(msg).toContain("linked to: REQ-001");
    expect(msg).toContain('CON-002: "Memory Management"');
    expect(msg).toContain("linked to: REQ-002, REQ-003");
  });

  test("formats chunks with source metadata", async () => {
    const { buildPrimerUserMessage } = await import("../explain-concepts.js");
    const concepts = makeConcepts();
    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const msg = buildPrimerUserMessage(concepts, chunks);

    expect(msg).toContain("=== ASSIGNMENT MATERIALS ===");
    expect(msg).toContain("file: spec.md");
    expect(msg).toContain("section: Test Section");
    expect(msg).toContain("BST content");
  });

  test("handles single concept", async () => {
    const { buildPrimerUserMessage } = await import("../explain-concepts.js");
    const concepts: ConceptsOutput = {
      concepts: [
        {
          id: "CON-001",
          name: "Only Concept",
          description: "The only one",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "A" }],
        },
      ],
    };
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const msg = buildPrimerUserMessage(concepts, chunks);

    expect(msg).toContain('CON-001: "Only Concept"');
    expect(msg).not.toContain("CON-002");
  });

  test("handles multiple concepts with multiple requirement IDs", async () => {
    const { buildPrimerUserMessage } = await import("../explain-concepts.js");
    const concepts = makeConcepts();
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const msg = buildPrimerUserMessage(concepts, chunks);

    // CON-002 links to REQ-002 and REQ-003
    expect(msg).toContain("linked to: REQ-002, REQ-003");
  });
});

// ── validateConceptHeadings Tests ────────────────────────────────────

describe("validateConceptHeadings", () => {
  test("returns text when all concept names appear as ## headings", async () => {
    const { validateConceptHeadings } = await import("../explain-concepts.js");
    const text = "## Binary Search Tree\n\nSome explanation.\n\n## Memory Management\n\nAnother explanation.";
    const result = validateConceptHeadings(text, [
      "Binary Search Tree",
      "Memory Management",
    ]);
    expect(result).toBe(text);
  });

  test('returns "" when a concept heading is missing', async () => {
    const { validateConceptHeadings } = await import("../explain-concepts.js");
    const text = "## Binary Search Tree\n\nSome explanation.";
    const result = validateConceptHeadings(text, [
      "Binary Search Tree",
      "Memory Management",
    ]);
    expect(result).toBe("");
  });

  test("case-insensitive matching", async () => {
    const { validateConceptHeadings } = await import("../explain-concepts.js");
    const text = "## binary search tree\n\nExplanation.";
    const result = validateConceptHeadings(text, ["Binary Search Tree"]);
    expect(result).toBe(text);
  });

  test("handles extra headings in output (doesn't fail on bonus sections)", async () => {
    const { validateConceptHeadings } = await import("../explain-concepts.js");
    const text =
      "## Binary Search Tree\n\nExplanation.\n\n## Extra Section\n\nBonus content.";
    const result = validateConceptHeadings(text, ["Binary Search Tree"]);
    expect(result).toBe(text);
  });

  test("handles concept names with special regex characters", async () => {
    const { validateConceptHeadings } = await import("../explain-concepts.js");
    const text = "## C++ Templates (STL)\n\nExplanation.";
    const result = validateConceptHeadings(text, ["C++ Templates (STL)"]);
    expect(result).toBe(text);
  });
});

// ── Stage Metadata Tests ────────────────────────────────────────────

describe("explain-concepts stage metadata", () => {
  test("stage name is explain_concepts", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    expect(explainConceptsStage.name).toBe("explain_concepts");
  });

  test("output filename is primer.md", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    expect(explainConceptsStage.outputFilename).toBe("primer.md");
  });

  test("output schema matches PrimerOutputSchema", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    expect(explainConceptsStage.outputSchema).toBe(PrimerOutputSchema);
  });
});

// ── Stage Error Path Tests ──────────────────────────────────────────

describe("explain-concepts stage error paths", () => {
  test("throws when storage is not available", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    const ctx = makeCtx(undefined);
    const input = makeConcepts();

    await expect(explainConceptsStage.run(input, ctx)).rejects.toThrow(
      "requires storage",
    );
  });

  test("throws when input is not valid ConceptsOutput", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const ctx = makeCtx(makeStorage(chunks));

    await expect(
      explainConceptsStage.run("not an object", ctx),
    ).rejects.toThrow("requires valid ConceptsOutput");
  });

  test("throws when input has malformed concept objects (Zod catches)", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const ctx = makeCtx(makeStorage(chunks));

    const malformed = {
      concepts: [{ id: "CON-001" }], // missing name, description, etc.
    };

    await expect(
      explainConceptsStage.run(malformed, ctx),
    ).rejects.toThrow("requires valid ConceptsOutput");
  });

  test("throws when storage returns zero chunks (both dynamic query + retrieveByTag)", async () => {
    const { explainConceptsStage } = await import("../explain-concepts.js");
    const ctx = makeCtx(makeEmptyStorage());
    const input = makeConcepts();

    await expect(explainConceptsStage.run(input, ctx)).rejects.toThrow(
      "No chunks retrieved",
    );
  });
});

// ── Retrieval Fallback Tests ────────────────────────────────────────

describe("explain-concepts retrieval fallback", () => {
  test("uses primary query when it returns results", async () => {
    const validPrimer =
      "## Binary Search Tree\n\nExplanation.\n\n## Memory Management\n\nExplanation.";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validPrimer,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    let retrieveCallCount = 0;
    const storage: StorageReader = {
      retrieve(_options: RetrievalOptions): Chunk[] {
        retrieveCallCount++;
        return [makeChunk("c1", "spec.md", "BST content")];
      },
      retrieveByTag(_tag: string, _limit?: number): Chunk[] {
        return [makeChunk("c1", "spec.md", "BST content")];
      },
      close(): void {},
    };

    const ctx = makeCtx(storage);
    await mod.explainConceptsStage.run(makeConcepts(), ctx);

    // Should only call retrieve once (primary succeeds)
    expect(retrieveCallCount).toBe(1);
  });

  test("falls back to retrieveByTag when dynamic query returns zero results", async () => {
    const validPrimer =
      "## Binary Search Tree\n\nExplanation.\n\n## Memory Management\n\nExplanation.";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validPrimer,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    let retrieveByTagCalled = false;
    const storage: StorageReader = {
      retrieve(_options: RetrievalOptions): Chunk[] {
        return []; // Dynamic query returns nothing
      },
      retrieveByTag(_tag: string, _limit?: number): Chunk[] {
        retrieveByTagCalled = true;
        return [makeChunk("c1", "spec.md", "BST content")];
      },
      close(): void {},
    };

    const ctx = makeCtx(storage);
    await mod.explainConceptsStage.run(makeConcepts(), ctx);

    // Should fall back to retrieveByTag("slides")
    expect(retrieveByTagCalled).toBe(true);
  });
});

// ── Mock LLM Integration Tests ──────────────────────────────────────

describe("explain-concepts with mocked LLM", () => {
  const validPrimer =
    "## Binary Search Tree\n\nA binary search tree maintains the invariant that left < root < right. [spec.md, Overview]\n\n## Memory Management\n\nManual memory allocation using malloc and free. [slides.pdf, page 5]";

  test("returns valid Markdown when LLM returns well-formed primer", async () => {
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validPrimer,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.explainConceptsStage.run(makeConcepts(), ctx);

    expect(result).toBe(validPrimer);
    const parsed = PrimerOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  test('returns "" (triggers retry) when LLM output is missing concept headings', async () => {
    const incompletePrimer =
      "## Binary Search Tree\n\nExplanation for BST only.";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: incompletePrimer,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.explainConceptsStage.run(makeConcepts(), ctx);

    // Missing "Memory Management" heading → returns "" to trigger retry
    expect(result).toBe("");

    // "" should fail PrimerOutputSchema validation (triggering retry)
    const parsed = PrimerOutputSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  test("strips code fences and validates headings", async () => {
    const fencedPrimer =
      "```markdown\n## Binary Search Tree\n\nExplanation.\n\n## Memory Management\n\nExplanation.\n```";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: fencedPrimer,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.explainConceptsStage.run(makeConcepts(), ctx);

    // Should have stripped fences and returned valid Markdown
    expect(typeof result).toBe("string");
    expect(result as string).toContain("## Binary Search Tree");
    expect(result as string).not.toContain("```");
  });

  test('returns "" when code-fence-stripped output is missing headings', async () => {
    const fencedIncomplete = "```markdown\n## Binary Search Tree\n\nOnly one concept.\n```";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: fencedIncomplete,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../explain-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.explainConceptsStage.run(makeConcepts(), ctx);

    // Missing "Memory Management" → returns ""
    expect(result).toBe("");
  });
});

