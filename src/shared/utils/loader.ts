import type { WorkflowDefinition } from '../models/compiled-graph.js'

/**
 * Abstraction over workflow definition loading.
 * Decouples scheduling/compiler from tsx dynamic imports and filesystem.
 */
export interface WorkflowLoader {
  load(workflowPath: string): Promise<WorkflowDefinition>
}
