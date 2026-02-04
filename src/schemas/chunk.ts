import { z } from "zod";
import { SourceRefSchema } from "./source-ref.js";

export const ChunkSchema = z.object({
  chunk_id: z.string().min(1),
  file_id: z.string().min(1),
  text: z.string().min(1),
  source_ref: SourceRefSchema,
});

export type Chunk = z.infer<typeof ChunkSchema>;
