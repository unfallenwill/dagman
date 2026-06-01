import { node, workflow, START, END } from '../../src/index.js'

/**
 * text-transform — Minimal workflow matching the README Quick Start.
 *
 * Topology:
 *   START → upper → reverse → END
 *
 * Demonstrates:
 *   - Initial state
 *   - Linear text transformation
 *   - README-compatible output
 */
export default workflow('text-transform', {
  state: { text: 'hello', result: '' },
  version: '1.0.0',
  description: 'Uppercase and reverse a text value',
})
  .add(
    'upper',
    node((state) => ({ text: String(state.text).toUpperCase() })),
  )
  .add(
    'reverse',
    node((state) => ({ result: String(state.text).split('').reverse().join('') })),
  )
  .edge(START, 'upper')
  .edge('upper', 'reverse')
  .edge('reverse', END)
  .build()
