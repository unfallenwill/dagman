import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { expandWorkflow } from '../../src/domain/compiler/node-gen.js'
import type { WorkflowDefinition } from '../../src/shared/models/workflow-def.js'

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

describe('compileWorkflow error handling', () => {
  let tmpDir: string
  let origCwd: string

  beforeEach(async () => {
    origCwd = process.cwd()
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dagman-compile-test-'))
    process.chdir(tmpDir)
    const { setBasePath } = await import('../../src/infra/fs/paths.js')
    setBasePath(tmpDir)
    // Wire up DI defaults for compiler and graph-service
    await import('../../src/engine/default-deps.js')
  })

  afterEach(async () => {
    const { setBasePath } = await import('../../src/infra/fs/paths.js')
    setBasePath('')
    process.chdir(origCwd)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('throws ValidationError for non-existent workflow', async () => {
    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    await expect(compileWorkflow('non-existent')).rejects.toThrow('manifest not found')
  })

  it('throws ValidationError for invalid manifest without name field', async () => {
    await fs.mkdir('.dagman/workflows/test-workflow', { recursive: true })
    await fs.writeFile('.dagman/workflows/test-workflow/index.ts', 'export default {}', 'utf-8')
    await fs.writeFile(
      '.dagman/workflows/test-workflow/manifest.yaml',
      'version: 1.0.0\ndescription: No name',
      'utf-8',
    )

    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    await expect(compileWorkflow('test-workflow')).rejects.toThrow(
      "manifest must have a 'name' field",
    )
  })

  it('throws ValidationError for workflow without default export', async () => {
    await fs.mkdir('.dagman/workflows/test-workflow', { recursive: true })
    await fs.writeFile('.dagman/workflows/test-workflow/index.ts', 'const foo = 1', 'utf-8')
    await fs.writeFile(
      '.dagman/workflows/test-workflow/manifest.yaml',
      'name: test-workflow\nversion: 1.0.0',
      'utf-8',
    )

    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    await expect(compileWorkflow('test-workflow')).rejects.toThrow(
      'workflow file must export a default WorkflowDefinition',
    )
  })

  it('throws ValidationError for workflow name mismatch', async () => {
    // Create a mock workflow definition with wrong manifest name
    await fs.mkdir('.dagman/workflows/test-workflow', { recursive: true })
    await fs.writeFile(
      '.dagman/workflows/test-workflow/index.ts',
      'export default { name: "test-workflow", stateSchema: {}, nodes: [], edges: [], condEdges: [], fanOuts: [] }',
      'utf-8',
    )
    await fs.writeFile(
      '.dagman/workflows/test-workflow/manifest.yaml',
      'name: wrong-name\nversion: 1.0.0',
      'utf-8',
    )

    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    await expect(compileWorkflow('test-workflow')).rejects.toThrow(
      "workflow name mismatch: manifest has 'wrong-name' but expected 'test-workflow'",
    )
  })

  it('throws ValidationError for cycle detection', async () => {
    // Create a workflow definition with a cycle
    await fs.mkdir('.dagman/workflows/test-workflow', { recursive: true })
    await fs.writeFile(
      '.dagman/workflows/test-workflow/index.ts',
      'export default { name: "test-workflow", stateSchema: {}, nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }], condEdges: [], fanOuts: [] }',
      'utf-8',
    )
    await fs.writeFile(
      '.dagman/workflows/test-workflow/manifest.yaml',
      'name: test-workflow\nversion: 1.0.0',
      'utf-8',
    )

    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    await expect(compileWorkflow('test-workflow')).rejects.toThrow(
      'compiled graph contains cycle dependency',
    )
  })

  it('returns manifest from workflow', async () => {
    await fs.mkdir('.dagman/workflows/test-workflow', { recursive: true })
    await fs.writeFile(
      '.dagman/workflows/test-workflow/index.ts',
      'export default { name: "test-workflow", stateSchema: {}, nodes: [], edges: [], condEdges: [], fanOuts: [] }',
      'utf-8',
    )
    await fs.writeFile(
      '.dagman/workflows/test-workflow/manifest.yaml',
      'name: test-workflow\nversion: 2.0.0\ndescription: Test description',
      'utf-8',
    )

    const { compileWorkflow } = await import('../../src/domain/compiler/compiler.js')
    const result = await compileWorkflow('test-workflow')

    expect(result.manifest.name).toBe('test-workflow')
    expect(result.manifest.version).toBe('2.0.0')
    expect(result.manifest.description).toBe('Test description')
  })
})
