import { z } from "zod";

/**
 * PacketOutputSchema validates that the packet is a non-empty Markdown string.
 *
 * Structural invariant checks (required headings, no TBD, etc.) are performed
 * in the stage itself because they require pattern matching that Zod schemas
 * don't express well.
 */
export const PacketOutputSchema = z.string().min(1);

export type PacketOutput = z.infer<typeof PacketOutputSchema>;
