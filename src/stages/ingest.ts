import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { RunContext } from "../schemas/stage.js";
import type { Chunk } from "../schemas/chunk.js";
import type { IngestOutput } from "../schemas/ingest-output.js";
import { IngestOutputSchema } from "../schemas/ingest-output.js";
import type { PipelineStage } from "../orchestrator.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt"]);

/**
 * Generate a deterministic chunk_id from file_id and chunk index.
 */
function makeChunkId(fileId: string, index: number): string {
  const hash = createHash("sha256")
    .update(`${fileId}:${index}`)
    .digest("hex")
    .slice(0, 12);
  return `chunk-${hash}`;
}

/**
 * Recursively walk a directory and return all file paths.
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    } else if (entry.isSymbolicLink()) {
      // Follow symlinks — statSync resolves to the target
      const target = statSync(fullPath, { throwIfNoEntry: false });
      if (target?.isFile()) {
        results.push(fullPath);
      } else if (target?.isDirectory()) {
        results.push(...walkDir(fullPath));
      }
    }
  }
  return results;
}

/**
 * Generate a short hash prefix from an absolute path for disambiguation.
 */
function pathHash(absPath: string): string {
  return createHash("sha256").update(absPath).digest("hex").slice(0, 8);
}

/**
 * Discover all supported files under the given paths.
 * Throws immediately if any input path does not exist (fail-fast on bad config).
 * Returns absolute file paths paired with stable file_id values, sorted by filePath.
 *
 * file_id contract:
 * - Directory input: relative path from that directory (e.g., "sub/readme.md")
 * - File input: basename (e.g., "readme.md"), disambiguated with a path hash
 *   prefix if multiple file inputs share the same basename (e.g., "a1b2c3d4/readme.md")
 * - Always forward-slash separated
 */
function discoverFiles(
  inputPaths: readonly string[],
): { filePath: string; fileId: string }[] {
  const results: { filePath: string; fileId: string }[] = [];

  for (const inputPath of inputPaths) {
    const resolved = resolve(inputPath);
    const stat = statSync(resolved, { throwIfNoEntry: false });

    if (!stat) {
      throw new Error(`Input path does not exist: ${inputPath}`);
    }

    if (stat.isFile()) {
      if (SUPPORTED_EXTENSIONS.has(extname(resolved).toLowerCase())) {
        results.push({
          filePath: resolved,
          fileId: basename(resolved),
        });
      }
    } else if (stat.isDirectory()) {
      for (const filePath of walkDir(resolved)) {
        if (SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
          const relPath = relative(resolved, filePath);
          results.push({
            filePath,
            fileId: relPath.split("\\").join("/"), // normalize to forward slashes
          });
        }
      }
    }
  }

  // Disambiguate duplicate file_ids by prefixing with a path-based hash.
  // This handles the case where two direct file inputs share the same basename.
  const idCounts = new Map<string, number>();
  for (const r of results) {
    idCounts.set(r.fileId, (idCounts.get(r.fileId) ?? 0) + 1);
  }
  for (const r of results) {
    if ((idCounts.get(r.fileId) ?? 0) > 1) {
      r.fileId = `${pathHash(r.filePath)}/${r.fileId}`;
    }
  }

  // Sort by filePath for deterministic ordering
  results.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return results;
}

/**
 * Find the first and last non-blank line indices within a line buffer.
 * Returns null if the buffer contains only blank lines.
 * Used to adjust line_start/line_end to match actual content (no trim desync).
 */
function trimBlankLines(
  lines: string[],
): { startOffset: number; endOffset: number; trimmedLines: string[] } | null {
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === "") start++;
  if (start === lines.length) return null; // all blank

  let end = lines.length - 1;
  while (end > start && lines[end]!.trim() === "") end--;

  return {
    startOffset: start,
    endOffset: lines.length - 1 - end,
    trimmedLines: lines.slice(start, end + 1),
  };
}

/**
 * Split markdown content into chunks by headings.
 * Each heading and its following content become one chunk.
 * Content before the first heading becomes a preamble chunk.
 * Line numbers are 1-based. Leading/trailing blank lines are excluded
 * from both text and line range to maintain text-locator correspondence.
 */
function chunkMarkdown(content: string, fileId: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentStart = 0; // 0-indexed accumulation start
  let chunkIndex = 0;
  let inFencedBlock = false;

  function flushChunk(): void {
    const trimmed = trimBlankLines(currentLines);
    if (!trimmed) return; // all blank lines, skip

    const lineStart1 = currentStart + trimmed.startOffset + 1; // convert to 1-based
    const lineEnd1 = currentStart + currentLines.length - 1 - trimmed.endOffset + 1;

    chunks.push({
      chunk_id: makeChunkId(fileId, chunkIndex),
      file_id: fileId,
      text: trimmed.trimmedLines.join("\n"),
      source_ref: {
        file_id: fileId,
        line_start: lineStart1,
        line_end: lineEnd1,
      },
    });
    chunkIndex++;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track fenced code blocks (``` or ~~~) to avoid splitting on headings inside them
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFencedBlock = !inFencedBlock;
    }

    if (!inFencedBlock && /^#{1,6}\s/.test(line) && currentLines.length > 0) {
      flushChunk();
      currentLines = [line];
      currentStart = i;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    flushChunk();
  }

  return chunks;
}

/**
 * Split plain text content into chunks by paragraphs (blank-line separated).
 * Multiple consecutive blank lines are treated as a single separator.
 * Line numbers are 1-based. Only non-blank content lines are included
 * in the chunk text and line range.
 */
function chunkPlainText(content: string, fileId: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentStart = -1; // 0-indexed; -1 means "not in a paragraph"
  let chunkIndex = 0;

  function flushChunk(): void {
    if (currentLines.length === 0) return;

    // currentLines only contains non-blank lines accumulated while
    // in "inside paragraph" state, so no blank-line trimming needed.
    chunks.push({
      chunk_id: makeChunkId(fileId, chunkIndex),
      file_id: fileId,
      text: currentLines.join("\n"),
      source_ref: {
        file_id: fileId,
        line_start: currentStart + 1, // convert to 1-based
        line_end: currentStart + currentLines.length, // 1-based inclusive
      },
    });
    chunkIndex++;
    currentLines = [];
    currentStart = -1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isBlank = line.trim() === "";

    if (currentStart === -1) {
      // Between paragraphs: skip blank lines, start paragraph on non-blank
      if (!isBlank) {
        currentStart = i;
        currentLines.push(line);
      }
    } else {
      // Inside paragraph
      if (isBlank) {
        flushChunk();
      } else {
        currentLines.push(line);
      }
    }
  }

  // Flush final paragraph
  flushChunk();

  return chunks;
}

/**
 * Split a file's content into chunks with source refs.
 */
function chunkFile(filePath: string, fileId: string): Chunk[] {
  const content = readFileSync(filePath, "utf-8");
  if (content.trim().length === 0) return [];

  const ext = extname(filePath).toLowerCase();
  if (ext === ".md") {
    return chunkMarkdown(content, fileId);
  }
  return chunkPlainText(content, fileId);
}

/**
 * Ingest stage: reads input files, splits into chunks, returns validated output.
 * Throws on unrecoverable errors (missing paths, no files, no chunks).
 */
async function run(_input: unknown, ctx: RunContext): Promise<IngestOutput> {
  const discovered = discoverFiles(ctx.config.input_paths);

  if (discovered.length === 0) {
    throw new Error(
      `No supported files found (extensions: ${[...SUPPORTED_EXTENSIONS].join(", ")}). ` +
      `Searched: ${ctx.config.input_paths.join(", ")}`,
    );
  }

  const allChunks: Chunk[] = [];

  for (const { filePath, fileId } of discovered) {
    const chunks = chunkFile(filePath, fileId);
    allChunks.push(...chunks);
  }

  if (allChunks.length === 0) {
    throw new Error(
      `All ${discovered.length} supported file(s) produced zero chunks (files may be empty or whitespace-only)`,
    );
  }

  return { chunks: allChunks };
}

export const ingestStage: PipelineStage = {
  name: "ingest",
  run,
  outputSchema: IngestOutputSchema,
  outputFilename: "chunks.json",
};
