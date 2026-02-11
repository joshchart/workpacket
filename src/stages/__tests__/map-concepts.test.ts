import { describe, test, expect, mock } from "bun:test";
import { join } from "node:path";
import type { RunContext } from "../../schemas/stage.js";
import type { Chunk } from "../../schemas/chunk.js";
import type { StorageReader, RetrievalOptions } from "../../storage.js";
import type { RequirementsOutput } from "../../schemas/requirement.js";
import { ConceptsOutputSchema } from "../../schemas/concept.js";

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

function makeRequirementsInput(): RequirementsOutput {
  return {
    requirements: [
      {
        id: "REQ-001",
        text: "Implement binary search tree",
        type: "functional",
        source_ref: { file_id: "spec.md", section: "Requirements" },
      },
      {
        id: "REQ-002",
        text: "Must use C99 or later",
        type: "constraint",
        source_ref: { file_id: "spec.md", section: "Constraints" },
      },
    ],
  };
}

// ── formatChunks Tests ──────────────────────────────────────────────

describe("formatChunks", () => {
  test("formats chunk with file_id and section", async () => {
    const { formatChunks } = await import("../map-concepts.js");
    const chunks: Chunk[] = [makeChunk("c1", "spec.md", "Implement BST")];
    const result = formatChunks(chunks);
    expect(result).toContain("Chunk 1");
    expect(result).toContain("file: spec.md");
    expect(result).toContain("section: Test Section");
    expect(result).toContain("Implement BST");
  });

  test("includes line numbers when present", async () => {
    const { formatChunks } = await import("../map-concepts.js");
    const chunks: Chunk[] = [
      {
        chunk_id: "c1",
        file_id: "spec.md",
        text: "Some content",
        source_ref: { file_id: "spec.md", line_start: 10, line_end: 20 },
      },
    ];
    const result = formatChunks(chunks);
    expect(result).toContain("lines: 10-20");
  });

  test("includes page number when present", async () => {
    const { formatChunks } = await import("../map-concepts.js");
    const chunks: Chunk[] = [
      {
        chunk_id: "c1",
        file_id: "doc.pdf",
        text: "Page content",
        source_ref: { file_id: "doc.pdf", page: 3 },
      },
    ];
    const result = formatChunks(chunks);
    expect(result).toContain("page: 3");
  });

  test("numbers chunks sequentially", async () => {
    const { formatChunks } = await import("../map-concepts.js");
    const chunks: Chunk[] = [
      makeChunk("c1", "a.md", "First"),
      makeChunk("c2", "b.md", "Second"),
      makeChunk("c3", "c.md", "Third"),
    ];
    const result = formatChunks(chunks);
    expect(result).toContain("Chunk 1");
    expect(result).toContain("Chunk 2");
    expect(result).toContain("Chunk 3");
  });

  test("does NOT include extraction-specific instructions", async () => {
    const { formatChunks } = await import("../map-concepts.js");
    const chunks: Chunk[] = [makeChunk("c1", "spec.md", "Content")];
    const result = formatChunks(chunks);
    expect(result).not.toContain("Extract all requirements");
  });
});

// ── buildConceptsUserMessage Tests ──────────────────────────────────

describe("buildConceptsUserMessage", () => {
  test("includes requirements section with IDs and types", async () => {
    const { buildConceptsUserMessage } = await import("../map-concepts.js");
    const reqs = makeRequirementsInput();
    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const msg = buildConceptsUserMessage(reqs, chunks);
    expect(msg).toContain("=== REQUIREMENTS ===");
    expect(msg).toContain("REQ-001");
    expect(msg).toContain("[functional]");
    expect(msg).toContain("REQ-002");
    expect(msg).toContain("[constraint]");
  });

  test("includes chunk section with source metadata", async () => {
    const { buildConceptsUserMessage } = await import("../map-concepts.js");
    const reqs = makeRequirementsInput();
    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const msg = buildConceptsUserMessage(reqs, chunks);
    expect(msg).toContain("=== ASSIGNMENT MATERIALS ===");
    expect(msg).toContain("file: spec.md");
    expect(msg).toContain("BST content");
  });

  test("formats multiple requirements correctly", async () => {
    const { buildConceptsUserMessage } = await import("../map-concepts.js");
    const reqs = makeRequirementsInput();
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const msg = buildConceptsUserMessage(reqs, chunks);
    expect(msg).toContain("- REQ-001: [functional] Implement binary search tree");
    expect(msg).toContain("- REQ-002: [constraint] Must use C99 or later");
  });

  test("does NOT contain extraction-specific text", async () => {
    const { buildConceptsUserMessage } = await import("../map-concepts.js");
    const reqs = makeRequirementsInput();
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const msg = buildConceptsUserMessage(reqs, chunks);
    expect(msg).not.toContain("Extract all requirements");
  });
});

// ── filterHallucinatedRequirementIds Tests ──────────────────────────

describe("filterHallucinatedRequirementIds", () => {
  test("passes through concepts with valid requirement_ids unchanged", async () => {
    const { filterHallucinatedRequirementIds } = await import(
      "../map-concepts.js"
    );
    const validIds = new Set(["REQ-001", "REQ-002"]);
    const input = {
      concepts: [
        {
          id: "CON-001",
          name: "BST",
          description: "Tree structure",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "Requirements" }],
        },
      ],
    };
    const result = filterHallucinatedRequirementIds(input, validIds);
    expect(result).toEqual(input);
  });

  test("strips hallucinated requirement_ids from concepts (keeps valid ones)", async () => {
    const { filterHallucinatedRequirementIds } = await import(
      "../map-concepts.js"
    );
    const validIds = new Set(["REQ-001"]);
    const input = {
      concepts: [
        {
          id: "CON-001",
          name: "BST",
          description: "Tree structure",
          requirement_ids: ["REQ-001", "REQ-999"],
          source_refs: [{ file_id: "spec.md", section: "Requirements" }],
        },
      ],
    };
    const result = filterHallucinatedRequirementIds(input, validIds) as any;
    expect(result.concepts[0].requirement_ids).toEqual(["REQ-001"]);
    expect(result.concepts[0].requirement_ids).not.toContain("REQ-999");
  });

  test("drops entire concept when all its requirement_ids are hallucinated", async () => {
    const { filterHallucinatedRequirementIds } = await import(
      "../map-concepts.js"
    );
    const validIds = new Set(["REQ-001"]);
    const input = {
      concepts: [
        {
          id: "CON-001",
          name: "Valid",
          description: "Has valid ID",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "A" }],
        },
        {
          id: "CON-002",
          name: "Invalid",
          description: "All IDs hallucinated",
          requirement_ids: ["REQ-999", "REQ-888"],
          source_refs: [{ file_id: "spec.md", section: "B" }],
        },
      ],
    };
    const result = filterHallucinatedRequirementIds(input, validIds) as any;
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].id).toBe("CON-001");
  });

  test("returns {} when all concepts are dropped (triggers retry)", async () => {
    const { filterHallucinatedRequirementIds } = await import(
      "../map-concepts.js"
    );
    const validIds = new Set(["REQ-001"]);
    const input = {
      concepts: [
        {
          id: "CON-001",
          name: "Invalid",
          description: "All hallucinated",
          requirement_ids: ["REQ-999"],
          source_refs: [{ file_id: "spec.md", section: "A" }],
        },
      ],
    };
    const result = filterHallucinatedRequirementIds(input, validIds);
    expect(result).toEqual({});
  });

  test("passes through non-concepts-shaped input unchanged (let Zod catch it)", async () => {
    const { filterHallucinatedRequirementIds } = await import(
      "../map-concepts.js"
    );
    const validIds = new Set(["REQ-001"]);

    expect(filterHallucinatedRequirementIds(null, validIds)).toBeNull();
    expect(filterHallucinatedRequirementIds("string", validIds)).toBe("string");
    expect(filterHallucinatedRequirementIds({ foo: "bar" }, validIds)).toEqual({
      foo: "bar",
    });
  });
});

// ── Stage Metadata Tests ────────────────────────────────────────────

describe("map-concepts stage metadata", () => {
  test("stage name is map_concepts", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    expect(mapConceptsStage.name).toBe("map_concepts");
  });

  test("output filename is concepts.json", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    expect(mapConceptsStage.outputFilename).toBe("concepts.json");
  });

  test("output schema matches ConceptsOutputSchema", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    expect(mapConceptsStage.outputSchema).toBe(ConceptsOutputSchema);
  });
});

// ── Stage Error Path Tests ──────────────────────────────────────────

describe("map-concepts stage error paths", () => {
  test("throws when storage is not available", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    const ctx = makeCtx(undefined);
    const input = makeRequirementsInput();

    await expect(mapConceptsStage.run(input, ctx)).rejects.toThrow(
      "requires storage",
    );
  });

  test("throws when storage returns zero chunks (both dynamic query + retrieveByTag)", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    const ctx = makeCtx(makeEmptyStorage());
    const input = makeRequirementsInput();

    await expect(mapConceptsStage.run(input, ctx)).rejects.toThrow(
      "No chunks retrieved",
    );
  });

  test("throws when input is not RequirementsOutput (fails Zod safeParse)", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const ctx = makeCtx(makeStorage(chunks));

    await expect(mapConceptsStage.run("not an object", ctx)).rejects.toThrow(
      "requires valid RequirementsOutput",
    );
  });

  test("throws when input has malformed requirement objects (Zod catches)", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    const chunks = [makeChunk("c1", "spec.md", "Content")];
    const ctx = makeCtx(makeStorage(chunks));

    // Has requirements array but objects are missing required fields
    const malformed = {
      requirements: [{ id: "REQ-001" }], // missing text, type, source_ref
    };

    await expect(mapConceptsStage.run(malformed, ctx)).rejects.toThrow(
      "requires valid RequirementsOutput",
    );
  });
});

// ── Retrieval Fallback Tests ────────────────────────────────────────

describe("map-concepts retrieval fallback", () => {
  test("uses primary query when it returns results", async () => {
    const validResponse = JSON.stringify({
      concepts: [
        {
          id: "CON-001",
          name: "BST Structure",
          description: "Understanding BST node structure",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "Test Section" }],
        },
      ],
    });

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

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
    await mod.mapConceptsStage.run(makeRequirementsInput(), ctx);

    // Should only call retrieve once (primary succeeds)
    expect(retrieveCallCount).toBe(1);
  });

  test("falls back to retrieveByTag when dynamic query returns zero results", async () => {
    const validResponse = JSON.stringify({
      concepts: [
        {
          id: "CON-001",
          name: "BST Structure",
          description: "Understanding BST node structure",
          requirement_ids: ["REQ-001"],
          source_refs: [{ file_id: "spec.md", section: "Test Section" }],
        },
      ],
    });

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

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
    await mod.mapConceptsStage.run(makeRequirementsInput(), ctx);

    // Should fall back to retrieveByTag("slides")
    expect(retrieveByTagCalled).toBe(true);
  });

  test("throws only when both dynamic query and retrieveByTag return zero", async () => {
    const { mapConceptsStage } = await import("../map-concepts.js");
    const ctx = makeCtx(makeEmptyStorage());
    const input = makeRequirementsInput();

    await expect(mapConceptsStage.run(input, ctx)).rejects.toThrow(
      "No chunks retrieved",
    );
  });
});

// ── Mock LLM Integration Tests ──────────────────────────────────────

describe("map-concepts with mocked LLM", () => {
  const validResponse = JSON.stringify({
    concepts: [
      {
        id: "CON-001",
        name: "Binary Search Tree Structure",
        description:
          "Understanding the node-based tree structure where left children are smaller and right children are larger",
        requirement_ids: ["REQ-001"],
        source_refs: [{ file_id: "spec.md", section: "Requirements" }],
      },
      {
        id: "CON-002",
        name: "BST Operations",
        description:
          "Implementing insert, search, and delete operations on a binary search tree",
        requirement_ids: ["REQ-001", "REQ-002"],
        source_refs: [{ file_id: "spec.md", section: "Interface" }],
      },
    ],
  });

  test("returns parsed output when LLM returns valid JSON", async () => {
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST in C")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.mapConceptsStage.run(
      makeRequirementsInput(),
      ctx,
    );

    expect(result).toEqual(JSON.parse(validResponse));
    const parsed = ConceptsOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  test("returns empty object when LLM returns invalid JSON (enables retry)", async () => {
    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: "This is not JSON at all, sorry!",
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.mapConceptsStage.run(
      makeRequirementsInput(),
      ctx,
    );

    // Should return {} (not throw), allowing orchestrator retry
    expect(result).toEqual({});

    // {} should fail ConceptsOutputSchema validation (triggering retry)
    const parsed = ConceptsOutputSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  test("handles markdown-fenced JSON response", async () => {
    const fencedResponse = "```json\n" + validResponse + "\n```";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: fencedResponse,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "Implement BST")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = await mod.mapConceptsStage.run(
      makeRequirementsInput(),
      ctx,
    );

    expect(result).toEqual(JSON.parse(validResponse));
  });

  test("filters out hallucinated requirement_ids from LLM output", async () => {
    const responseWithHallucination = JSON.stringify({
      concepts: [
        {
          id: "CON-001",
          name: "BST Structure",
          description: "Understanding BST",
          requirement_ids: ["REQ-001", "REQ-999"], // REQ-999 doesn't exist
          source_refs: [{ file_id: "spec.md", section: "Requirements" }],
        },
      ],
    });

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: responseWithHallucination,
        inputTokens: 100,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../map-concepts.js");

    const chunks = [makeChunk("c1", "spec.md", "BST content")];
    const storage = makeStorage(chunks);
    const ctx = makeCtx(storage);

    const result = (await mod.mapConceptsStage.run(
      makeRequirementsInput(),
      ctx,
    )) as any;

    // REQ-999 should be filtered out, REQ-001 kept
    expect(result.concepts[0].requirement_ids).toEqual(["REQ-001"]);
    expect(result.concepts[0].requirement_ids).not.toContain("REQ-999");
  });
});

