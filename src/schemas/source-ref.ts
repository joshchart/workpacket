import { z } from "zod";

export const SourceRefSchema = z
  .object({
    file_id: z.string().min(1),
    page: z.number().int().positive().optional(),
    section: z.string().optional(),
    line_start: z.number().int().positive().optional(),
    line_end: z.number().int().positive().optional(),
  })
  .refine(
    (ref) =>
      ref.page !== undefined ||
      ref.section !== undefined ||
      ref.line_start !== undefined,
    {
      message:
        "SourceRef must include at least one locator (page, section, or line_start)",
    }
  );

export type SourceRef = z.infer<typeof SourceRefSchema>;
