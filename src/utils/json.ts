import { z } from "zod";

const dependencySchema = z.union([
  z.string(),
  z.object({
    node: z.string(),
    status: z.string(),
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
  states: z
    .array(z.string())
    .min(1, "states 至少包含 1 个元素")
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "states 中的元素不可重复",
    }),
  default_state: z.string(),
  depends_on: z.array(dependencySchema),
}).refine(
  (data) => data.states.includes(data.default_state),
  { message: "default_state 必须存在于 states 数组中", path: ["default_state"] }
);

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
