/**
 * Clock function — returns an ISO timestamp string.
 * Inject to make timestamp-dependent logic deterministic in tests.
 */
export type Clock = () => string

/** System clock — returns the current time as an ISO string. */
export const systemClock: Clock = () => new Date().toISOString()

/** Fixed clock — always returns the given ISO string. */
export const fixedClock =
  (iso: string): Clock =>
  () =>
    iso
