import { describe, test, expect, afterEach } from "bun:test";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
  readFileSync, existsSync, symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ingestStage } from "../ingest.js";
import { IngestOutputSchema } from "../../schemas/ingest-output.js";
import { ChunkSchema } from "../../schemas/chunk.js";
import { runPipeline } from "../../orchestrator.js";
import type { RunConfig } from "../../schemas/run-config.js";
import type { Chunk } from "../../schemas/chunk.js";
import type { FileTag } from "../../schemas/file-tag.js";
import type { IngestOutput } from "../../schemas/ingest-output.js";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "ingest-test-"));
  return tempDir;
}

function makeCtx(inputPaths: string[]) {
  return {
    config: {
      assignment_id: "test",
      input_paths: inputPaths,
      output_dir: join(tempDir, "output"),
      draft_enabled: false,
    },
    run_id: "test-run",
  };
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── File Discovery ──────────────────────────────────────────────

describe("file discovery", () => {
  test("discovers .md and .txt files in a directory", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "readme.md"), "# Hello");
    writeFileSync(join(dir, "notes.txt"), "Some notes");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    expect(fileIds).toContain("readme.md");
    expect(fileIds).toContain("notes.txt");
  });

  test("ignores unsupported file extensions", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "readme.md"), "# Hello");
    writeFileSync(join(dir, "data.json"), '{"key": "value"}');
    writeFileSync(join(dir, "script.js"), "console.log('hi')");
    writeFileSync(join(dir, "doc.pdf"), "fake pdf");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    expect(fileIds).toEqual(["readme.md"]);
  });

  test("discovers files in nested subdirectories", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(join(dir, "top.txt"), "Top level");
    writeFileSync(join(dir, "sub", "mid.txt"), "Mid level");
    writeFileSync(join(dir, "sub", "deep", "bottom.md"), "# Bottom");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    expect(fileIds).toContain("top.txt");
    expect(fileIds).toContain("sub/mid.txt");
    expect(fileIds).toContain("sub/deep/bottom.md");
  });

  test("handles input_paths containing both files and directories", async () => {
    const dir = makeTempDir();
    const subDir = join(dir, "subdir");
    mkdirSync(subDir);
    const singleFile = join(dir, "standalone.txt");
    writeFileSync(singleFile, "I am standalone");
    writeFileSync(join(subDir, "inner.md"), "# Inner");
    const ctx = makeCtx([singleFile, subDir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    // File input uses basename
    expect(fileIds).toContain("standalone.txt");
    // Directory input uses relative path
    expect(fileIds).toContain("inner.md");
  });

  test("produces deterministic file ordering (sorted)", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "z.txt"), "Z content");
    writeFileSync(join(dir, "a.txt"), "A content");
    writeFileSync(join(dir, "m.txt"), "M content");
    const ctx = makeCtx([dir]);

    const result1 = await ingestStage.run(undefined, ctx);
    const result2 = await ingestStage.run(undefined, ctx);
    const output1 = result1 as { chunks: Chunk[] };
    const output2 = result2 as { chunks: Chunk[] };

    const ids1 = output1.chunks.map((c) => c.chunk_id);
    const ids2 = output2.chunks.map((c) => c.chunk_id);
    expect(ids1).toEqual(ids2);
  });

  test("throws on non-existent input path", async () => {
    makeTempDir();
    const ctx = makeCtx([join(tempDir, "nonexistent")]);

    await expect(ingestStage.run(undefined, ctx)).rejects.toThrow(
      /Input path does not exist/,
    );
  });

  test("file_id for directory inputs uses relative path", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "readme.md"), "# Hi");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks[0]!.file_id).toBe("sub/readme.md");
  });

  test("file_id for file inputs uses basename", async () => {
    const dir = makeTempDir();
    const filePath = join(dir, "deep-file.txt");
    writeFileSync(filePath, "Content here");
    const ctx = makeCtx([filePath]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks[0]!.file_id).toBe("deep-file.txt");
  });

  test("disambiguates file_ids when direct file inputs share a basename", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(join(dir, "a", "readme.md"), "# From A");
    writeFileSync(join(dir, "b", "readme.md"), "# From B");
    // Pass both as direct file inputs (not directory inputs)
    const ctx = makeCtx([join(dir, "a", "readme.md"), join(dir, "b", "readme.md")]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    // Should have two distinct file_ids (not both "readme.md")
    expect(fileIds).toHaveLength(2);
    expect(fileIds[0]).not.toBe(fileIds[1]);
    // Both should still end with /readme.md
    for (const fid of fileIds) {
      expect(fid).toMatch(/readme\.md$/);
    }

    // chunk_ids should also be unique
    const chunkIds = output.chunks.map((c) => c.chunk_id);
    expect(new Set(chunkIds).size).toBe(chunkIds.length);
  });

  test("follows symlinks to files inside directories", async () => {
    const dir = makeTempDir();
    const realFile = join(dir, "real.md");
    writeFileSync(realFile, "# Symlinked");
    mkdirSync(join(dir, "sub"));
    symlinkSync(realFile, join(dir, "sub", "link.md"));
    const ctx = makeCtx([join(dir, "sub")]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    expect(fileIds).toContain("link.md");
    expect(output.chunks[0]!.text).toContain("# Symlinked");
  });

  test("follows symlinks to directories", async () => {
    const dir = makeTempDir();
    const realDir = join(dir, "real");
    mkdirSync(realDir);
    writeFileSync(join(realDir, "doc.txt"), "Inside symlinked dir");
    mkdirSync(join(dir, "root"));
    symlinkSync(realDir, join(dir, "root", "linked"));
    const ctx = makeCtx([join(dir, "root")]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const fileIds = [...new Set(output.chunks.map((c) => c.file_id))];
    expect(fileIds).toContain("linked/doc.txt");
  });

  test("no ../ appears in any file_id", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    mkdirSync(join(dir, "c"), { recursive: true });
    writeFileSync(join(dir, "a", "b", "deep.txt"), "Deep");
    writeFileSync(join(dir, "c", "side.md"), "# Side");
    // Use two separate directory inputs
    const ctx = makeCtx([join(dir, "a"), join(dir, "c")]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    for (const chunk of output.chunks) {
      expect(chunk.file_id).not.toContain("../");
      expect(chunk.source_ref.file_id).not.toContain("../");
    }
  });
});

// ── Markdown Chunking ───────────────────────────────────────────

describe("markdown chunking", () => {
  test("splits by headings (#, ##, ###)", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "# Heading 1\nContent 1\n## Heading 2\nContent 2\n### Heading 3\nContent 3",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(3);
    expect(output.chunks[0]!.text).toContain("# Heading 1");
    expect(output.chunks[1]!.text).toContain("## Heading 2");
    expect(output.chunks[2]!.text).toContain("### Heading 3");
  });

  test("preamble before first heading becomes its own chunk", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "This is preamble text.\n\n# First Heading\nContent here.",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(2);
    expect(output.chunks[0]!.text).toBe("This is preamble text.");
    expect(output.chunks[1]!.text).toContain("# First Heading");
  });

  test("file with no headings becomes a single chunk", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.md"), "Just some text\nwith multiple lines.");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(1);
    expect(output.chunks[0]!.text).toBe("Just some text\nwith multiple lines.");
  });

  test("empty markdown file produces no chunks", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "empty.md"), "");
    writeFileSync(join(dir, "nonempty.txt"), "Has content");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const mdChunks = output.chunks.filter((c) => c.file_id === "empty.md");
    expect(mdChunks).toHaveLength(0);
  });

  test("source_ref.line_start and line_end are 1-based", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.md"), "# Heading\nLine two\nLine three");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks[0]!.source_ref.line_start).toBe(1);
    expect(output.chunks[0]!.source_ref.line_end).toBe(3);
  });

  test("heading line is included in the chunk text", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.md"), "# My Heading\nBody text");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks[0]!.text).toMatch(/^# My Heading/);
  });

  test("leading/trailing blank lines excluded from chunk text and line range", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "\n\nPreamble content\n\n# Heading\n\nBody text\n\n",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    // Preamble should not have leading/trailing blanks
    expect(output.chunks[0]!.text).toBe("Preamble content");
    expect(output.chunks[0]!.source_ref.line_start).toBe(3); // 1-based, skip 2 blank lines

    // Heading chunk should not have leading/trailing blanks
    expect(output.chunks[1]!.text).toBe("# Heading\n\nBody text");
    expect(output.chunks[1]!.source_ref.line_start).toBe(5);
  });

  test("headings inside fenced code blocks are not treated as chunk boundaries", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "# Real Heading\nSome text\n```\n# Not a heading\n## Also not\n```\nMore text",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    // Should be a single chunk — the code fence headings should not split
    expect(output.chunks).toHaveLength(1);
    expect(output.chunks[0]!.text).toContain("# Not a heading");
    expect(output.chunks[0]!.text).toContain("## Also not");
  });

  test("headings after closing code fence are treated as chunk boundaries", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "# Before\nText\n```\n# Inside fence\n```\n# After\nMore text",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(2);
    expect(output.chunks[0]!.text).toContain("# Before");
    expect(output.chunks[0]!.text).toContain("# Inside fence");
    expect(output.chunks[1]!.text).toContain("# After");
  });

  test("tilde fenced code blocks also prevent heading splitting", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.md"),
      "# Heading\n~~~\n# Not a heading\n~~~\n# Second Heading\nContent",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(2);
    expect(output.chunks[0]!.text).toContain("# Not a heading");
    expect(output.chunks[1]!.text).toContain("# Second Heading");
  });
});

// ── Plain Text Chunking ─────────────────────────────────────────

describe("plain text chunking", () => {
  test("splits by blank lines (paragraphs)", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.txt"),
      "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(3);
    expect(output.chunks[0]!.text).toBe("Paragraph one.");
    expect(output.chunks[1]!.text).toBe("Paragraph two.");
    expect(output.chunks[2]!.text).toBe("Paragraph three.");
  });

  test("multiple consecutive blank lines treated as one separator", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.txt"),
      "First paragraph.\n\n\n\nSecond paragraph.",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(2);
    expect(output.chunks[0]!.text).toBe("First paragraph.");
    expect(output.chunks[1]!.text).toBe("Second paragraph.");
  });

  test("single-paragraph file becomes one chunk", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "Just one paragraph\nwith two lines.");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(1);
    expect(output.chunks[0]!.text).toBe("Just one paragraph\nwith two lines.");
  });

  test("empty text file produces no chunks", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "empty.txt"), "");
    writeFileSync(join(dir, "nonempty.md"), "# Has content");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const txtChunks = output.chunks.filter((c) => c.file_id === "empty.txt");
    expect(txtChunks).toHaveLength(0);
  });

  test("source_ref.line_start and line_end are 1-based", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "doc.txt"),
      "Line one\nLine two\n\nLine four\nLine five",
    );
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks[0]!.source_ref.line_start).toBe(1);
    expect(output.chunks[0]!.source_ref.line_end).toBe(2);
    expect(output.chunks[1]!.source_ref.line_start).toBe(4);
    expect(output.chunks[1]!.source_ref.line_end).toBe(5);
  });

  test("leading blank lines before first paragraph handled correctly", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "\n\n\nFirst paragraph.");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(1);
    expect(output.chunks[0]!.text).toBe("First paragraph.");
    expect(output.chunks[0]!.source_ref.line_start).toBe(4);
  });

  test("trailing blank lines after last paragraph handled correctly", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "Content here.\n\n\n");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    expect(output.chunks).toHaveLength(1);
    expect(output.chunks[0]!.text).toBe("Content here.");
    expect(output.chunks[0]!.source_ref.line_start).toBe(1);
    expect(output.chunks[0]!.source_ref.line_end).toBe(1);
  });
});

// ── Text-Locator Invariant ──────────────────────────────────────

describe("text-locator invariant", () => {
  test("chunk.text matches extracted lines for markdown files", async () => {
    const dir = makeTempDir();
    const content =
      "\nPreamble here\n\n# Section A\n\nBody of A\nMore of A\n\n## Section B\nBody of B\n";
    const filePath = join(dir, "doc.md");
    writeFileSync(filePath, content);
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };
    const originalLines = content.split("\n");

    for (const chunk of output.chunks) {
      const { line_start, line_end } = chunk.source_ref;
      const extracted = originalLines
        .slice(line_start! - 1, line_end!)
        .join("\n");
      expect(chunk.text).toBe(extracted);
    }
  });

  test("chunk.text matches extracted lines for plain text files", async () => {
    const dir = makeTempDir();
    const content =
      "\n\nFirst paragraph\nline two\n\n\n\nSecond paragraph\n\nThird paragraph\n\n";
    const filePath = join(dir, "doc.txt");
    writeFileSync(filePath, content);
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };
    const originalLines = content.split("\n");

    for (const chunk of output.chunks) {
      const { line_start, line_end } = chunk.source_ref;
      const extracted = originalLines
        .slice(line_start! - 1, line_end!)
        .join("\n");
      expect(chunk.text).toBe(extracted);
    }
  });
});

// ── Stable IDs ──────────────────────────────────────────────────

describe("stable IDs", () => {
  test("same file content produces same chunk_id values across runs", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "Paragraph A\n\nParagraph B");
    const ctx = makeCtx([dir]);

    const result1 = await ingestStage.run(undefined, ctx);
    const result2 = await ingestStage.run(undefined, ctx);
    const output1 = result1 as { chunks: Chunk[] };
    const output2 = result2 as { chunks: Chunk[] };

    expect(output1.chunks.map((c) => c.chunk_id)).toEqual(
      output2.chunks.map((c) => c.chunk_id),
    );
  });

  test("different files produce different chunk_id values", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "a.txt"), "Same content");
    writeFileSync(join(dir, "b.txt"), "Same content");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    const ids = output.chunks.map((c) => c.chunk_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("chunk_id format is chunk-<12-char-hex>", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "Some content");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    for (const chunk of output.chunks) {
      expect(chunk.chunk_id).toMatch(/^chunk-[0-9a-f]{12}$/);
    }
  });
});

// ── Schema Validation ───────────────────────────────────────────

describe("schema validation", () => {
  test("output conforms to IngestOutputSchema", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.md"), "# Hello\nWorld");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const parsed = IngestOutputSchema.parse(result);

    expect(parsed.chunks.length).toBeGreaterThan(0);
  });

  test("each chunk conforms to ChunkSchema", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.txt"), "Para 1\n\nPara 2");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    for (const chunk of output.chunks) {
      expect(() => ChunkSchema.parse(chunk)).not.toThrow();
    }
  });

  test("each chunk's source_ref has file_id and line_start", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "doc.md"), "# Heading\nBody");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const output = result as { chunks: Chunk[] };

    for (const chunk of output.chunks) {
      expect(chunk.source_ref.file_id).toBeTruthy();
      expect(chunk.source_ref.line_start).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── File Tagging ────────────────────────────────────────────────

describe("file tagging", () => {
  test("spec files are tagged as spec", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "spec"), { recursive: true });
    writeFileSync(join(dir, "spec", "assignment.md"), "# Spec");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["spec/assignment.md"]).toBe("spec");
  });

  test("requirement files are tagged as spec", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "requirements.md"), "# Requirements");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["requirements.md"]).toBe("spec");
  });

  test("assignment files are tagged as spec", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "assignment.txt"), "Assignment details");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["assignment.txt"]).toBe("spec");
  });

  test("slide files are tagged as slides", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "slides"), { recursive: true });
    writeFileSync(join(dir, "slides", "lecture1.md"), "# Slide 1");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["slides/lecture1.md"]).toBe("slides");
  });

  test("lecture files are tagged as slides", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "lecture-notes.md"), "# Lecture");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["lecture-notes.md"]).toBe("slides");
  });

  test("presentation files are tagged as slides", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "presentation.md"), "# Presentation");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["presentation.md"]).toBe("slides");
  });

  test("starter/skeleton/template files are tagged as code", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "starter"), { recursive: true });
    writeFileSync(join(dir, "starter", "main.md"), "# Starter code");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["starter/main.md"]).toBe("code");
  });

  test("readme files are tagged as notes", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "readme.md"), "# README");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["readme.md"]).toBe("notes");
  });

  test("note files are tagged as notes", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "notes.txt"), "Some notes here");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["notes.txt"]).toBe("notes");
  });

  test("unknown files are tagged as other", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "data.txt"), "Some data");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["data.txt"]).toBe("other");
  });

  test("file_tags map has entry for every unique file_id", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "spec.md"), "# Spec content");
    writeFileSync(join(dir, "readme.md"), "# README");
    writeFileSync(join(dir, "data.txt"), "Some data");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    const uniqueFileIds = [...new Set(result.chunks.map((c) => c.file_id))];

    expect(Object.keys(result.file_tags).sort()).toEqual(uniqueFileIds.sort());
  });

  test("tagging is case-insensitive on path", async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, "Spec"), { recursive: true });
    writeFileSync(join(dir, "Spec", "doc.md"), "# Spec doc");
    const ctx = makeCtx([dir]);

    const result = (await ingestStage.run(undefined, ctx)) as IngestOutput;
    expect(result.file_tags["Spec/doc.md"]).toBe("spec");
  });

  test("output with file_tags conforms to IngestOutputSchema", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "spec.md"), "# Spec");
    writeFileSync(join(dir, "readme.md"), "# README");
    const ctx = makeCtx([dir]);

    const result = await ingestStage.run(undefined, ctx);
    const parsed = IngestOutputSchema.parse(result);

    expect(Object.keys(parsed.file_tags).length).toBeGreaterThan(0);
  });
});

// ── Error Handling ──────────────────────────────────────────────

describe("error handling", () => {
  test("non-existent input path throws (not schema validation failure)", async () => {
    makeTempDir();
    const ctx = makeCtx([join(tempDir, "does-not-exist")]);

    await expect(ingestStage.run(undefined, ctx)).rejects.toThrow(
      "Input path does not exist",
    );
  });

  test("empty directory (no supported files) throws with descriptive message", async () => {
    const dir = makeTempDir();
    // Directory exists but has no files
    const ctx = makeCtx([dir]);

    await expect(ingestStage.run(undefined, ctx)).rejects.toThrow(
      /No supported files found/,
    );
  });

  test("directory with only unsupported files throws", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "data.json"), '{"key": "value"}');
    writeFileSync(join(dir, "script.js"), "console.log('hi')");
    const ctx = makeCtx([dir]);

    await expect(ingestStage.run(undefined, ctx)).rejects.toThrow(
      /No supported files found/,
    );
  });

  test("files with only whitespace throws (no chunks produced)", async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "blank.txt"), "   \n\n   \n");
    const ctx = makeCtx([dir]);

    await expect(ingestStage.run(undefined, ctx)).rejects.toThrow(
      /produced zero chunks/,
    );
  });

  test("thrown errors cause orchestrator to fail without retries", async () => {
    const dir = makeTempDir();
    const outputDir = join(dir, "output");
    const config: RunConfig = {
      assignment_id: "test",
      input_paths: [join(dir, "nonexistent")],
      output_dir: outputDir,
      draft_enabled: false,
    };

    const metadata = await runPipeline(config, [ingestStage]);

    expect(metadata.status).toBe("failed");
    expect(metadata.error).toContain("Input path does not exist");
    expect(metadata.stages_completed).toEqual([]);

    // Verify no retry entries in log (stage throws, not schema failure)
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).not.toContain("retrying");
    expect(log).toContain("threw error");
  });
});

// ── Orchestrator Integration ────────────────────────────────────

describe("orchestrator integration", () => {
  test("successful run produces valid chunks.json and run.json", async () => {
    const dir = makeTempDir();
    const outputDir = join(dir, "output");
    writeFileSync(join(dir, "spec.md"), "# Overview\nThis is the spec.\n\n## Details\nMore details.");
    writeFileSync(join(dir, "notes.txt"), "Important notes\n\nSecond paragraph");

    const config: RunConfig = {
      assignment_id: "test-assignment",
      input_paths: [dir],
      output_dir: outputDir,
      draft_enabled: false,
    };

    const metadata = await runPipeline(config, [ingestStage]);

    expect(metadata.status).toBe("completed");
    expect(metadata.stages_completed).toEqual(["ingest"]);

    // chunks.json exists and is valid
    const chunksPath = join(outputDir, "chunks.json");
    expect(existsSync(chunksPath)).toBe(true);
    const chunksJson = JSON.parse(readFileSync(chunksPath, "utf-8"));
    const parsed = IngestOutputSchema.parse(chunksJson);
    expect(parsed.chunks.length).toBeGreaterThan(0);

    // run.json shows completed
    const runJson = JSON.parse(readFileSync(join(outputDir, "run.json"), "utf-8"));
    expect(runJson.status).toBe("completed");
    expect(runJson.stages_completed).toEqual(["ingest"]);

    // run.log has expected entries
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).toContain("Stage 'ingest' started");
    expect(log).toContain("Stage 'ingest' completed");
    expect(log).toContain("Pipeline completed successfully");
  });

  test("empty directory run produces failed run.json with no retries", async () => {
    const dir = makeTempDir();
    const inputDir = join(dir, "empty-input");
    mkdirSync(inputDir);
    const outputDir = join(dir, "output");

    const config: RunConfig = {
      assignment_id: "test-assignment",
      input_paths: [inputDir],
      output_dir: outputDir,
      draft_enabled: false,
    };

    const metadata = await runPipeline(config, [ingestStage]);

    expect(metadata.status).toBe("failed");
    expect(metadata.error).toContain("No supported files found");
    expect(metadata.stages_completed).toEqual([]);

    // run.json reflects failure
    const runJson = JSON.parse(readFileSync(join(outputDir, "run.json"), "utf-8"));
    expect(runJson.status).toBe("failed");

    // No retry log entries
    const log = readFileSync(join(outputDir, "run.log"), "utf-8");
    expect(log).not.toContain("retrying");
  });
});
