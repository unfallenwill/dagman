import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initTmpDir,
  cleanupTmpDir,
  installMockLoadGraph,
  storeGraph,
  buildGraph,
} from '../helpers/setup.js'
import { Command } from 'commander'
import { registerHelpCommand } from '../../src/slices/help/index.js'
import { registerLsCommand } from '../../src/slices/ls/index.js'
import '../../src/engine/default-deps.js'
import * as runService from '../../src/domain/run/run-service.js'
import * as workflowService from '../../src/domain/workflow/workflow-engine.js'

beforeEach(() => {
  initTmpDir()
  installMockLoadGraph()
})

afterEach(async () => {
  await cleanupTmpDir()
})

function createProgram(): Command {
  const program = new Command()
  program.exitOverride() // prevent process.exit from killing test
  program.configureOutput({
    writeErr: () => {},
  })
  registerHelpCommand(program)
  registerLsCommand(program)
  return program
}

describe('workflow commands', () => {
  it('should list empty workflows', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'ls'])
  })
})

describe('task commands', () => {
  it('should list tasks for a workflow run', async () => {
    // Setup: store graph in memory and create a run
    const graph = buildGraph(['node-a', 'node-b'], [{ from: 'node-b', to: 'node-a' }], 'test')
    storeGraph('test', graph)

    const info = await runService.createRun('task-test', 'test', true)
    expect(info.graphName).toBe('test')

    // List tasks
    const tasks = await workflowService.listTasks(info.id)
    expect(tasks.length).toBe(1) // Only node-a is in layer 0
    expect(tasks[0]!.nodeId).toBe('node-a')
    expect(tasks[0]!.status).toBe('ready')
  })
})
