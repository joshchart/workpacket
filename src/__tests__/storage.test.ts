import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Chunk } from "../schemas/chunk.js";
import type { FileTag } from "../schemas/file-tag.js";
import { createStorage, openStorage, DB_FILENAME } from "../storage.js";

let tempDir: string;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "storage-test-"));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeChunk(
  id: string,
  fileId: string,
  text: string,
  lineStart = 1,
): Chunk {
  return {
    chunk_id: id,
    file_id: fileId,
    text,
    source_ref: { file_id: fileId, line_start: lineStart, line_end: lineStart + 5 },
  };
}

function makeFileTags(entries: [string, FileTag][]): Map<string, FileTag> {
  return new Map(entries);
}

// ── createStorage ────────────────────────────────────────────────

describe("createStorage", () => {
  test("creates DB file on disk", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "file1.md", "hello world")];
    const tags = makeFileTags([["file1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    reader.close();

    expect(existsSync(join(dir, DB_FILENAME))).toBe(true);
  });

  test("returns a functional StorageReader", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "file1.md", "hello world")];
    const tags = makeFileTags([["file1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "hello" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c1");
  });
});

// ── retrieve — basic ─────────────────────────────────────────────

describe("retrieve — basic", () => {
  test("keyword query returns matching chunks", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "f1.md", "the quick brown fox"),
      makeChunk("c2", "f1.md", "lazy dog sleeps", 10),
    ];
    const tags = makeFileTags([["f1.md", "notes"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "fox" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c1");
  });

  test("query matching multiple chunks returns all", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "f1.md", "algorithms and data structures"),
      makeChunk("c2", "f1.md", "data processing pipeline", 10),
      makeChunk("c3", "f1.md", "unrelated content", 20),
    ];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "data" });
    reader.close();

    expect(results.length).toBe(2);
    const ids = results.map((r) => r.chunk_id).sort();
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });
});

// ── retrieve — bias ──────────────────────────────────────────────

describe("retrieve — bias", () => {
  test("bias boosts chunks from files with matching tag", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "notes.md", "introduction to algorithms"),
      makeChunk("c2", "spec.md", "introduction to the assignment", 10),
    ];
    const tags = makeFileTags([
      ["notes.md", "notes"],
      ["spec.md", "spec"],
    ]);

    const reader = createStorage(dir, chunks, tags);

    // With spec bias, the spec chunk should come first
    const biased = reader.retrieve({ query: "introduction", bias: "spec" });
    expect(biased.length).toBe(2);
    expect(biased[0]!.file_id).toBe("spec.md");

    reader.close();
  });

  test("bias with no matching files still returns results", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "notes"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "hello", bias: "spec" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c1");
  });
});

// ── retrieve — limit ─────────────────────────────────────────────

describe("retrieve — limit", () => {
  test("respects limit parameter", () => {
    const dir = makeTempDir();
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`c${i}`, "f1.md", `data analysis topic ${i}`, i * 10 + 1),
    );
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "data", limit: 3 });
    reader.close();

    expect(results.length).toBe(3);
  });

  test("returns fewer than limit when not enough matches", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "unique content here")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "unique", limit: 50 });
    reader.close();

    expect(results.length).toBe(1);
  });
});

// ── retrieve — empty/no match ────────────────────────────────────

describe("retrieve — edge cases", () => {
  test("empty query returns empty array", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "" });
    reader.close();

    expect(results).toEqual([]);
  });

  test("whitespace-only query returns empty array", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "   " });
    reader.close();

    expect(results).toEqual([]);
  });

  test("query with no matches returns empty array", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "xylophone" });
    reader.close();

    expect(results).toEqual([]);
  });
});

// ── openStorage ──────────────────────────────────────────────────

describe("openStorage", () => {
  test("opens existing DB in read-only mode and retrieves chunks", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const writer = createStorage(dir, chunks, tags);
    writer.close();

    const reader = openStorage(dir);
    const results = reader.retrieve({ query: "hello" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c1");
  });
});

// ── close ────────────────────────────────────────────────────────

describe("close", () => {
  test("DB file remains valid after close", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "f1.md", "hello world")];
    const tags = makeFileTags([["f1.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    reader.close();

    expect(existsSync(join(dir, DB_FILENAME))).toBe(true);

    // Can reopen after close
    const reader2 = openStorage(dir);
    const results = reader2.retrieve({ query: "hello" });
    reader2.close();

    expect(results.length).toBe(1);
  });
});

// ── retrieveByTag ───────────────────────────────────────────────

describe("retrieveByTag", () => {
  test("returns chunks from files with matching tag", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "spec.md", "requirement one"),
      makeChunk("c2", "slides.md", "concept explanation", 10),
    ];
    const tags = makeFileTags([
      ["spec.md", "spec"],
      ["slides.md", "slides"],
    ]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieveByTag("spec");
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c1");
    expect(results[0]!.file_id).toBe("spec.md");
  });

  test("returns empty array when no files have matching tag", () => {
    const dir = makeTempDir();
    const chunks = [makeChunk("c1", "notes.md", "some notes")];
    const tags = makeFileTags([["notes.md", "notes"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieveByTag("spec");
    reader.close();

    expect(results).toEqual([]);
  });

  test("respects limit parameter", () => {
    const dir = makeTempDir();
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`c${i}`, "spec.md", `requirement ${i}`, i * 10 + 1),
    );
    const tags = makeFileTags([["spec.md", "spec"]]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieveByTag("spec", 3);
    reader.close();

    expect(results.length).toBe(3);
  });

  test("returns chunks from multiple files with same tag", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "spec1.md", "first spec"),
      makeChunk("c2", "spec2.md", "second spec", 10),
      makeChunk("c3", "notes.md", "some notes", 20),
    ];
    const tags = makeFileTags([
      ["spec1.md", "spec"],
      ["spec2.md", "spec"],
      ["notes.md", "notes"],
    ]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieveByTag("spec");
    reader.close();

    expect(results.length).toBe(2);
    const ids = results.map((r) => r.chunk_id).sort();
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  test("does not return chunks from files with different tags", () => {
    const dir = makeTempDir();
    const chunks = [
      makeChunk("c1", "spec.md", "spec content"),
      makeChunk("c2", "slides.md", "slides content", 10),
      makeChunk("c3", "notes.md", "notes content", 20),
    ];
    const tags = makeFileTags([
      ["spec.md", "spec"],
      ["slides.md", "slides"],
      ["notes.md", "notes"],
    ]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieveByTag("slides");
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe("c2");
  });
});

// ── round-trip ───────────────────────────────────────────────────

describe("round-trip", () => {
  test("chunks survive create → retrieve with source_ref intact", () => {
    const dir = makeTempDir();
    const original: Chunk = {
      chunk_id: "c1",
      file_id: "project/spec.md",
      text: "implement the binary search algorithm",
      source_ref: {
        file_id: "project/spec.md",
        line_start: 5,
        line_end: 12,
        section: "Requirements",
      },
    };
    const tags = makeFileTags([["project/spec.md", "spec"]]);

    const reader = createStorage(dir, [original], tags);
    const results = reader.retrieve({ query: "binary search" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe(original.chunk_id);
    expect(results[0]!.file_id).toBe(original.file_id);
    expect(results[0]!.text).toBe(original.text);
    expect(results[0]!.source_ref).toEqual(original.source_ref);
  });

  test("source_ref with page field survives round-trip", () => {
    const dir = makeTempDir();
    const original: Chunk = {
      chunk_id: "c1",
      file_id: "slides.md",
      text: "linked list traversal",
      source_ref: {
        file_id: "slides.md",
        page: 3,
      },
    };
    const tags = makeFileTags([["slides.md", "slides"]]);

    const reader = createStorage(dir, [original], tags);
    const results = reader.retrieve({ query: "linked list" });
    reader.close();

    expect(results.length).toBe(1);
    expect(results[0]!.source_ref).toEqual({ file_id: "slides.md", page: 3 });
  });

  test("multiple chunks from multiple files round-trip correctly", () => {
    const dir = makeTempDir();
    const chunks: Chunk[] = [
      makeChunk("c1", "spec.md", "requirement one: implement sorting"),
      makeChunk("c2", "spec.md", "requirement two: implement searching", 10),
      makeChunk("c3", "notes.md", "notes about sorting algorithms", 1),
    ];
    const tags = makeFileTags([
      ["spec.md", "spec"],
      ["notes.md", "notes"],
    ]);

    const reader = createStorage(dir, chunks, tags);
    const results = reader.retrieve({ query: "sorting" });
    reader.close();

    expect(results.length).toBe(2);
    const ids = results.map((r) => r.chunk_id).sort();
    expect(ids).toContain("c1");
    expect(ids).toContain("c3");
  });
});
