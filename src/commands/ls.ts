import type { Command } from 'commander'
import { WORKFLOWS_DIR } from '../constants.js'
import { withErrorHandler } from '../utils/output.js'
import { readYAML } from '../utils/file.js'
import { promises as fs } from 'fs'
import * as path from 'path'

interface DiscoveredWorkflow {
  name: string
  version: string
  description: string
}

/** Scan .dagman/workflows/ subdirectories for manifest.yaml files */
async function discoverWorkflows(): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = []
  const absDir = path.resolve(WORKFLOWS_DIR)

  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = absDir + '/' + entry.name + '/manifest.yaml'
      try {
        const data = await readYAML<Record<string, unknown>>(manifestPath)
        workflows.push({
          name: (data.name as string) || entry.name,
          version: (data.version as string) || '0.0.0',
          description: (data.description as string) || '',
        })
      } catch {
        // Skip workflows without valid manifest
      }
    }
  } catch {
    // workflows dir doesn't exist
  }

  return workflows
}

export function registerLsCommand(program: Command): void {
  program
    .command('ls')
    .summary('List discovered workflows')
    .action(
      withErrorHandler(async () => {
        const workflows = await discoverWorkflows()
        if (workflows.length === 0) {
          console.log('No workflows found in ' + WORKFLOWS_DIR + '/')
          return
        }
        for (const wf of workflows) {
          console.log('  ' + wf.name + ' v' + wf.version + ' - ' + wf.description)
        }
      }),
    )
}
