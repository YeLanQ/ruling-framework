// Knowledge data contracts and query/inspection result shapes.

import type { GraphSnapshot } from "./graph.js";
import type { KnowledgeStatus } from "./semantic.js";

export type KnowledgeKind = "seed" | "extended" | "error";

export interface KnowledgeUnit {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  /** Action ids this unit recommends; used by the brain-first planner. */
  uses?: string[];
  /** Where the unit came from: seed / workspace / runtime / external:<id>. */
  origin?: string;
  namespace: string;
  domain?: string;
  aliases: string[];
  status: KnowledgeStatus;
  confidence: number;
  version: number;
  supersedes?: string[];
  supersededBy?: string;
  contradicts?: string[];
  validFrom?: number;
  validUntil?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt: number;
  hits: number;
  lastHitAt: number;
  hot: boolean;
}

export interface KnowledgeSnapshot {
  units: KnowledgeUnit[];
  graph: GraphSnapshot;
}

export interface KnowledgeInput {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary?: string;
  body: string;
  tags?: string[];
  uses?: string[];
  origin?: string;
  namespace?: string;
  domain?: string;
  aliases?: string[];
  status?: KnowledgeStatus;
  confidence?: number;
  version?: number;
  supersedes?: string[];
  supersededBy?: string;
  contradicts?: string[];
  validFrom?: number;
  validUntil?: number;
  reviewedBy?: string;
  reviewedAt?: number;
  createdAt?: number;
}

export interface ObservationDetail {
  reason?: string;
  errorCode?: string;
}

export interface KnowledgeQueryOptions {
  topK?: number;
  namespace?: string;
  domain?: string;
  status?: KnowledgeStatus;
  tag?: string;
}

export interface KnowledgeDuplicate {
  a: string;
  b: string;
  score: number;
  reason: "near-duplicate" | "shared-alias";
}

export interface KnowledgeConflict {
  a: string;
  b: string;
  reason: "contradicts";
}

export interface KnowledgeStats {
  total: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  byNamespace: Record<string, number>;
  byDomain: Record<string, number>;
}
