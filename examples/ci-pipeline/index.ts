import { node, workflow, START, END } from '../../src/index.js'

/**
 * ci-pipeline — CI/CD pipeline with parallel fan-out and barrier join.
 *
 * Topology:
 *                  ┌→ lint  ─┐
 *   START → setup ─┤         ├→ deploy → END
 *                  └→ test  ─┘
 *
 * Demonstrates:
 *   - Parallel execution (lint + test in same layer)
 *   - Barrier channel (deploy waits for both lint and test)
 *   - Precondition checks via state
 *
 * Layers:
 *   0: setup       (entry node)
 *   1: lint, test  (parallel — both triggered by setup)
 *   2: deploy      (barrier join — waits for both lint and test)
 */
export default workflow('ci-pipeline', {
  state: {
    dependenciesInstalled: false,
    lintPassed: false,
    lintErrors: 0,
    testsPassed: false,
    testsFailed: 0,
    deployed: false,
    deployTarget: '',
  },
  version: '1.0.0',
  description:
    'CI pipeline with parallel lint/test and fan-in deploy, demonstrating barrier channels',
})
  .add(
    'setup',
    node((_state) => {
      // Simulate installing project dependencies
      return { dependenciesInstalled: true }
    }),
  )
  .add(
    'lint',
    node((state) => {
      // Simulate running a linter
      if (!state.dependenciesInstalled) {
        throw new Error('Dependencies not installed')
      }
      return { lintPassed: true, lintErrors: 0 }
    }),
  )
  .add(
    'test',
    node((state) => {
      // Simulate running the test suite
      if (!state.dependenciesInstalled) {
        throw new Error('Dependencies not installed')
      }
      return { testsPassed: true, testsFailed: 0 }
    }),
  )
  .add(
    'deploy',
    node((state) => {
      // Deploy only if both lint and test passed
      if (!state.lintPassed || !state.testsPassed) {
        throw new Error('Quality gate failed — cannot deploy')
      }
      return { deployed: true, deployTarget: 'production' }
    }),
  )
  .edge(START, 'setup')
  .edge('setup', 'lint')
  .edge('setup', 'test')
  .edge('lint', 'deploy')
  .edge('test', 'deploy')
  .edge('deploy', END)
  .build()
