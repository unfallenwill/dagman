import { z } from "zod";

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
