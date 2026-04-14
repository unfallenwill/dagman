export interface NormalizedDependency {
  node: string;
  status: string;
}

export type Dependency = string | NormalizedDependency;

export interface Node {
  name: string;
  description: string;
  instructions: string;
  states: string[];
  default_state: string;
  depends_on: Dependency[];
}

export function normalizeDependency(dep: Dependency): NormalizedDependency {
  if (typeof dep === "string") {
    return { node: dep, status: "success" };
  }
  return dep;
}
