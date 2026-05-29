import type { Command } from "commander";
import { getCommandMeta } from "./command-meta.js";

/**
 * Format man page style help text for a Commander command.
 * Sections: EXAMPLES, EXIT STATUS, SEE ALSO
 * (NAME / SYNOPSIS / DESCRIPTION / OPTIONS are handled by Commander itself)
 */
export function formatManHelp(cmd: Command): string {
  const meta = getCommandMeta(cmd);
  if (!meta) return "";

  const sections: string[] = [];

  // Examples
  if (meta.examples.length > 0) {
    sections.push("");
    sections.push("Examples:");
    for (const ex of meta.examples) {
      sections.push(`  ${ex.description}:`);
      sections.push(`    $ ${ex.command}`);
    }
  }

  // Exit status
  if (meta.exitStatus.length > 0) {
    sections.push("");
    sections.push("Exit Status:");
    for (const es of meta.exitStatus) {
      sections.push(`  ${es.code}  ${es.meaning}`);
    }
  }

  // See also
  if (meta.seeAlso.length > 0) {
    sections.push("");
    sections.push("See Also:");
    sections.push(`  ${meta.seeAlso.join(", ")}`);
  }

  return sections.join("\n");
}
