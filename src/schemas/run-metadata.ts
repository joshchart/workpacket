import { z } from "zod";

export const StageNameSchema = z.enum([
  "ingest",
  "extract_requirements",
  "map_concepts",
  "explain_concepts",
  "generate_packet",
  "draft",
]);

export type StageName = z.infer<typeof StageNameSchema>;

export const RunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunMetadataSchema = z.object({
  run_id: z.string().min(1),
  assignment_id: z.string().min(1),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  stages_completed: z.array(StageNameSchema),
  status: RunStatusSchema,
  error: z.string().optional(),
});

export type RunMetadata = z.infer<typeof RunMetadataSchema>;
