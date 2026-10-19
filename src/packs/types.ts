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
