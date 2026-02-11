import { z } from "zod";

/**
 * PrimerOutputSchema validates that the primer is a non-empty Markdown string.
 *
 * Concept-heading validation is performed in the stage itself (not here)
 * because it requires the concept names from the input, which Zod schemas
 * don't have access to.
 */
export const PrimerOutputSchema = z.string().min(1);

export type PrimerOutput = z.infer<typeof PrimerOutputSchema>;
