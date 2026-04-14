import { z } from "zod";

const nameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "name 仅允许字母、数字、连字符和下划线");

export const nodeSchema = z.object({
  name: nameSchema,
  description: z.string(),
  instructions: z.string(),
});

export type NodeInput = z.infer<typeof nodeSchema>;

export function validateNodeFormat(
  data: unknown
): { valid: boolean; errors: string[] } {
  const result = nodeSchema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { valid: false, errors };
}

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  expect: z.enum(["success", "skipped"]).optional(),
});

export const graphSchema = z.object({
  name: nameSchema,
  edges: z.array(edgeSchema),
});

export type GraphInput = z.infer<typeof graphSchema>;

export function validateGraphFormat(
  data: unknown
): { valid: boolean; errors: string[] } {
  const result = graphSchema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { valid: false, errors };
}
