import Handlebars from "handlebars";

/**
 * 变量引用格式：
 *   {{global.key}}      — 全局上下文
 *   {{node-name.key}}   — 上游节点上下文
 *   {{key}}             — 当前节点自身上下文
 */

export interface VarRef {
  /** 表达式，如 "global.key" */
  expr: string;
  /** 来源 */
  source: "global" | "node" | "self";
  /** 节点名（仅 source=node 时有值） */
  nodeName?: string;
  /** 键名 */
  key: string;
}

type ASTNode = {
  type: string;
  [key: string]: unknown;
  body?: ASTNode[];
  program?: ASTNode;
  inverse?: ASTNode;
};

/**
 * 从文本中提取所有变量引用。
 */
export function extractVarRefs(text: string): VarRef[] {
  const refs: VarRef[] = [];
  const seen = new Set<string>();

  const ast = Handlebars.parse(text) as unknown as ASTNode;
  collectRefs(ast, refs, seen);

  return refs;
}

function collectRefs(node: ASTNode, refs: VarRef[], seen: Set<string>): void {
  if (
    node.type === "MustacheStatement" &&
    "path" in node &&
    typeof node.path === "object" &&
    node.path !== null &&
    "type" in (node.path as ASTNode) &&
    (node.path as ASTNode).type === "PathExpression" &&
    "original" in (node.path as ASTNode)
  ) {
    const expr = (node.path as ASTNode & { original: string }).original;
    if (seen.has(expr)) return;
    seen.add(expr);

    const ref = parseVarExpr(expr);
    if (ref) refs.push(ref);
  }

  if (Array.isArray(node.body)) {
    for (const child of node.body) {
      collectRefs(child, refs, seen);
    }
  }

  if (node.program) {
    collectRefs(node.program, refs, seen);
  }

  if (node.inverse) {
    collectRefs(node.inverse, refs, seen);
  }
}

/**
 * 判断文本中是否包含变量引用。
 */
export function hasVarRefs(text: string): boolean {
  return extractVarRefs(text).length > 0;
}

/**
 * 渲染文本中的变量引用。
 * resolver 接收 (source, key, nodeName?) 返回值字符串，找不到时返回 undefined。
 */
export function renderTemplate(
  text: string,
  resolver: (
    source: "global" | "node" | "self",
    key: string,
    nodeName?: string
  ) => string | undefined
): { text: string; missing: string[] } {
  const refs = extractVarRefs(text);
  if (refs.length === 0) return { text, missing: [] };

  const missing: string[] = [];
  let result = text;

  // 按表达式长度降序替换，避免短表达式误匹配长表达式的子串
  const sorted = [...refs].sort((a, b) => b.expr.length - a.expr.length);

  for (const ref of sorted) {
    const value = resolver(ref.source, ref.key, ref.nodeName);
    const tag = `{{${ref.expr}}}`;
    if (value === undefined) {
      missing.push(tag);
    } else {
      result = result.split(tag).join(value);
    }
  }

  return { text: result, missing };
}

function parseVarExpr(expr: string): VarRef | null {
  const dotIndex = expr.indexOf(".");
  if (dotIndex === -1) {
    if (!expr) return null;
    return { expr, source: "self", key: expr };
  }

  const namespace = expr.slice(0, dotIndex);
  const key = expr.slice(dotIndex + 1);
  if (!key) return null;

  if (namespace === "global") {
    return { expr, source: "global", key };
  }

  return { expr, source: "node", nodeName: namespace, key };
}
