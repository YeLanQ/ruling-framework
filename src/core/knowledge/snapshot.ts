// Persistent state: graph + ledger in state.json.gz, experience and failure
// lessons in separate JSONL libraries. Approvals are deliberately absent.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import type { LedgerSnapshot } from "../ledger.js";
import type { GraphSnapshot } from "./graph.js";
import type { KnowledgeUnit } from "./store.js";

export interface PersistedStateV2 {
  version: 2;
  savedAt: number;
  graph: GraphSnapshot;
  ledger: LedgerSnapshot;
}

/** Legacy shape from the single-snapshot design. */
export interface PersistedStateV1 {
  version: 1;
  savedAt: number;
  knowledge: { units: KnowledgeUnit[]; graph: GraphSnapshot };
  ledger: LedgerSnapshot;
}

export type PersistedState = PersistedStateV1 | PersistedStateV2;

export function saveState(filePath: string, state: PersistedStateV2): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temp, gzipSync(Buffer.from(JSON.stringify(state), "utf8")));
  try {
    renameSync(temp, filePath);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // best effort
    }
    throw error;
  }
}

export function loadState(filePath: string): PersistedState | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(gunzipSync(readFileSync(filePath)).toString("utf8")) as PersistedState;
    if (parsed.version !== 1 && parsed.version !== 2) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function hydrateUnit(raw: unknown): KnowledgeUnit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Partial<KnowledgeUnit>;
  if (typeof record.id !== "string" || typeof record.title !== "string" || typeof record.body !== "string") {
    return undefined;
  }
  const kind =
    record.kind === "seed" || record.kind === "extended" || record.kind === "error"
      ? record.kind
      : "extended";
  const status =
    record.status === "draft" || record.status === "active" || record.status === "deprecated"
      ? record.status
      : "active";
  return {
    id: record.id,
    kind,
    title: record.title,
    summary: typeof record.summary === "string" ? record.summary : "",
    body: record.body,
    tags: stringArray(record.tags),
    ...(Array.isArray(record.uses) ? { uses: stringArray(record.uses) } : {}),
    origin: typeof record.origin === "string" ? record.origin : "runtime",
    namespace: typeof record.namespace === "string" ? record.namespace : "local",
    ...(typeof record.domain === "string" ? { domain: record.domain } : {}),
    aliases: stringArray(record.aliases),
    status,
    confidence: typeof record.confidence === "number" ? record.confidence : 0.8,
    version: typeof record.version === "number" ? record.version : 1,
    ...(Array.isArray(record.supersedes) ? { supersedes: stringArray(record.supersedes) } : {}),
    ...(typeof record.supersededBy === "string" ? { supersededBy: record.supersededBy } : {}),
    ...(Array.isArray(record.contradicts) ? { contradicts: stringArray(record.contradicts) } : {}),
    ...(typeof record.validFrom === "number" ? { validFrom: record.validFrom } : {}),
    ...(typeof record.validUntil === "number" ? { validUntil: record.validUntil } : {}),
    ...(typeof record.reviewedBy === "string" ? { reviewedBy: record.reviewedBy } : {}),
    ...(typeof record.reviewedAt === "number" ? { reviewedAt: record.reviewedAt } : {}),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    hits: typeof record.hits === "number" ? record.hits : 0,
    lastHitAt: typeof record.lastHitAt === "number" ? record.lastHitAt : 0,
    hot: typeof record.hot === "boolean" ? record.hot : true
  };
}

/** Atomic rewrite of a JSONL knowledge library. */
export function writeKnowledgeLibrary(filePath: string, units: KnowledgeUnit[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  const body = units.map((unit) => JSON.stringify(unit)).join("\n");
  writeFileSync(temp, body.length > 0 ? `${body}\n` : "", "utf8");
  try {
    renameSync(temp, filePath);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // best effort
    }
    throw error;
  }
}

export function readKnowledgeLibrary(filePath: string): KnowledgeUnit[] {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const units: KnowledgeUnit[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const unit = hydrateUnit(JSON.parse(line) as unknown);
      if (unit) units.push(unit);
    } catch {
      // A corrupt line is skipped; the rest of the library still loads.
    }
  }
  return units;
}
