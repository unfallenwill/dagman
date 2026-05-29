import { describe, it, expect } from "vitest";
import { node } from "../../src/api/node.js";
import { workflow, START, END } from "../../src/api/workflow.js";

describe("node builder", () => {
  it("creates a node with fn only", () => {
    const fn = (state: any) => { console.log(state); };
    const n = node(fn);
    expect(n._state.fn).toBe(fn);
    expect(n._state.stateKey).toBeUndefined();
  });

  it("creates a node with fn and stateKey", () => {
    const fn = (state: any) => {};
    const n = node(fn, "intent");
    expect(n._state.fn).toBe(fn);
    expect(n._state.stateKey).toBe("intent");
  });
});

describe("workflow builder", () => {
  it("builds a simple linear workflow", () => {
    const a = node((state: any) => {}, "output");
    const b = node((state: any) => {});

    const def = workflow("test", { state: {} })
      .add("a", a)
      .add("b", b)
      .edge("b", "a")
      .build();

    expect(def.name).toBe("test");
    expect(def.nodes).toHaveLength(2);
    expect(def.nodes[0].name).toBe("a");
    expect(def.nodes[0].stateKey).toBe("output");
    expect(def.nodes[1].name).toBe("b");
    expect(def.edges).toHaveLength(1);
    expect(def.edges[0]).toEqual({ from: "b", to: "a" });
  });

  it("includes condEdge in the definition", () => {
    const classify = node((state: any) => {}, "intent");
    const tool = node((state: any) => {}, "answer");
    const chat = node((state: any) => {});

    const routeFn = (state: any) =>
      state.intent === "need_tool" ? "tool" : "chat";

    const def = workflow("pipeline", { state: {} })
      .add("classify", classify)
      .add("tool", tool)
      .add("chat", chat)
      .edge("classify", "classify")  // dummy, just for structure
      .condEdge("classify", ["tool", "chat"], routeFn)
      .build();

    expect(def.nodes).toHaveLength(3);
    expect(def.condEdges).toHaveLength(1);
    expect(def.condEdges[0].nodeName).toBe("cond:classify→route");
    expect(def.condEdges[0].from).toBe("classify");
    expect(def.condEdges[0].targets).toEqual(["tool", "chat"]);
    expect(def.condEdges[0].fn).toBe(routeFn);
  });

  it("builds with multiple edges", () => {
    const a = node((state: any) => {});
    const b = node((state: any) => {});
    const c = node((state: any) => {});

    const def = workflow("multi", { state: {} })
      .add("a", a)
      .add("b", b)
      .add("c", c)
      .edge("b", "a")
      .edge("c", "a")
      .build();

    expect(def.edges).toHaveLength(2);
    expect(def.nodes).toHaveLength(3);
  });

  it("preserves function references in NodeDef", () => {
    const fnA = (state: any) => { console.log("A"); };
    const fnB = (state: any) => { console.log("B"); };

    const a = node(fnA);
    const b = node(fnB, "result");

    const def = workflow("fns", { state: {} })
      .add("a", a)
      .add("b", b)
      .build();

    expect(def.nodes[0].fn).toBe(fnA);
    expect(def.nodes[1].fn).toBe(fnB);
    expect(def.nodes[1].stateKey).toBe("result");
  });
});

describe("fanOut builder", () => {
  it("includes fanOut in the definition", () => {
    const source = node((state: any) => {}, "items");
    const process = node((state: any) => {}, "result");
    const fanOutFn = (state: any) => state.items as any[];

    const def = workflow("fanout-test", { state: {} })
      .add("source", source)
      .add("process", process)
      .fanOut("source", "process", fanOutFn)
      .build();

    expect(def.fanOuts).toHaveLength(1);
    expect(def.fanOuts[0].nodeName).toBe("fanout:source→process");
    expect(def.fanOuts[0].from).toBe("source");
    expect(def.fanOuts[0].templateNode).toBe("process");
    expect(def.fanOuts[0].fn).toBe(fanOutFn);
  });

  it("supports multiple fanOuts", () => {
    const a = node((state: any) => {});
    const b = node((state: any) => {});
    const c = node((state: any) => {});

    const def = workflow("multi-fanout", { state: {} })
      .add("a", a)
      .add("b", b)
      .add("c", c)
      .fanOut("a", "b", (state: any) => [1, 2])
      .fanOut("b", "c", (state: any) => ["x", "y", "z"])
      .build();

    expect(def.fanOuts).toHaveLength(2);
    expect(def.fanOuts[0].nodeName).toBe("fanout:a→b");
    expect(def.fanOuts[1].nodeName).toBe("fanout:b→c");
  });
});

describe("subgraph builder", () => {
  it("expands child nodes with prefix", () => {
    const childDef = workflow("child", { state: {} })
      .add("step1", node((state: any) => {}))
      .add("step2", node((state: any) => {}))
      .edge("step2", "step1")
      .build();

    const parentDef = workflow("parent", { state: {} })
      .add("setup", node((state: any) => {}))
      .subgraph("process", childDef)
      .build();

    // Should have: setup, process.step1, process.step2
    expect(parentDef.nodes).toHaveLength(3);
    const names = parentDef.nodes.map((n) => n.name);
    expect(names).toContain("setup");
    expect(names).toContain("process.step1");
    expect(names).toContain("process.step2");
  });

  it("remaps child edges with prefix", () => {
    const childDef = workflow("child", { state: {} })
      .add("step1", node((state: any) => {}))
      .add("step2", node((state: any) => {}))
      .edge("step2", "step1")
      .build();

    const parentDef = workflow("parent", { state: {} })
      .subgraph("process", childDef)
      .edge("process.step1", "setup")
      .add("setup", node((state: any) => {}))
      .build();

    // Child edge remapped: process.step2 → process.step1
    expect(parentDef.edges).toContainEqual({ from: "process.step2", to: "process.step1" });
    // Parent edge: process.step1 depends on setup
    expect(parentDef.edges).toContainEqual({ from: "process.step1", to: "setup" });
  });

  it("remaps child condEdges with prefix", () => {
    const routeFn = (state: any) => "step2a";
    const childDef = workflow("child", { state: {} })
      .add("step1", node((state: any) => {}))
      .add("step2a", node((state: any) => {}))
      .add("step2b", node((state: any) => {}))
      .condEdge("step1", ["step2a", "step2b"], routeFn)
      .build();

    const parentDef = workflow("parent", { state: {} })
      .subgraph("process", childDef)
      .build();

    expect(parentDef.condEdges).toHaveLength(1);
    expect(parentDef.condEdges[0].nodeName).toBe("process.cond:step1→route");
    expect(parentDef.condEdges[0].from).toBe("process.step1");
    expect(parentDef.condEdges[0].targets).toEqual(["process.step2a", "process.step2b"]);
    expect(parentDef.condEdges[0].fn).toBe(routeFn);
  });

  it("supports nested subgraphs", () => {
    const innerDef = workflow("inner", { state: {} })
      .add("a", node((state: any) => {}))
      .add("b", node((state: any) => {}))
      .edge("b", "a")
      .build();

    const middleDef = workflow("middle", { state: {} })
      .subgraph("inner", innerDef)
      .add("c", node((state: any) => {}))
      .edge("c", "inner.b")
      .build();

    const outerDef = workflow("outer", { state: {} })
      .subgraph("mid", middleDef)
      .build();

    const names = outerDef.nodes.map((n) => n.name);
    expect(names).toContain("mid.inner.a");
    expect(names).toContain("mid.inner.b");
    expect(names).toContain("mid.c");
  });
});
