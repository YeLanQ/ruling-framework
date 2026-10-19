// Weighted knowledge graph. Edge weights decay with a 14-day half-life and
// are reinforced by successful (and, at lower gain, failed) observations.
// This is experience accounting, not model training.

export const EDGE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
export const PRUNE_BELOW = 0.02;
export const GAIN_TASK_ACTION = 0.18;
export const GAIN_ACTION_OUTCOME = 0.14;
export const FAILURE_GAIN_FACTOR = 0.4;

export type EdgeKind = "mentions" | "uses" | "caused" | "coOccurs";

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  weight: number;
  updatedAt: number;
}

export interface GraphSnapshot {
  edges: Edge[];
}

function edgeKey(from: string, kind: EdgeKind, to: string): string {
  return `${from}\u0000${kind}\u0000${to}`;
}

export function decayWeight(weight: number, updatedAt: number, now: number): number {
  const delta = Math.max(0, now - updatedAt);
  return weight * Math.pow(2, -delta / EDGE_HALF_LIFE_MS);
}

export class KnowledgeGraph {
  private readonly edges = new Map<string, Edge>();

  reinforce(from: string, to: string, kind: EdgeKind, gain: number, now = Date.now()): Edge {
    const key = edgeKey(from, kind, to);
    const existing = this.edges.get(key);
    const decayed = existing ? decayWeight(existing.weight, existing.updatedAt, now) : 0;
    const edge: Edge = {
      from,
      to,
      kind,
      weight: Math.min(1, decayed + gain),
      updatedAt: now
    };
    this.edges.set(key, edge);
    return edge;
  }

  get(from: string, to: string, kind: EdgeKind, now = Date.now()): Edge | undefined {
    const edge = this.edges.get(edgeKey(from, kind, to));
    if (!edge) return undefined;
    return { ...edge, weight: decayWeight(edge.weight, edge.updatedAt, now) };
  }

  neighbors(id: string, now = Date.now(), kind?: EdgeKind): Edge[] {
    const out: Edge[] = [];
    for (const edge of this.edges.values()) {
      if (kind && edge.kind !== kind) continue;
      if (edge.from !== id && edge.to !== id) continue;
      out.push({ ...edge, weight: decayWeight(edge.weight, edge.updatedAt, now) });
    }
    return out;
  }

  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, edge] of this.edges) {
      if (decayWeight(edge.weight, edge.updatedAt, now) < PRUNE_BELOW) {
        this.edges.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.edges.size;
  }

  snapshot(): GraphSnapshot {
    return { edges: [...this.edges.values()].map((edge) => ({ ...edge })) };
  }

  restore(snapshot: GraphSnapshot): void {
    this.edges.clear();
    const edges = (snapshot as Partial<GraphSnapshot>).edges ?? [];
    for (const edge of edges) {
      this.edges.set(edgeKey(edge.from, edge.kind, edge.to), { ...edge });
    }
  }
}
