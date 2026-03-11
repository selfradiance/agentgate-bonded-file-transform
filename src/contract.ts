import { z } from "zod";

export const TaskContractSchema = z.object({
  task: z.literal("file-transform"),
  transform_type: z.literal("csv-to-json"),
  input_file: z.string(),
  output_file: z.string(),
  bond_amount_cents: z.number().int().positive(),
  ttl_seconds: z.number().int().positive(),
  expected_output_hash: z.string().startsWith("sha256:"),
});

export type TaskContract = z.infer<typeof TaskContractSchema>;
