import { node, workflow, START, END } from '../../src/index.js'

/**
 * etl-pipeline — Extract-Transform-Load data pipeline.
 *
 * Topology:
 *   START → extract → transform → load → END
 *
 * Demonstrates:
 *   - State accumulation across nodes
 *   - Array data flowing through the pipeline
 *   - Type casting from unknown state values
 */
export default workflow('etl-pipeline', {
  state: {
    rawData: [] as string[],
    transformedData: [] as string[],
    loadedCount: 0,
  },
  version: '1.0.0',
  description: 'Extract-Transform-Load pipeline demonstrating state accumulation across nodes',
})
  .add(
    'extract',
    node((_state) => {
      // Simulate extracting raw records from a data source
      const records = ['user:alice,score:95', 'user:bob,score:87', 'user:carol,score:72']
      return { rawData: records }
    }),
  )
  .add(
    'transform',
    node((state) => {
      // Parse and normalize raw records into structured data
      const raw = state.rawData as string[]
      const transformed = raw.map((record) => {
        const parts = record.split(',')
        const user = parts[0]?.split(':')[1] ?? ''
        const score = parts[1]?.split(':')[1] ?? ''
        return { user, score: Number(score), grade: Number(score) >= 80 ? 'pass' : 'fail' }
      })
      return { transformedData: transformed.map((t) => JSON.stringify(t)) }
    }),
  )
  .add(
    'load',
    node((state) => {
      // Simulate loading transformed records into a data store
      const data = state.transformedData as string[]
      return { loadedCount: data.length }
    }),
  )
  .edge(START, 'extract')
  .edge('extract', 'transform')
  .edge('transform', 'load')
  .edge('load', END)
  .build()
