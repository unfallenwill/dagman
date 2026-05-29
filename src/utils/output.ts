import { ValidationError, CliError } from "../errors.js";

/**
 * Higher-order function that wraps a command action with unified error handling.
 *
 * - CliError: prints message directly (already user-facing)
 * - ValidationError: prints message + error list
 * - All other Error: prints message
 *
 * Commands should throw errors instead of calling process.exit(1) directly.
 */
export function withErrorHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        console.error(`Error: ${err.message}`);
        for (const e of err.errors) {
          console.error(`  - ${e}`);
        }
      } else {
        console.error(`Error: ${(err as Error).message}`);
      }
      process.exit(1);
    }
  };
}

/** Output data as formatted JSON to stdout. */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
