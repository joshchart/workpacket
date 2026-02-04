import { z } from "zod";
import { SourceRefSchema } from "./source-ref.js";

export const ConceptSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)).min(1),
  source_refs: z.array(SourceRefSchema).min(1),
});

export type Concept = z.infer<typeof ConceptSchema>;

export const ConceptsOutputSchema = z.object({
  concepts: z.array(ConceptSchema).min(1),
});

export type ConceptsOutput = z.infer<typeof ConceptsOutputSchema>;
