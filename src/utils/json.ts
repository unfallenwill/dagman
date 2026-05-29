import { z } from "zod";

const nameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "name must contain only letters, digits, hyphens and underscores");

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

// ===== Channel / Task / WorkflowRecord schemas =====

export const channelSchema = z.object({
  name: z.string(),
  value: z.unknown(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
});

export const taskSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  step: z.number().int().nonnegative(),
  status: z.enum(["ready", "running", "success", "failed", "skipped"]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

export const workflowRecordSchema = z.object({
  step: z.number().int().nonnegative(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  tasks: z.array(taskSchema),
  channelChanges: z.record(z.string(), channelSchema),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export function validateWorkflowRecord(
  data: unknown
): { valid: boolean; errors: string[] } {
  const result = workflowRecordSchema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { valid: false, errors };
}
