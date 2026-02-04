import { z } from "zod";

export const SourceRefSchema = z.object({
  file_id: z.string().min(1),
  page: z.number().int().positive().optional(),
  section: z.string().optional(),
  line_start: z.number().int().nonnegative().optional(),
  line_end: z.number().int().nonnegative().optional(),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;
