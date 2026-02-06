import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Chunk } from "./schemas/chunk.js";
import type { FileTag } from "./schemas/file-tag.js";

export const DB_FILENAME = "chunks.db";

export interface RetrievalOptions {
  /** FTS5 query string (keywords) */
  readonly query: string;
  /** Maximum number of chunks to return */
  readonly limit?: number;
  /** Boost chunks from files with this tag */
  readonly bias?: FileTag;
}

export interface StorageReader {
  /** Retrieve chunks matching a keyword query, ranked by relevance. */
  retrieve(options: RetrievalOptions): Chunk[];
  /** Close the database connection. */
  close(): void;
}

/**
 * Create a new storage database and index chunks.
 * Writes chunks.db to the given directory.
 * Returns a StorageReader for querying.
 */
export function createStorage(
  outputDir: string,
  chunks: Chunk[],
  fileTags: ReadonlyMap<string, FileTag>,
): StorageReader {
  const dbPath = join(outputDir, DB_FILENAME);
  const db = new Database(dbPath);

  db.run("PRAGMA journal_mode = WAL");

  // Files table: maps file_id to its tag
  db.run(`
    CREATE TABLE files (
      file_id TEXT PRIMARY KEY,
      tag     TEXT NOT NULL
    )
  `);

  // Chunks table: stores chunk data with FK to files
  db.run(`
    CREATE TABLE chunks (
      chunk_id   TEXT PRIMARY KEY,
      file_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      FOREIGN KEY (file_id) REFERENCES files(file_id)
    )
  `);

  // FTS5 virtual table for full-text search on chunk text
  db.run(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      content='chunks',
      content_rowid='rowid'
    )
  `);

  // Insert files
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (file_id, tag) VALUES (?, ?)",
  );
  const insertFileTxn = db.transaction(
    (tags: ReadonlyMap<string, FileTag>) => {
      for (const [fileId, tag] of tags) {
        insertFile.run(fileId, tag);
      }
    },
  );
  insertFileTxn(fileTags);

  // Insert chunks and populate FTS
  const insertChunk = db.prepare(
    "INSERT INTO chunks (chunk_id, file_id, text, source_ref) VALUES (?, ?, ?, ?)",
  );
  const insertChunkTxn = db.transaction((chunkList: Chunk[]) => {
    for (const chunk of chunkList) {
      insertChunk.run(
        chunk.chunk_id,
        chunk.file_id,
        chunk.text,
        JSON.stringify(chunk.source_ref),
      );
    }
  });
  insertChunkTxn(chunks);

  // Populate FTS index from chunks table
  db.run(`
    INSERT INTO chunks_fts(rowid, text)
    SELECT rowid, text FROM chunks
  `);

  return makeReader(db);
}

/**
 * Open an existing storage database for reading.
 */
export function openStorage(outputDir: string): StorageReader {
  const dbPath = join(outputDir, DB_FILENAME);
  const db = new Database(dbPath, { readonly: true });
  return makeReader(db);
}

const DEFAULT_LIMIT = 20;
const BIAS_BOOST = 10.0;

function makeReader(db: Database): StorageReader {
  return {
    retrieve(options: RetrievalOptions): Chunk[] {
      const limit = options.limit ?? DEFAULT_LIMIT;

      if (!options.query.trim()) return [];

      // FTS5 query with optional file-tag boosting.
      // When bias is set, chunks from files with the matching tag
      // get a rank boost (lower rank = more relevant in FTS5).
      const sql = options.bias
        ? `
          SELECT c.chunk_id, c.file_id, c.text, c.source_ref,
                 (chunks_fts.rank - CASE WHEN f.tag = ? THEN ? ELSE 0 END) AS adjusted_rank
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.rowid
          JOIN files f ON c.file_id = f.file_id
          WHERE chunks_fts MATCH ?
          ORDER BY adjusted_rank
          LIMIT ?
        `
        : `
          SELECT c.chunk_id, c.file_id, c.text, c.source_ref,
                 chunks_fts.rank AS adjusted_rank
          FROM chunks_fts
          JOIN chunks c ON chunks_fts.rowid = c.rowid
          WHERE chunks_fts MATCH ?
          ORDER BY adjusted_rank
          LIMIT ?
        `;

      const rows = options.bias
        ? db.query(sql).all(options.bias, BIAS_BOOST, options.query, limit)
        : db.query(sql).all(options.query, limit);

      return (rows as any[]).map((row) => ({
        chunk_id: row.chunk_id as string,
        file_id: row.file_id as string,
        text: row.text as string,
        source_ref: JSON.parse(row.source_ref as string),
      }));
    },

    close(): void {
      db.close();
    },
  };
}
