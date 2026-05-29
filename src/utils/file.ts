import { promises as fs } from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
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
    throw new ValidationError(`file '${filePath}' is not valid JSON`);
  }
}

export async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  const abs = path.resolve(filePath);
  await ensureDir(path.dirname(abs));
  const content = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(abs, content, "utf-8");
}

export async function readYAML<T>(filePath: string): Promise<T> {
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
    return yaml.load(content) as T;
  } catch {
    throw new ValidationError(`file '${filePath}' is not valid YAML`);
  }
}

export async function readYAMLAll<T>(filePath: string): Promise<T[]> {
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
    const docs: T[] = [];
    yaml.loadAll(content, (doc: unknown) => {
      if (doc != null) docs.push(doc as T);
    });
    return docs;
  } catch {
    throw new ValidationError(`file '${filePath}' is not valid YAML`);
  }
}

export async function writeYAML<T>(filePath: string, data: T): Promise<void> {
  const abs = path.resolve(filePath);
  await ensureDir(path.dirname(abs));
  const content = yaml.dump(data, { lineWidth: -1 }) + "\n";
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

export async function listFiles(dirPath: string, ext = ".json"): Promise<string[]> {
  const abs = path.resolve(dirPath);
  try {
    const entries = await fs.readdir(abs);
    return entries.filter((f: string) => f.endsWith(ext));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
