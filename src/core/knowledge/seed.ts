// Optional workspace seed overlay. This lets a deployment add company rules to
// the pack's built-in seed library without editing code. Entries are forced to
// kind "seed" and never persisted into experience/errors libraries.

import { existsSync, readFileSync } from "node:fs";

import type { KnowledgeInput } from "./store.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function status(value: unknown): "draft" | "active" | "deprecated" {
  return value === "draft" || value === "active" || value === "deprecated" ? value : "active";
}

export function parseSeedPayload(payload: unknown): KnowledgeInput[] {
  const list = Array.isArray(payload)
    ? payload
    : asRecord(payload)?.units && Array.isArray((asRecord(payload) as { units: unknown[] }).units)
      ? ((asRecord(payload) as { units: unknown[] }).units)
      : [payload];
  const units: KnowledgeInput[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const body =
      typeof record.body === "string"
        ? record.body
        : typeof record.content === "string"
          ? record.content
          : "";
    if (!body) continue;
    units.push({
      id:
        typeof record.id === "string" && record.id
          ? record.id
          : `seed:local:${units.length}`,
      kind: "seed",
      title:
        typeof record.title === "string" && record.title
          ? record.title
          : `本地种子 ${units.length}`,
      summary:
        typeof record.summary === "string" ? record.summary : body.slice(0, 120),
      body,
      tags: ["local-seed", ...stringArray(record.tags)],
      uses: stringArray(record.uses),
      origin: "workspace",
      namespace: typeof record.namespace === "string" ? record.namespace : "local",
      ...(typeof record.domain === "string" ? { domain: record.domain } : {}),
      aliases: stringArray(record.aliases),
      status: status(record.status),
      confidence: typeof record.confidence === "number" ? record.confidence : 1,
      version: typeof record.version === "number" ? record.version : 1,
      ...(Array.isArray(record.supersedes) ? { supersedes: stringArray(record.supersedes) } : {}),
      ...(Array.isArray(record.contradicts) ? { contradicts: stringArray(record.contradicts) } : {})
    });
  }
  return units;
}

export function loadSeedFile(filePath: string): KnowledgeInput[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, "utf8");
  try {
    return parseSeedPayload(JSON.parse(text) as unknown);
  } catch {
    throw new Error(`本地种子文件格式错误：${filePath}`);
  }
}
