import { z } from "zod";
import { ChunkSchema } from "./chunk.js";

export const IngestOutputSchema = z.object({
  chunks: z.array(ChunkSchema).min(1),
});

export type IngestOutput = z.infer<typeof IngestOutputSchema>;
