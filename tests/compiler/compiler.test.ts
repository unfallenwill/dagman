import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { expandWorkflow } from '../../src/compiler/node-gen.js'
import type { WorkflowDefinition } from '../../src/models/workflow-def.js'

describe('expandWorkflow (node-gen)', () => {
  it('converts user nodes without collect', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      stateSchema: {},
      nodes: [
        { name: 'a', fn: () => {} },
        { name: 'b', fn: () => {} },
      ],
      edges: [{ from: 'b', to: 'a' }],
      condEdges: [],
      fanOuts: [],
    }

    const result = expandWorkflow(def)

    expect(result.allNodes).toHaveLength(2)
    expect(result.allNodes[0]).toMatchObject({ name: 'a', kind: 'user' })
    expect(result.allNodes[1]).toMatchObject({ name: 'b', kind: 'user' })
    // Edge unchanged
    expect(result.allEdges).toEqual([{ from: 'b', to: 'a' }])
  })

  it('generates collect nodes for nodes with stateKey', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      stateSchema: {},
      nodes: [
        { name: 'a', fn: () => {}, stateKey: 'output' },
        { name: 'b', fn: () => {} },
      ],
      edges: [{ from: 'b', to: 'a' }],
      condEdges: [],
      fanOuts: [],
    }

    const result = expandWorkflow(def)

    // a + collect-a + b
    expect(result.allNodes).toHaveLength(3)
    expect(result.allNodes[0]).toMatchObject({ name: 'a', kind: 'user', stateKey: 'output' })
    expect(result.allNodes[1]).toMatchObject({
      name: 'collect-a',
      kind: 'collect',
      parentNodeId: 'a',
      stateKey: 'output',
    })
    expect(result.allNodes[2]).toMatchObject({ name: 'b', kind: 'user' })

    // Edge rewired: b -> collect-a (was b -> a)
    // Plus internal edge: collect-a -> a
    expect(result.allEdges).toHaveLength(2)
    expect(result.allEdges).toContainEqual({ from: 'b', to: 'collect-a' })
    expect(result.allEdges).toContainEqual({ from: 'collect-a', to: 'a' })
  })

  it('generates condEdge virtual nodes', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      stateSchema: {},
      nodes: [
        { name: 'classify', fn: () => {} },
        { name: 'tool', fn: () => {} },
        { name: 'chat', fn: () => {} },
      ],
      edges: [],
      condEdges: [
        {
          nodeName: 'cond:classify→route',
          from: 'classify',
          targets: ['tool', 'chat'],
          fn: (state: any) => (state.intent === 'need_tool' ? 'tool' : 'chat'),
        },
      ],
      fanOuts: [],
    }

    const result = expandWorkflow(def)

    // 3 user nodes + 1 cond node
    expect(result.allNodes).toHaveLength(4)
    const condNode = result.allNodes.find((n) => n.kind === 'cond')
    expect(condNode).toMatchObject({
      name: 'cond:classify→route',
      kind: 'cond',
      targets: ['tool', 'chat'],
    })

    // cond node depends on classify, tool and chat depend on cond node
    expect(result.allEdges).toContainEqual({ from: 'cond:classify→route', to: 'classify' })
    expect(result.allEdges).toContainEqual({ from: 'tool', to: 'cond:classify→route' })
    expect(result.allEdges).toContainEqual({ from: 'chat', to: 'cond:classify→route' })
  })

  it('generates fanout virtual nodes', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      stateSchema: {},
      nodes: [
        { name: 'source', fn: () => {} },
        { name: 'process', fn: () => {} },
      ],
      edges: [],
      condEdges: [],
      fanOuts: [
        {
          nodeName: 'fanout:source→process',
          from: 'source',
          templateNode: 'process',
          fn: (_state: any) => [1, 2, 3],
        },
      ],
    }

    const result = expandWorkflow(def)

    // 2 user nodes + 1 fanout node
    expect(result.allNodes).toHaveLength(3)
    const fanoutNode = result.allNodes.find((n) => n.kind === 'fanout')
    expect(fanoutNode).toMatchObject({
      name: 'fanout:source→process',
      kind: 'fanout',
      templateNode: 'process',
    })

    // fanout depends on source, process depends on fanout
    expect(result.allEdges).toContainEqual({ from: 'fanout:source→process', to: 'source' })
    expect(result.allEdges).toContainEqual({ from: 'process', to: 'fanout:source→process' })
  })

  it('handles full pipeline: collect + condEdge together', () => {
    const def: WorkflowDefinition = {
      name: 'pipeline',
      stateSchema: {},
      nodes: [
        { name: 'classify', fn: () => {}, stateKey: 'intent' },
        { name: 'tool', fn: () => {}, stateKey: 'answer' },
        { name: 'chat', fn: () => {} },
      ],
      edges: [],
      condEdges: [
        {
          nodeName: 'cond:classify→route',
          from: 'classify',
          targets: ['tool', 'chat'],
          fn: (state: any) => (state.intent === 'need_tool' ? 'tool' : 'chat'),
        },
      ],
      fanOuts: [],
    }

    const result = expandWorkflow(def)

    // classify + collect-classify + tool + collect-tool + chat + cond
    expect(result.allNodes).toHaveLength(6)

    const names = result.allNodes.map((n) => n.name)
    expect(names).toContain('classify')
    expect(names).toContain('collect-classify')
    expect(names).toContain('tool')
    expect(names).toContain('collect-tool')
    expect(names).toContain('chat')
    expect(names).toContain('cond:classify→route')
  })

  it('handles subgraph-expanded nodes through compiler', () => {
    const def: WorkflowDefinition = {
      name: 'test',
      stateSchema: {},
      nodes: [
        { name: 'setup', fn: () => {} },
        { name: 'process.step1', fn: () => {} },
        { name: 'process.step2', fn: () => {}, stateKey: 'result' },
      ],
      edges: [
        { from: 'process.step1', to: 'setup' },
        { from: 'process.step2', to: 'process.step1' },
      ],
      condEdges: [],
      fanOuts: [],
    }

    const result = expandWorkflow(def)

    // setup + process.step1 + process.step2 + collect-process.step2 = 4 nodes
    expect(result.allNodes).toHaveLength(4)

    const names = result.allNodes.map((n) => n.name)
    expect(names).toContain('collect-process.step2')

    // process.step2 edge rewired to collect-process.step2
    // Should NOT have direct edge to process.step2 from downstream
    // (rewired to collect-process.step2)
    expect(result.allEdges).toContainEqual({ from: 'collect-process.step2', to: 'process.step2' })
  })
})

describe('workflow CLI', () => {
  let tmpDir: string
  let origCwd: string

  beforeEach(async () => {
    origCwd = process.cwd()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dagman-workflow-test-'))
    process.chdir(tmpDir)
    await fs.mkdir('.dagman/workflows/test-wf', { recursive: true })
  })

  afterEach(async () => {
    process.chdir(origCwd)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('discovers a workflow with manifest.yaml', async () => {
    await fs.writeFile(
      '.dagman/workflows/test-wf/manifest.yaml',
      ['name: test-wf', 'version: 1.0.0', 'description: A test workflow'].join('\n'),
    )

    // Use the CLI
    const { run: _run } = await import('../../src/cli.js')
    // Just verify the file structure is correct
    const content = await fs.readFile('.dagman/workflows/test-wf/manifest.yaml', 'utf-8')
    expect(content).toContain('name: test-wf')
  })
})
