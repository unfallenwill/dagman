import path from 'path'
import { pathToFileURL } from 'url'
import { fileURLToPath } from 'url'
import type { WorkflowDefinition } from '../../shared/models/compiled-graph.js'
import type { WorkflowLoader } from '../../shared/utils/loader.js'

let hookRegistered = false

/**
 * Register the dagman resolve hook so that `import { ... } from "dagman/api"`
 * works inside workflow files loaded from external projects.
 *
 * The hook intercepts bare `"dagman"` specifiers and redirects them to the
 * actual installed location of the dagman package. Required because Node.js
 * resolves bare specifiers from the importing file's directory — external
 * projects don't have `dagman` in their `node_modules`.
 */
function ensureResolveHook(): void {
  if (hookRegistered) return
  hookRegistered = true

  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url))
    const hookPath = path.join(thisDir, 'dagman-resolve-hook.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('node:module') as { register: (url: string) => void }
    register(pathToFileURL(hookPath).href)
  } catch {
    // Gracefully degrade if module.register unavailable (Node < 18.19)
    // or hook file missing (dev mode via tsx)
  }
}

export function createDefaultLoader(): WorkflowLoader {
  return {
    async load(workflowPath: string): Promise<WorkflowDefinition> {
      const absPath = path.resolve(workflowPath)

      // Register the dagman resolve hook before importing any workflow
      ensureResolveHook()

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
