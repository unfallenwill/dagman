import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: [],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'bin/**/*.ts'],
      exclude: ['src/models/*.ts', 'src/index.ts', 'src/api/types.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
})
