import { z } from "zod";

const dependencySchema = z.union([
  z.string(),
  z.object({
    node: z.string(),
    status: z.enum(["success", "skipped"]),
  }),
]);

export const nodeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "name 仅允许字母、数字、连字符和下划线"),
  description: z.string(),
  instructions: z.string(),
  depends_on: z.array(dependencySchema),
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
