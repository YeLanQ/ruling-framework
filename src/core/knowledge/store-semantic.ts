// Semantic query and inspection operations over the knowledge store.

import type { KnowledgeHit } from "../types.js";
import { cosine } from "./embed.js";
import { routeKnowledge } from "./store-route.js";
import type {
  KnowledgeConflict,
  KnowledgeDuplicate,
  KnowledgeQueryOptions,
  KnowledgeStats,
  KnowledgeStore
} from "./store.js";

export function searchKnowledge(
  store: KnowledgeStore,
  query: string,
  options: KnowledgeQueryOptions = {},
  now = Date.now()
): KnowledgeHit[] {
  const filtered = store.all().filter((unit) => {
    if (options.namespace && unit.namespace !== options.namespace) return false;
    if (options.domain && unit.domain !== options.domain) return false;
    if (options.status && unit.status !== options.status) return false;
    if (options.tag && !unit.tags.includes(options.tag)) return false;
    return true;
  });
  return routeKnowledge(store, query, filtered, options.topK ?? 5, now);
}

export function dedupeKnowledge(
  store: KnowledgeStore,
  threshold = 0.95
): KnowledgeDuplicate[] {
  const units = store.all().filter((unit) => unit.status !== "deprecated");
  const out: KnowledgeDuplicate[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const a = units[i];
    if (!a) continue;
    const va = store.vectorOf(a.id);
    if (!va) continue;
    for (let j = i + 1; j < units.length; j += 1) {
      const b = units[j];
      if (!b) continue;
      const vb = store.vectorOf(b.id);
      if (!vb) continue;
      const shared = a.aliases.some((alias) =>
        b.aliases.some((other) => other.toLowerCase() === alias.toLowerCase())
      );
      const score = cosine(va, vb);
      if (shared || score >= threshold) {
        out.push({
          a: a.id,
          b: b.id,
          score: Number(score.toFixed(4)),
          reason: shared ? "shared-alias" : "near-duplicate"
        });
      }
    }
  }
  return out;
}

export function knowledgeConflicts(store: KnowledgeStore): KnowledgeConflict[] {
  const out: KnowledgeConflict[] = [];
  const seen = new Set<string>();
  for (const unit of store.all()) {
    for (const target of unit.contradicts ?? []) {
      if (!store.get(target)) continue;
      const key = [unit.id, target].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: unit.id, b: target, reason: "contradicts" });
    }
  }
  return out;
}

export function knowledgeStats(store: KnowledgeStore): KnowledgeStats {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byNamespace: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const unit of store.all()) {
    byKind[unit.kind] = (byKind[unit.kind] ?? 0) + 1;
    byStatus[unit.status] = (byStatus[unit.status] ?? 0) + 1;
    byNamespace[unit.namespace] = (byNamespace[unit.namespace] ?? 0) + 1;
    if (unit.domain) byDomain[unit.domain] = (byDomain[unit.domain] ?? 0) + 1;
  }
  return { total: store.all().length, byKind, byStatus, byNamespace, byDomain };
}
