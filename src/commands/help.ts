import type { Command } from "commander";
import { readFileSync } from "fs";
import * as path from "path";

function getVersion(): string {
  try {
    // 从脚本所在目录向上查找 package.json（dist/commands/help.js → package.json）
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    // 回退到 cwd
    try {
      const pkgPath = path.resolve("package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

export function registerHelpCommand(program: Command): void {
  program.description("dagman - 通用 agent 任务编排 CLI 工具").version(getVersion());
}
