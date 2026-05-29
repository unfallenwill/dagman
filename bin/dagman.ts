#!/usr/bin/env node

import { run } from '../src/engine/cli.js'

process.on('uncaughtException', (err: Error) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})

run()
