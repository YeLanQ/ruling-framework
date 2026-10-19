// A pack is data (manifest) plus one executor. The framework core never
// imports a pack; the CLI resolves a pack id to a definition.

import type { EngineSurface } from "../core/engine.js";
import type { ActionSpec, ApprovalPolicy, FormatLock } from "../core/types.js";
import type { KnowledgeInput } from "../core/knowledge/store.js";

export interface PackManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  roles: string[];
  defaultRole: string;
  approval: ApprovalPolicy;
  /** role -> granted groups or action ids; "*" grants everything. */
  grants: Record<string, string[]>;
  formatLocks: FormatLock[];
  actions: ActionSpec[];
  knowledge: KnowledgeInput[];
}

export interface PackDefinition {
  manifest: PackManifest;
  createSurface(): EngineSurface;
}

const MANIFEST_REQUIRED: Array<[string, (value: unknown) => boolean]> = [
  ["id", (value) => typeof value === "string"],
  ["name", (value) => typeof value === "string"],
  ["version", (value) => typeof value === "string"],
  ["description", (value) => typeof value === "string"],
  ["roles", (value) => Array.isArray(value)],
  ["defaultRole", (value) => typeof value === "string"],
  ["approval", (value) => typeof value === "object" && value !== null],
  ["grants", (value) => typeof value === "object" && value !== null],
  ["formatLocks", (value) => Array.isArray(value)],
  ["actions", (value) => Array.isArray(value)],
  ["knowledge", (value) => Array.isArray(value)]
];

function isPackManifest(source: unknown): source is PackManifest {
  if (typeof source !== "object" || source === null) return false;
  const record = source as Record<string, unknown>;
  return MANIFEST_REQUIRED.every(([key, check]) => {
    const value = record[key];
    return value !== undefined && value !== null && check(value);
  });
}

/**
 * Structural narrowing for manifest JSON. JSON imports widen string literals
 * to `string`, so the union-typed fields (zone, kind) cannot be checked by
 * `satisfies`; this function narrows the shape while keeping a typed surface.
 * Deep validation (grants, approvals, schemas, handlers) lives in validatePack.
 */
export function coerceManifest(raw: unknown): PackManifest {
  if (!isPackManifest(raw)) {
    throw new Error("pack manifest 结构非法：缺少必需字段或字段类型错误");
  }
  return raw;
}
