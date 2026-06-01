import { node, workflow, START, END } from '../../src/index.js'

/**
 * hello-world — The simplest possible dagman workflow.
 *
 * Topology:
 *   START → greet → embellish → finish → END
 *
 * Demonstrates:
 *   - Linear chain (A → B → C)
 *   - START / END sentinel symbols
 *   - State passing between nodes
 */
export default workflow('hello-world', {
  state: { greeting: '', message: '', result: '' },
  version: '1.0.0',
  description: 'Simple linear A → B → C workflow demonstrating basic dagman features',
})
  .add(
    'greet',
    node((_state) => {
      return { greeting: 'Hello' }
    }),
  )
  .add(
    'embellish',
    node((state) => {
      return { message: `${state.greeting}, dagman!` }
    }),
  )
  .add(
    'finish',
    node((state) => {
      return { result: `${state.message} Workflow complete.` }
    }),
  )
  .edge(START, 'greet')
  .edge('greet', 'embellish')
  .edge('embellish', 'finish')
  .edge('finish', END)
  .build()
