// Three-layer knowledge store with deterministic semantic management:
// namespace/domain/aliases, status/confidence/version, synonym expansion,
// hybrid retrieval, duplicate/conflict detection. Persistence is split by
// layer; external units are never written into local libraries.

import type { KnowledgeHit } from "../types.js";
import { embed, type QuantVec } from "./embed.js";
import { KnowledgeGraph, type GraphSnapshot } from "./graph.js";
import { recordObservation } from "./store-observation.js";
import {
  dedupeKnowledge,
  knowledgeConflicts,
  knowledgeStats,
  searchKnowledge
} from "./store-semantic.js";
import type {
  KnowledgeConflict,
  KnowledgeDuplicate,
  KnowledgeInput,
  KnowledgeKind,
  KnowledgeQueryOptions,
  KnowledgeSnapshot,
  KnowledgeStats,
  KnowledgeUnit,
  ObservationDetail
} from "./store-types.js";

export * from "./store-types.js";

const RECENCY_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;
const DEMOTE_BELOW = 0.15;
const MAX_EXTENDED_UNITS = 512;

export function isExternal(unit: KnowledgeUnit): boolean {
  return (unit.origin ?? "").startsWith("external:");
}

export class KnowledgeStore {
  private readonly units = new Map<string, KnowledgeUnit>();
  private readonly vectors = new Map<string, QuantVec>();
  private synonyms: string[][] = [];
  readonly graph = new KnowledgeGraph();

  constructor(units: KnowledgeInput[] = []) {
    for (const unit of units) {
      this.add({ ...unit, origin: unit.origin ?? "seed" });
    }
  }

  add(input: KnowledgeInput): KnowledgeUnit {
    const unit: KnowledgeUnit = {
      id: input.id,
      kind: input.kind,
      title: input.title,
      summary: input.summary ?? "",
      body: input.body,
      tags: input.tags ?? [],
      uses: input.uses,
      origin: input.origin ?? "runtime",
      namespace: input.namespace ?? "local",
      domain: input.domain,
      aliases: input.aliases ?? [],
      status: input.status ?? "active",
      confidence: input.confidence ?? (input.kind === "seed" ? 1 : 0.8),
      version: input.version ?? 1,
      supersedes: input.supersedes,
      supersededBy: input.supersededBy,
      contradicts: input.contradicts,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      createdAt: input.createdAt ?? Date.now(),
      hits: 0,
      lastHitAt: 0,
      hot: true
    };
    this.put(unit);
    this.trimExtended();
    return unit;
  }

  update(id: string, patch: Partial<KnowledgeInput>): KnowledgeUnit | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated: KnowledgeUnit = {
      ...existing,
      ...patch,
      id,
      version: patch.version ?? existing.version + 1,
      createdAt: existing.createdAt,
      hits: existing.hits,
      lastHitAt: existing.lastHitAt,
      hot: true
    };
    this.put(updated);
    return updated;
  }

  addMany(inputs: KnowledgeInput[]): KnowledgeUnit[] {
    return inputs.map((input) => this.add(input));
  }

  get(id: string): KnowledgeUnit | undefined {
    return this.units.get(id);
  }

  all(): KnowledgeUnit[] {
    return [...this.units.values()];
  }

  unitsByKind(kind?: KnowledgeKind): KnowledgeUnit[] {
    const all = this.all();
    return kind ? all.filter((unit) => unit.kind === kind) : all;
  }

  vectorOf(id: string): QuantVec | undefined {
    return this.vectors.get(id);
  }

  touch(id: string, now: number): KnowledgeUnit | undefined {
    const unit = this.units.get(id);
    if (!unit) return undefined;
    unit.hits += 1;
    unit.lastHitAt = now;
    unit.hot = true;
    return unit;
  }

  setSynonyms(groups: string[][]): void {
    this.synonyms = groups;
  }

  synonymGroups(): string[][] {
    return this.synonyms;
  }

  /**
   * Units that belong in local persistence. Seed is reloaded from manifests;
   * external sources are reloaded from their source. Everything else persists.
   */
  persistentUnits(): KnowledgeUnit[] {
    return this.all().filter((unit) => unit.kind !== "seed" && !isExternal(unit));
  }

  removeByOriginPrefix(prefix: string): number {
    let removed = 0;
    for (const [id, unit] of this.units) {
      if ((unit.origin ?? "").startsWith(prefix)) {
        this.units.delete(id);
        this.vectors.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  search(query: string, options: KnowledgeQueryOptions = {}, now = Date.now()): KnowledgeHit[] {
    return searchKnowledge(this, query, options, now);
  }

  route(query: string, topK = 5, now = Date.now()): KnowledgeHit[] {
    return this.search(query, { topK }, now);
  }

  dedupe(threshold = 0.95): KnowledgeDuplicate[] {
    return dedupeKnowledge(this, threshold);
  }

  conflicts(): KnowledgeConflict[] {
    return knowledgeConflicts(this);
  }

  stats(): KnowledgeStats {
    return knowledgeStats(this);
  }

  recordObservation(
    task: string,
    action: string,
    ok: boolean,
    now = Date.now(),
    detail: ObservationDetail = {}
  ): void {
    recordObservation(this, task, action, ok, now, detail);
  }

  tick(now = Date.now()): { pruned: number; demoted: number } {
    const pruned = this.graph.prune(now);
    let demoted = 0;
    for (const unit of this.units.values()) {
      if (unit.kind === "seed" || unit.kind === "error") {
        unit.hot = true;
        continue;
      }
      const age = Math.max(0, now - Math.max(unit.lastHitAt, unit.createdAt));
      const recency = Math.pow(2, -age / RECENCY_HALF_LIFE_MS);
      const temperature = Math.log1p(unit.hits) + recency;
      if (temperature < DEMOTE_BELOW && unit.hot) {
        unit.hot = false;
        demoted += 1;
      }
    }
    return { pruned, demoted };
  }

  private trimExtended(): void {
    const extended = this.all().filter(
      (unit) => unit.kind === "extended" && !isExternal(unit)
    );
    if (extended.length <= MAX_EXTENDED_UNITS) return;
    extended.sort((a, b) => a.lastHitAt - b.lastHitAt || a.createdAt - b.createdAt);
    for (const unit of extended.slice(0, extended.length - MAX_EXTENDED_UNITS)) {
      if (unit.id.startsWith("outcome:")) continue;
      this.units.delete(unit.id);
      this.vectors.delete(unit.id);
    }
  }

  snapshot(): KnowledgeSnapshot {
    return {
      units: this.all().map((unit) => ({ ...unit })),
      graph: this.graph.snapshot()
    };
  }

  graphSnapshot(): GraphSnapshot {
    return this.graph.snapshot();
  }

  restoreGraph(graph: GraphSnapshot): void {
    this.graph.restore(graph);
  }

  restore(snapshot: KnowledgeSnapshot): void {
    this.units.clear();
    this.vectors.clear();
    for (const unit of snapshot.units ?? []) this.put({ ...unit });
    this.graph.restore(snapshot.graph);
  }

  restorePersistent(units: KnowledgeUnit[]): void {
    const keep = this.all().filter(
      (unit) => unit.kind === "seed" || isExternal(unit)
    );
    const keepIds = new Set(keep.map((unit) => unit.id));
    this.units.clear();
    this.vectors.clear();
    for (const unit of keep) this.put({ ...unit });
    for (const unit of units) {
      if (!keepIds.has(unit.id)) this.put({ ...unit });
    }
  }

  private put(unit: KnowledgeUnit): void {
    const safe: KnowledgeUnit = {
      ...unit,
      namespace: unit.namespace ?? "local",
      aliases: unit.aliases ?? [],
      status: unit.status ?? "active",
      confidence: typeof unit.confidence === "number" ? unit.confidence : 0.8,
      version: typeof unit.version === "number" ? unit.version : 1
    };
    this.units.set(safe.id, safe);
    this.reindex(safe);
  }

  private reindex(unit: KnowledgeUnit): void {
    this.vectors.set(
      unit.id,
      embed(
        [unit.title, unit.summary, unit.body, ...(unit.tags ?? []), ...(unit.aliases ?? [])].join(" ")
      )
    );
  }
}

// Re-export helpers used by callers that only import the store.
export type { KnowledgeStatus } from "./semantic.js";
export {
  isKnowledgeStatus,
  statusWeight,
  confidenceWeight,
  aliasScore,
  metadataScore,
  expandTerms
} from "./semantic.js";
