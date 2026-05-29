#!/usr/bin/env node

import { run } from '../src/cli.js'

process.on('uncaughtException', (err: Error) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})

run()
