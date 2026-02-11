import { describe, test, expect, mock } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunContext } from "../../schemas/stage.js";
import type { RequirementsOutput } from "../../schemas/requirement.js";
import type { ConceptsOutput } from "../../schemas/concept.js";
import { PacketOutputSchema } from "../../schemas/packet-output.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeRequirements(): RequirementsOutput {
  return {
    requirements: [
      {
        id: "REQ-001",
        text: "Implement binary search tree insertion",
        type: "functional",
        source_ref: { file_id: "spec.md", section: "Section 2" },
      },
      {
        id: "REQ-002",
        text: "Handle memory deallocation properly",
        type: "constraint",
        source_ref: { file_id: "spec.md", section: "Section 3" },
      },
    ],
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
        requirement_ids: ["REQ-002"],
        source_refs: [{ file_id: "slides.pdf", page: 5 }],
      },
    ],
  };
}

function makePrimer(): string {
  return "## Binary Search Tree\n\nExplanation of BST.\n\n## Memory Management\n\nExplanation of memory.";
}

function makeValidPacket(): string {
  return `## What You Are Building

A binary search tree implementation in C with proper memory management.

## Acceptance Criteria

- BST insertion works correctly for all input types
- No memory leaks detected by valgrind
- REQ-001 and REQ-002 are satisfied

## Requirements Checklist

| ID | Type | Requirement |
|----|------|-------------|
| REQ-001 | functional | Implement binary search tree insertion |
| REQ-002 | constraint | Handle memory deallocation properly |

## Required Concepts

- Binary Search Tree: Tree data structure with ordered nodes
- Memory Management: Manual memory allocation and deallocation in C

## System / Component Breakdown

The system consists of a BST module with insert, search, and delete operations.

## Execution Plan

1. Define the BST node structure
2. Implement insertion
3. Implement search
4. Implement deletion with proper memory cleanup

## Common Pitfalls and Edge Cases

- Forgetting to free memory when deleting nodes
- Not handling duplicate insertions

## Validation and Testing Plan

- Unit test each BST operation
- Run valgrind to check for memory leaks

## Open Questions

None identified.`;
}

function makeOutputDir(options?: {
  skipRequirements?: boolean;
  skipConcepts?: boolean;
  invalidRequirements?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), "gen-packet-"));
  if (!options?.skipRequirements) {
    const content = options?.invalidRequirements
      ? JSON.stringify({ requirements: "not an array" })
      : JSON.stringify(makeRequirements(), null, 2);
    writeFileSync(join(dir, "requirements.json"), content);
  }
  if (!options?.skipConcepts) {
    writeFileSync(
      join(dir, "concepts.json"),
      JSON.stringify(makeConcepts(), null, 2),
    );
  }
  return dir;
}

function makeCtx(outputDir: string): RunContext {
  return {
    config: {
      assignment_id: "test",
      input_paths: ["/tmp/test"],
      output_dir: outputDir,
      draft_enabled: false,
    },
    run_id: "test-run",
  };
}

// ── buildPacketUserMessage Tests ─────────────────────────────────────

describe("buildPacketUserMessage", () => {
  test("formats requirements with IDs and types", async () => {
    const { buildPacketUserMessage } = await import("../generate-packet.js");
    const msg = buildPacketUserMessage(makeRequirements(), makeConcepts(), makePrimer());

    expect(msg).toContain("=== REQUIREMENTS ===");
    expect(msg).toContain("REQ-001 [functional]");
    expect(msg).toContain("Implement binary search tree insertion");
    expect(msg).toContain("REQ-002 [constraint]");
    expect(msg).toContain("Handle memory deallocation properly");
  });

  test("includes concept names and descriptions", async () => {
    const { buildPacketUserMessage } = await import("../generate-packet.js");
    const msg = buildPacketUserMessage(makeRequirements(), makeConcepts(), makePrimer());

    expect(msg).toContain("=== CONCEPTS ===");
    expect(msg).toContain('CON-001: "Binary Search Tree"');
    expect(msg).toContain("Tree data structure with ordered nodes");
    expect(msg).toContain('CON-002: "Memory Management"');
  });

  test("includes primer content", async () => {
    const { buildPacketUserMessage } = await import("../generate-packet.js");
    const msg = buildPacketUserMessage(makeRequirements(), makeConcepts(), makePrimer());

    expect(msg).toContain("=== CONCEPT PRIMER ===");
    expect(msg).toContain("Explanation of BST.");
  });

  test("handles empty concepts gracefully", async () => {
    const { buildPacketUserMessage } = await import("../generate-packet.js");
    const emptyConcepts: ConceptsOutput = { concepts: [] };
    const msg = buildPacketUserMessage(makeRequirements(), emptyConcepts, makePrimer());

    expect(msg).toContain("=== CONCEPTS ===");
    expect(msg).toContain("=== REQUIREMENTS ===");
  });
});

// ── validatePacketInvariants Tests ───────────────────────────────────

describe("validatePacketInvariants", () => {
  test("returns text when all 9 required headings present", async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket();
    expect(validatePacketInvariants(packet)).toBe(packet);
  });

  test('returns "" when a required heading is missing', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    // Remove "Open Questions" heading
    const packet = makeValidPacket().replace("## Open Questions", "## Summary");
    expect(validatePacketInvariants(packet)).toBe("");
  });

  test('returns "" when TBD placeholder found', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket().replace(
      "None identified.",
      "TBD — need more information.",
    );
    expect(validatePacketInvariants(packet)).toBe("");
  });

  test('returns text when "TBD" appears inside a word (no false positive)', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket().replace(
      "None identified.",
      "Check STDOUT for output verification.",
    );
    expect(validatePacketInvariants(packet)).toBe(packet);
  });

  test("case-insensitive heading matching", async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    let packet = makeValidPacket();
    packet = packet.replace("## What You Are Building", "## what you are building");
    expect(validatePacketInvariants(packet)).toBe(packet);
  });

  test('returns "" when requirements section has no REQ- references', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket().replace(/REQ-\d+/g, "ITEM");
    expect(validatePacketInvariants(packet)).toBe("");
  });

  test('returns "" when acceptance criteria section is empty', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket().replace(
      "## Acceptance Criteria\n\n- BST insertion works correctly for all input types\n- No memory leaks detected by valgrind\n- REQ-001 and REQ-002 are satisfied",
      "## Acceptance Criteria\n\n## Requirements Checklist",
    );
    // This removes the original Requirements Checklist heading duplication, need to be careful
    // Actually the replacement already creates a second heading right after, leaving AC empty
    expect(validatePacketInvariants(packet)).toBe("");
  });

  test('returns text when open questions says "None"', async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    const packet = makeValidPacket(); // Already has "None identified."
    expect(validatePacketInvariants(packet)).toBe(packet);
  });

  test("handles headings at different levels (# vs ##)", async () => {
    const { validatePacketInvariants } = await import("../generate-packet.js");
    let packet = makeValidPacket();
    packet = packet.replace("## What You Are Building", "# What You Are Building");
    expect(validatePacketInvariants(packet)).toBe(packet);
  });
});

// ── readPriorOutputs Tests ──────────────────────────────────────────

describe("readPriorOutputs", () => {
  test("successfully reads valid requirements.json and concepts.json", async () => {
    const { readPriorOutputs } = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const result = readPriorOutputs(dir);
    expect(result.requirements.requirements).toHaveLength(2);
    expect(result.concepts.concepts).toHaveLength(2);
  });

  test("throws when requirements.json is missing", async () => {
    const { readPriorOutputs } = await import("../generate-packet.js");
    const dir = makeOutputDir({ skipRequirements: true });
    expect(() => readPriorOutputs(dir)).toThrow("requires requirements.json");
  });

  test("throws when concepts.json is missing", async () => {
    const { readPriorOutputs } = await import("../generate-packet.js");
    const dir = makeOutputDir({ skipConcepts: true });
    expect(() => readPriorOutputs(dir)).toThrow("requires concepts.json");
  });

  test("throws when requirements.json has invalid content", async () => {
    const { readPriorOutputs } = await import("../generate-packet.js");
    const dir = makeOutputDir({ invalidRequirements: true });
    expect(() => readPriorOutputs(dir)).toThrow("invalid requirements.json");
  });
});

// ── Stage Metadata Tests ────────────────────────────────────────────

describe("generate-packet stage metadata", () => {
  test("stage name is generate_packet", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    expect(generatePacketStage.name).toBe("generate_packet");
  });

  test("output filename is packet.md", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    expect(generatePacketStage.outputFilename).toBe("packet.md");
  });

  test("output schema matches PacketOutputSchema", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    expect(generatePacketStage.outputSchema).toBe(PacketOutputSchema);
  });
});

// ── Stage Error Path Tests ──────────────────────────────────────────

describe("generate-packet stage error paths", () => {
  test("throws when input is not a valid primer string", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    await expect(generatePacketStage.run(42, ctx)).rejects.toThrow(
      "requires a non-empty primer string",
    );
  });

  test("throws when input is empty string", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    await expect(generatePacketStage.run("", ctx)).rejects.toThrow(
      "requires a non-empty primer string",
    );
  });

  test("throws when requirements.json is missing from output_dir", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    const dir = makeOutputDir({ skipRequirements: true });
    const ctx = makeCtx(dir);
    await expect(
      generatePacketStage.run(makePrimer(), ctx),
    ).rejects.toThrow("requires requirements.json");
  });

  test("throws when concepts.json is missing from output_dir", async () => {
    const { generatePacketStage } = await import("../generate-packet.js");
    const dir = makeOutputDir({ skipConcepts: true });
    const ctx = makeCtx(dir);
    await expect(
      generatePacketStage.run(makePrimer(), ctx),
    ).rejects.toThrow("requires concepts.json");
  });
});

// ── Mock LLM Integration Tests ──────────────────────────────────────

describe("generate-packet with mocked LLM", () => {
  test("returns valid packet when LLM returns well-formed output", async () => {
    const validPacket = makeValidPacket();

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: validPacket,
        inputTokens: 200,
        outputTokens: 500,
      }),
    }));

    const mod = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    const result = await mod.generatePacketStage.run(makePrimer(), ctx);

    expect(result).toBe(validPacket);
    const parsed = PacketOutputSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  test('returns "" (triggers retry) when packet is missing required headings', async () => {
    const incompletePacket = "## What You Are Building\n\nSome content only.";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: incompletePacket,
        inputTokens: 200,
        outputTokens: 50,
      }),
    }));

    const mod = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    const result = await mod.generatePacketStage.run(makePrimer(), ctx);

    expect(result).toBe("");
    const parsed = PacketOutputSchema.safeParse(result);
    expect(parsed.success).toBe(false);
  });

  test("strips code fences and validates", async () => {
    const fencedPacket = "```markdown\n" + makeValidPacket() + "\n```";

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: fencedPacket,
        inputTokens: 200,
        outputTokens: 500,
      }),
    }));

    const mod = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    const result = await mod.generatePacketStage.run(makePrimer(), ctx);

    expect(typeof result).toBe("string");
    expect(result as string).toContain("## What You Are Building");
    expect(result as string).not.toContain("```");
  });

  test('returns "" when packet contains TBD placeholder', async () => {
    const tbdPacket = makeValidPacket().replace(
      "None identified.",
      "TBD — awaiting clarification.",
    );

    mock.module("../../llm.js", () => ({
      callLLM: async () => ({
        text: tbdPacket,
        inputTokens: 200,
        outputTokens: 500,
      }),
    }));

    const mod = await import("../generate-packet.js");
    const dir = makeOutputDir();
    const ctx = makeCtx(dir);
    const result = await mod.generatePacketStage.run(makePrimer(), ctx);

    expect(result).toBe("");
  });
});
