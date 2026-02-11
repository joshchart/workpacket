import { z } from "zod";

export const RunConfigSchema = z.object({
  assignment_id: z.string().min(1),
  input_paths: z.array(z.string().min(1)).min(1),
  output_dir: z.string().min(1),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;
