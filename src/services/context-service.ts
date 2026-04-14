import type { ContextData } from "../models/context.js";
import { CONTEXT_DIR } from "../constants.js";
import { readJSON, writeJSON, deleteFile, ensureDir } from "../utils/file.js";

export async function getContext(nodeName: string): Promise<ContextData> {
  try {
    return await readJSON<ContextData>(`${CONTEXT_DIR}/${nodeName}.json`);
  } catch {
    return {};
  }
}

export async function setContextField(
  nodeName: string,
  key: string,
  value: string
): Promise<void> {
  const context = await getContext(nodeName);
  context[key] = value;
  await ensureDir(CONTEXT_DIR);
  await writeJSON(`${CONTEXT_DIR}/${nodeName}.json`, context);
}

export async function getContextField(
  nodeName: string,
  key: string
): Promise<{ found: boolean; value?: string }> {
  const context = await getContext(nodeName);
  if (key in context) {
    return { found: true, value: String(context[key]) };
  }
  return { found: false };
}

export async function clearContext(nodeName: string): Promise<void> {
  await deleteFile(`${CONTEXT_DIR}/${nodeName}.json`);
}
