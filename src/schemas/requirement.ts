import { z } from "zod";
import { SourceRefSchema } from "./source-ref.js";

export const RequirementTypeSchema = z.enum([
  "functional",
  "constraint",
  "interface",
  "grading",
]);

export type RequirementType = z.infer<typeof RequirementTypeSchema>;

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: RequirementTypeSchema,
  source_ref: SourceRefSchema,
});

export type Requirement = z.infer<typeof RequirementSchema>;

export const RequirementsOutputSchema = z.object({
  requirements: z.array(RequirementSchema).min(1),
});

export type RequirementsOutput = z.infer<typeof RequirementsOutputSchema>;
