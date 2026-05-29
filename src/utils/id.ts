import { randomBytes } from 'crypto'

/**
 * ID generator function — returns a unique string.
 * Inject to make ID-dependent logic deterministic in tests.
 */
export type IdGenerator = () => string

/** System ID generator — uses crypto-random hex suffixes. */
export const systemIdGenerator: IdGenerator = () => randomBytes(4).toString('hex')

/** Sequential ID generator — produces predictable IDs for testing. */
export const sequentialIdGenerator = (prefix = 'test'): IdGenerator => {
  let n = 0
  return () => `${prefix}-${String(n++).padStart(4, '0')}`
}

/**
 * Generate instance ID: <workflowName>@<8-char-hex>
 * @example generateInstanceId("demo") → "demo@1a2b3c4d"
 */
export function generateInstanceId(workflowName: string): string {
  const suffix = randomBytes(4).toString('hex')
  return `${workflowName}@${suffix}`
}

/**
 * Parse instance ID → { workflowName, suffix }
 * @throws {Error} if ID is invalid (missing @)
 */
export function parseInstanceId(id: string): {
  workflowName: string
  suffix: string
} {
  const idx = id.indexOf('@')
  if (idx === -1) {
    throw new Error(`invalid instance ID: ${id}`)
  }
  return { workflowName: id.slice(0, idx), suffix: id.slice(idx + 1) }
}

/**
 * Parse node reference: <node-name>@<instance-suffix> → { nodeName, instanceSuffix }
 * @throws {Error} if ref is invalid (missing @)
 * @example parseNodeRef("classify@abc123") → { nodeName: "classify", instanceSuffix: "abc123" }
 */
export function parseNodeRef(ref: string): {
  nodeName: string
  instanceSuffix: string
} {
  const idx = ref.lastIndexOf('@')
  if (idx === -1) {
    throw new Error(`invalid node reference: ${ref}`)
  }
  return { nodeName: ref.slice(0, idx), instanceSuffix: ref.slice(idx + 1) }
}
