import { describe, expect, it } from "vitest";

import {
  EDGE_HALF_LIFE_MS,
  KnowledgeGraph,
  decayWeight
} from "./graph.js";

describe("KnowledgeGraph", () => {
  it("reinforces and halves after one half-life", () => {
    const graph = new KnowledgeGraph();
    graph.reinforce("task", "doc.write", "caused", 0.18, 0);
    expect(graph.get("task", "doc.write", "caused", 0)?.weight).toBeCloseTo(0.18, 5);
    expect(
      graph.get("task", "doc.write", "caused", EDGE_HALF_LIFE_MS)?.weight
    ).toBeCloseTo(0.09, 5);
  });

  it("decays the old weight before applying new gain", () => {
    const graph = new KnowledgeGraph();
    graph.reinforce("task", "doc.write", "caused", 0.18, 0);
    graph.reinforce("task", "doc.write", "caused", 0.18, EDGE_HALF_LIFE_MS);
    expect(
      graph.get("task", "doc.write", "caused", EDGE_HALF_LIFE_MS)?.weight
    ).toBeCloseTo(0.27, 5);
  });

  it("prunes edges below the threshold", () => {
    const graph = new KnowledgeGraph();
    graph.reinforce("a", "b", "coOccurs", 0.01, 0);
    expect(graph.prune(EDGE_HALF_LIFE_MS * 3)).toBe(1);
    expect(graph.size()).toBe(0);
  });

  it("lists neighbors by id", () => {
    const graph = new KnowledgeGraph();
    graph.reinforce("task", "a", "caused", 0.2, 0);
    graph.reinforce("task", "b", "caused", 0.3, 0);
    expect(graph.neighbors("task", 0)).toHaveLength(2);
  });

  it("exposes the decay function", () => {
    expect(decayWeight(1, 0, EDGE_HALF_LIFE_MS)).toBeCloseTo(0.5, 5);
  });
});
