// External knowledge source contracts.

import type { KnowledgeInput, KnowledgeKind } from "./store.js";

export type ExternalSourceType = "json" | "jsonl" | "markdown" | "http";

export interface ExternalKnowledgeConfig {
  id: string;
  type: ExternalSourceType;
  kind?: KnowledgeKind;
  /** File path for json/jsonl. Relative paths resolve against the workspace. */
  path?: string;
  /** Directory for markdown. */
  dir?: string;
  /** URL for http. */
  url?: string;
  tags?: string[];
  namespace?: string;
  domain?: string;
  aliases?: string[];
  confidence?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  enabled?: boolean;
  /** Defaults to `ext:<id>:`. */
  prefix?: string;
}

export interface KnowledgeSource {
  id: string;
  kind: KnowledgeKind;
  load(): Promise<KnowledgeInput[]>;
}

export interface ExternalSourceReport {
  loaded: number;
  bySource: Record<string, number>;
  errors: string[];
}
