// Hybrid routing: character embedding + alias/synonym/domain boosts + status
// and confidence weighting. Retrieval only nominates candidates; it never
// decides execution.

import type { KnowledgeHit } from "../types.js";
import { cosine, embed } from "./embed.js";
import {
  aliasScore,
  confidenceWeight,
  expandTerms,
  metadataScore,
  statusWeight
} from "./semantic.js";
import type { KnowledgeStore, KnowledgeUnit } from "./store.js";

export function routeKnowledge(
  store: KnowledgeStore,
  query: string,
  units: KnowledgeUnit[],
  topK = 5,
  now = Date.now()
): KnowledgeHit[] {
  const queryVector = embed(query);
  const expanded = expandTerms(query, store.synonymGroups());
  const scored = new Map<string, number>();

  for (const unit of units) {
    const vector = store.vectorOf(unit.id);
    if (!vector) continue;
    const prior = unit.kind === "seed" ? 1.15 : unit.kind === "error" ? 1.1 : 1;
    const coldPenalty = unit.hot ? 1 : 0.9;
    const base = cosine(queryVector, vector) * prior * coldPenalty;
    const semantic =
      aliasScore(query, unit.aliases, expanded) + metadataScore(unit.domain, unit.tags, expanded);
    const weighted =
      (base + semantic) * statusWeight(unit.status) * confidenceWeight(unit.confidence);
    scored.set(unit.id, weighted);
  }

  const seeds = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [seedId, seedScore] of seeds) {
    for (const edge of store.graph.neighbors(seedId, now)) {
      const other = edge.from === seedId ? edge.to : edge.from;
      const current = scored.get(other);
      if (current === undefined) continue;
      scored.set(other, current + edge.weight * 0.1 * Math.max(0.1, seedScore));
    }
  }

  const hits: KnowledgeHit[] = [];
  for (const [id, score] of [...scored.entries()].sort((a, b) => b[1] - a[1])) {
    if (score <= 0.05) break;
    const unit = store.touch(id, now);
    if (!unit) continue;
    hits.push({
      id: unit.id,
      kind: unit.kind,
      title: unit.title,
      summary: unit.summary,
      score: Number(score.toFixed(4)),
      namespace: unit.namespace,
      domain: unit.domain,
      status: unit.status,
      confidence: unit.confidence
    });
    if (hits.length >= topK) break;
  }
  return hits;
}
