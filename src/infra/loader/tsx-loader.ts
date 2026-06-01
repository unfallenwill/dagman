import path from 'path'
import { pathToFileURL } from 'url'
import type { WorkflowDefinition } from '../../shared/models/compiled-graph.js'
import type { WorkflowLoader } from '../../shared/utils/loader.js'

export function createDefaultLoader(): WorkflowLoader {
  return {
    async load(workflowPath: string): Promise<WorkflowDefinition> {
      const absPath = path.resolve(workflowPath)

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { register } = require('tsx/esm') as { register: () => void }
        register()
      } catch {
        // tsx may already be registered
      }

      // Bust cache for repeated imports during development
      const timestamp = Date.now()
      // Use file:// URL to support Windows paths (e.g. C:\Users\...)
      const fileUrl = `${pathToFileURL(absPath).href}?t=${timestamp}`
      const mod = await import(fileUrl)

      if (!mod.default || typeof mod.default !== 'object') {
        throw new Error('workflow file must export a default WorkflowDefinition')
      }

      return mod.default as WorkflowDefinition
    },
  }
}
