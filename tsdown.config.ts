import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'bin/dagman': 'bin/dagman.ts',
    index: 'src/index.ts',
    api: 'src/api/index.ts',
  },
  format: 'esm',
  platform: 'node',
  dts: true,
  clean: true,
  outDir: 'dist',
  fixedExtension: false,
  deps: {
    neverBundle: ['tsx'],
  },
})
