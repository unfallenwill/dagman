export interface Edge {
  from: string;
  to: string;
  expect?: "success" | "skipped";
}

export interface Graph {
  name: string;
  edges: Edge[];
}
