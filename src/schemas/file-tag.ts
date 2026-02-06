import { z } from "zod";

export const FileTagSchema = z.enum(["spec", "slides", "code", "notes", "other"]);
export type FileTag = z.infer<typeof FileTagSchema>;
