// Synonym groups for deterministic query expansion. Format:
//   ["交付", "交付物", "deliverable"]
// or
//   { "交付": ["交付物", "deliverable"], "安全": ["safety", "合规"] }

import { existsSync, readFileSync } from "node:fs";

export function parseSynonymsPayload(payload: unknown): string[][] {
  if (Array.isArray(payload)) {
    if (payload.every((item) => Array.isArray(item))) {
      return payload
        .map((group) => (group as unknown[]).filter((item): item is string => typeof item === "string"))
        .filter((group) => group.length > 0);
    }
    const flat = payload.filter((item): item is string => typeof item === "string");
    return flat.length > 0 ? [flat] : [];
  }
  if (payload && typeof payload === "object") {
    const groups: string[][] = [];
    for (const [canonical, aliases] of Object.entries(payload as Record<string, unknown>)) {
      const group = [canonical, ...(Array.isArray(aliases) ? aliases : [])].filter(
        (item): item is string => typeof item === "string"
      );
      if (group.length > 0) groups.push(group);
    }
    return groups;
  }
  return [];
}

export function loadSynonymsFile(filePath: string): string[][] {
  if (!existsSync(filePath)) return [];
  try {
    return parseSynonymsPayload(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch {
    throw new Error(`同义词文件格式错误：${filePath}`);
  }
}
