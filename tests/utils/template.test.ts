import { describe, it, expect } from "vitest";
import { extractVarRefs, hasVarRefs, renderTemplate } from "../../src/utils/template.js";

describe("extractVarRefs", () => {
  it("should extract self reference", () => {
    const refs = extractVarRefs("Run with {{output-dir}}");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      expr: "output-dir",
      source: "self",
      key: "output-dir",
    });
  });

  it("should extract global reference", () => {
    const refs = extractVarRefs("Deploy to {{global.env}}");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      expr: "global.env",
      source: "global",
      key: "env",
    });
  });

  it("should extract node reference", () => {
    const refs = extractVarRefs("Use {{build.output-path}} for deployment");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      expr: "build.output-path",
      source: "node",
      nodeName: "build",
      key: "output-path",
    });
  });

  it("should extract multiple different references", () => {
    const refs = extractVarRefs(
      "Build {{global.project}} using {{setup.tool}} and {{config}}"
    );
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.source)).toEqual(["global", "node", "self"]);
  });

  it("should deduplicate identical references", () => {
    const refs = extractVarRefs("Use {{global.env}} in {{global.env}} mode");
    expect(refs).toHaveLength(1);
  });

  it("should return empty array for plain text", () => {
    const refs = extractVarRefs("No variables here");
    expect(refs).toHaveLength(0);
  });

  it("should not confuse shell-like syntax", () => {
    const refs = extractVarRefs("Run ${PATH} and {{global.env}}");
    // ${PATH} is not a Handlebars expression
    expect(refs).toHaveLength(1);
    expect(refs[0].key).toBe("env");
  });

  it("should handle code with template literals", () => {
    const refs = extractVarRefs(
      "const x = `${process.env.HOME}`; Use {{global.key}}"
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].source).toBe("global");
  });
});

describe("hasVarRefs", () => {
  it("should return true when refs exist", () => {
    expect(hasVarRefs("Hello {{name}}")).toBe(true);
  });

  it("should return false when no refs", () => {
    expect(hasVarRefs("Hello world")).toBe(false);
  });
});

describe("renderTemplate", () => {
  it("should render self reference", () => {
    const { text, missing } = renderTemplate("Path: {{dir}}", (source, key) => {
      if (source === "self" && key === "dir") return "/tmp/build";
      return undefined;
    });
    expect(text).toBe("Path: /tmp/build");
    expect(missing).toHaveLength(0);
  });

  it("should render global reference", () => {
    const { text, missing } = renderTemplate(
      "Deploy to {{global.env}}",
      (source, key) => {
        if (source === "global" && key === "env") return "production";
        return undefined;
      }
    );
    expect(text).toBe("Deploy to production");
    expect(missing).toHaveLength(0);
  });

  it("should render node reference", () => {
    const { text, missing } = renderTemplate(
      "Use {{build.output}}",
      (source, key, nodeName) => {
        if (source === "node" && nodeName === "build" && key === "output")
          return "/dist";
        return undefined;
      }
    );
    expect(text).toBe("Use /dist");
    expect(missing).toHaveLength(0);
  });

  it("should report missing variables", () => {
    const { text, missing } = renderTemplate(
      "Path: {{missing-key}}",
      () => undefined
    );
    expect(missing).toEqual(["{{missing-key}}"]);
    expect(text).toBe("Path: {{missing-key}}");
  });

  it("should render mixed references", () => {
    const { text, missing } = renderTemplate(
      "{{global.project}}: {{build.artifact}} at {{version}}",
      (source, key, nodeName) => {
        if (source === "global" && key === "project") return "dagman";
        if (source === "node" && nodeName === "build" && key === "artifact")
          return "dist/dagman.tar.gz";
        if (source === "self" && key === "version") return "1.0.0";
        return undefined;
      }
    );
    expect(text).toBe("dagman: dist/dagman.tar.gz at 1.0.0");
    expect(missing).toHaveLength(0);
  });

  it("should return original text when no refs", () => {
    const { text, missing } = renderTemplate("Plain text", () => undefined);
    expect(text).toBe("Plain text");
    expect(missing).toHaveLength(0);
  });
});
