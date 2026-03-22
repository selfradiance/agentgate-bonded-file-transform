import { z } from "zod";

export const TaskContractSchema = z.object({
  task: z.literal("file-transform"),
  transform_type: z.literal("csv-to-json"),
  input_file: z.string().min(1, "input_file is required"),
  output_file: z.string().min(1, "output_file is required"),
  bond_amount_cents: z.number().int().positive(),
  ttl_seconds: z.number().int().positive(),
  expected_output_hash: z.string().regex(
    /^sha256:[a-f0-9]{64}$/,
    "expected_output_hash must be sha256: followed by exactly 64 lowercase hex characters",
  ),
});

export type TaskContract = z.infer<typeof TaskContractSchema>;
