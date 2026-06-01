import { node, workflow, START, END } from '../../src/index.js'
import type { RouteFn } from '../../src/index.js'

/**
 * conditional-router — Data processing with conditional routing.
 *
 * Topology:
 *                            ┌→ process-json → END
 *   START → ingest → classify ┤→ process-csv  → END
 *                            └→ process-raw  → END
 *
 * Demonstrates:
 *   - condEdge() for conditional branching
 *   - RouteFn reading state to select execution path
 *   - Only the selected branch executes
 *
 * Note: Each branch connects directly to END (no downstream join).
 * A barrier join after conditional branches would deadlock because
 * only one branch executes — the barrier would never receive all writes.
 */
const classifyAndRoute: RouteFn = (state) => {
  const format = state.detectedFormat as string
  if (format === 'json') return ['process-json']
  if (format === 'csv') return ['process-csv']
  return ['process-raw']
}

export default workflow('conditional-router', {
  state: {
    input: '',
    detectedFormat: '',
    processedResult: '',
    recordCount: 0,
  },
  version: '1.0.0',
  description: 'Data processing pipeline with conditional routing based on detected format',
})
  .add(
    'ingest',
    node((_state) => {
      // Simulate receiving input data (try changing this to test different routes)
      return { input: '{"name":"alice","age":30}' }
    }),
  )
  .add(
    'classify',
    node((state) => {
      // Detect data format from the input
      const input = state.input as string
      let format = 'raw'
      if (input.trim().startsWith('{')) {
        format = 'json'
      } else if (input.includes(',')) {
        format = 'csv'
      }
      return { detectedFormat: format }
    }),
  )
  .add(
    'process-json',
    node((state) => {
      const input = state.input as string
      const parsed = JSON.parse(input)
      return {
        processedResult: `JSON: name=${parsed.name}, age=${parsed.age}`,
        recordCount: 1,
      }
    }),
  )
  .add(
    'process-csv',
    node((state) => {
      const input = state.input as string
      const lines = input.split('\n').length
      return {
        processedResult: `CSV: ${lines} line(s) parsed`,
        recordCount: lines,
      }
    }),
  )
  .add(
    'process-raw',
    node((state) => {
      const input = state.input as string
      return {
        processedResult: `Raw: ${input.length} character(s)`,
        recordCount: 1,
      }
    }),
  )
  .edge(START, 'ingest')
  .edge('ingest', 'classify')
  .condEdge('classify', ['process-json', 'process-csv', 'process-raw'], classifyAndRoute)
  .edge('process-json', END)
  .edge('process-csv', END)
  .edge('process-raw', END)
  .build()
