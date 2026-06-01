/**
 * Module resolve hook for `module.register()`.
 *
 * When dagman is installed globally and loads a workflow file from an external
 * project, bare specifier imports like `import { node } from "dagman/api"` fail
 * because Node.js resolves from the workflow file's location — which has no
 * `node_modules/dagman`.
 *
 * This hook intercepts `"dagman"` / `"dagman/api"` specifiers and redirects
 * them to the actual installed paths of the dagman package.
 *
 * Must be a standalone file (no external deps) and registered via
 * `module.register()` before any workflow `import()`.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// dist/bin/dagman-resolve-hook.js -> dist/
const distRoot = path.resolve(__dirname, '..')

export function resolve(
  specifier: string,
  context: { parentURL: string | undefined },
  nextResolve: (specifier: string, context: { parentURL: string | undefined }) => unknown,
): unknown {
  // Only intercept bare specifiers starting with "dagman"
  if (specifier === 'dagman') {
    return {
      url: pathToFileURL(path.join(distRoot, 'index.js')).href,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('dagman/')) {
    const subpath = specifier.slice('dagman/'.length)
    return {
      url: pathToFileURL(path.join(distRoot, `${subpath}.js`)).href,
      shortCircuit: true,
    }
  }

  return nextResolve(specifier, context)
}
