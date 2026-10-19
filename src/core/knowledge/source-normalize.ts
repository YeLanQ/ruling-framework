// Shared normalization for external knowledge payloads.

import type { KnowledgeInput } from "./store.js";
import type { ExternalKnowledgeConfig } from "./source-types.js";
import type { KnowledgeStatus } from "./semantic.js";

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function status(value: unknown): KnowledgeStatus {
  return value === "draft" || value === "active" || value === "deprecated" ? value : "active";
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeUnit(
  raw: unknown,
  config: ExternalKnowledgeConfig,
  fallbackId: string
): KnowledgeInput | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const prefix = config.prefix ?? `ext:${config.id}:`;
  const rawId = typeof record.id === "string" && record.id ? record.id : fallbackId;
  const id = rawId.startsWith(prefix) ? rawId : `${prefix}${rawId}`;
  const rawKind =
    record.kind === "seed" || record.kind === "extended" || record.kind === "error"
      ? record.kind
      : undefined;
  const kind = config.kind ?? rawKind ?? "extended";
  const body =
    typeof record.body === "string"
      ? record.body
      : typeof record.content === "string"
        ? record.content
        : "";
  const title =
    typeof record.title === "string" && record.title
      ? record.title
      : typeof record.name === "string" && record.name
        ? record.name
        : id;
  const summary =
    typeof record.summary === "string" && record.summary
      ? record.summary
      : body.slice(0, 120);
  if (!body && !summary) return undefined;
  const domain =
    config.domain ?? (typeof record.domain === "string" ? record.domain : undefined);
  return {
    id,
    kind,
    title,
    summary,
    body: body || summary,
    tags: [...new Set([...(config.tags ?? []), ...stringArray(record.tags)])],
    uses: stringArray(record.uses),
    origin: `external:${config.id}`,
    namespace:
      config.namespace ??
      (typeof record.namespace === "string" ? record.namespace : "external"),
    ...(domain ? { domain } : {}),
    aliases: [...new Set([...(config.aliases ?? []), ...stringArray(record.aliases)])],
    status: status(record.status),
    confidence:
      config.confidence ??
      (typeof record.confidence === "number" ? record.confidence : 0.8),
    version: typeof record.version === "number" ? record.version : 1,
    ...(Array.isArray(record.supersedes) ? { supersedes: stringArray(record.supersedes) } : {}),
    ...(Array.isArray(record.contradicts) ? { contradicts: stringArray(record.contradicts) } : {}),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now()
  };
}

export function payloadUnits(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (record && Array.isArray(record.units)) return record.units;
  return [payload];
}
