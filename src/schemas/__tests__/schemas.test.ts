import { describe, expect, test } from "bun:test";
import {
  SourceRefSchema,
  ChunkSchema,
  RequirementSchema,
  RequirementsOutputSchema,
  ConceptSchema,
  ConceptsOutputSchema,
  RunConfigSchema,
  RunMetadataSchema,
} from "../index.js";

describe("SourceRefSchema", () => {
  test("accepts valid source ref with all fields", () => {
    const result = SourceRefSchema.parse({
      file_id: "spec.pdf",
      page: 3,
      section: "Requirements",
      line_start: 10,
      line_end: 20,
    });
    expect(result.file_id).toBe("spec.pdf");
    expect(result.page).toBe(3);
  });

  test("accepts minimal source ref (file_id only)", () => {
    const result = SourceRefSchema.parse({ file_id: "readme.md" });
    expect(result.file_id).toBe("readme.md");
    expect(result.page).toBeUndefined();
  });

  test("rejects empty file_id", () => {
    expect(() => SourceRefSchema.parse({ file_id: "" })).toThrow();
  });

  test("rejects missing file_id", () => {
    expect(() => SourceRefSchema.parse({})).toThrow();
  });
});

describe("ChunkSchema", () => {
  const validChunk = {
    chunk_id: "chunk-001",
    file_id: "spec.pdf",
    text: "The system shall support concurrent connections.",
    source_ref: { file_id: "spec.pdf", page: 5 },
  };

  test("accepts valid chunk", () => {
    const result = ChunkSchema.parse(validChunk);
    expect(result.chunk_id).toBe("chunk-001");
  });

  test("rejects empty text", () => {
    expect(() => ChunkSchema.parse({ ...validChunk, text: "" })).toThrow();
  });

  test("rejects missing source_ref", () => {
    const { source_ref, ...rest } = validChunk;
    expect(() => ChunkSchema.parse(rest)).toThrow();
  });
});

describe("RequirementSchema", () => {
  const validReq = {
    id: "REQ-001",
    text: "Must handle at least 100 concurrent connections",
    type: "constraint",
    source_ref: { file_id: "spec.pdf", page: 2, section: "Constraints" },
  };

  test("accepts valid requirement", () => {
    const result = RequirementSchema.parse(validReq);
    expect(result.type).toBe("constraint");
  });

  test("accepts all four requirement types", () => {
    const types = ["functional", "constraint", "interface", "grading"] as const;
    for (const type of types) {
      const result = RequirementSchema.parse({ ...validReq, type });
      expect(result.type).toBe(type);
    }
  });

  test("rejects invalid requirement type", () => {
    expect(() =>
      RequirementSchema.parse({ ...validReq, type: "unknown" })
    ).toThrow();
  });
});

describe("RequirementsOutputSchema", () => {
  test("rejects empty requirements array", () => {
    expect(() =>
      RequirementsOutputSchema.parse({ requirements: [] })
    ).toThrow();
  });

  test("accepts non-empty requirements array", () => {
    const result = RequirementsOutputSchema.parse({
      requirements: [
        {
          id: "REQ-001",
          text: "Do the thing",
          type: "functional",
          source_ref: { file_id: "spec.pdf" },
        },
      ],
    });
    expect(result.requirements).toHaveLength(1);
  });
});

describe("ConceptSchema", () => {
  const validConcept = {
    id: "CON-001",
    name: "Thread Safety",
    description: "Ensuring shared state is accessed correctly by multiple threads",
    requirement_ids: ["REQ-001", "REQ-003"],
    source_refs: [{ file_id: "slides.pdf", page: 12 }],
  };

  test("accepts valid concept", () => {
    const result = ConceptSchema.parse(validConcept);
    expect(result.name).toBe("Thread Safety");
  });

  test("rejects empty requirement_ids", () => {
    expect(() =>
      ConceptSchema.parse({ ...validConcept, requirement_ids: [] })
    ).toThrow();
  });

  test("rejects empty source_refs", () => {
    expect(() =>
      ConceptSchema.parse({ ...validConcept, source_refs: [] })
    ).toThrow();
  });
});

describe("ConceptsOutputSchema", () => {
  test("rejects empty concepts array", () => {
    expect(() => ConceptsOutputSchema.parse({ concepts: [] })).toThrow();
  });
});

describe("RunConfigSchema", () => {
  test("accepts valid config with defaults", () => {
    const result = RunConfigSchema.parse({
      assignment_id: "os-hw3",
      input_paths: ["./specs/hw3.pdf"],
      output_dir: "./workpacket_runs/os-hw3",
    });
    expect(result.draft_enabled).toBe(false);
  });

  test("accepts explicit draft_enabled", () => {
    const result = RunConfigSchema.parse({
      assignment_id: "os-hw3",
      input_paths: ["./specs/hw3.pdf"],
      output_dir: "./workpacket_runs/os-hw3",
      draft_enabled: true,
    });
    expect(result.draft_enabled).toBe(true);
  });

  test("rejects empty input_paths", () => {
    expect(() =>
      RunConfigSchema.parse({
        assignment_id: "os-hw3",
        input_paths: [],
        output_dir: "./workpacket_runs/os-hw3",
      })
    ).toThrow();
  });
});

describe("RunMetadataSchema", () => {
  const validMeta = {
    run_id: "run-abc123",
    assignment_id: "os-hw3",
    started_at: "2026-02-04T10:00:00Z",
    stages_completed: ["ingest", "extract_requirements"],
    status: "running",
  };

  test("accepts valid running metadata", () => {
    const result = RunMetadataSchema.parse(validMeta);
    expect(result.status).toBe("running");
    expect(result.completed_at).toBeUndefined();
  });

  test("accepts completed metadata with completed_at", () => {
    const result = RunMetadataSchema.parse({
      ...validMeta,
      status: "completed",
      completed_at: "2026-02-04T10:05:00Z",
    });
    expect(result.status).toBe("completed");
  });

  test("accepts failed metadata with error", () => {
    const result = RunMetadataSchema.parse({
      ...validMeta,
      status: "failed",
      error: "Schema validation failed at extract_requirements",
    });
    expect(result.error).toBeDefined();
  });

  test("rejects invalid stage name", () => {
    expect(() =>
      RunMetadataSchema.parse({
        ...validMeta,
        stages_completed: ["nonexistent_stage"],
      })
    ).toThrow();
  });

  test("rejects invalid status", () => {
    expect(() =>
      RunMetadataSchema.parse({ ...validMeta, status: "paused" })
    ).toThrow();
  });
});
