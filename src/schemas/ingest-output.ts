import { z } from "zod";
import { ChunkSchema } from "./chunk.js";
import { FileTagSchema } from "./file-tag.js";

export const IngestOutputSchema = z.object({
  chunks: z.array(ChunkSchema).min(1),
  file_tags: z.record(z.string(), FileTagSchema),
});

export type IngestOutput = z.infer<typeof IngestOutputSchema>;
