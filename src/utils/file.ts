import { promises as fs } from "fs";
import * as path from "path";
import { NodeNotFoundError, ValidationError } from "../errors.js";

export async function ensureDir(dirPath: string): Promise<void> {
  const abs = path.resolve(dirPath);
  await fs.mkdir(abs, { recursive: true });
}

export async function readJSON<T>(filePath: string): Promise<T> {
  const abs = path.resolve(filePath);
  let content: string;
  try {
    content = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NodeNotFoundError(filePath);
    }
    throw err;
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new ValidationError(`文件 '${filePath}' 不是合法的 JSON`);
  }
}

export async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  const abs = path.resolve(filePath);
  await ensureDir(path.dirname(abs));
  const content = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(abs, content, "utf-8");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(path.resolve(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(path.resolve(filePath));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw err;
  }
}

export async function listFiles(dirPath: string): Promise<string[]> {
  const abs = path.resolve(dirPath);
  try {
    const entries = await fs.readdir(abs);
    return entries.filter((f: string) => f.endsWith(".json"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
