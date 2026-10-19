// Deterministic semantic helpers. This is semantic management without a neural
// model: normalization, synonym expansion, alias/tag boosts, status and
// confidence weighting. It does not change the adjudication path.

export type KnowledgeStatus = "draft" | "active" | "deprecated";

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function queryTerms(query: string): Set<string> {
  const normalized = normalizeText(query);
  return new Set(normalized.split(" ").filter(Boolean));
}

/** Expand a query with synonym groups when any group term appears in it. */
export function expandTerms(query: string, synonymGroups: string[][]): Set<string> {
  const expanded = queryTerms(query);
  const normalizedQuery = normalizeText(query);
  for (const group of synonymGroups) {
    const normalizedGroup = group.map(normalizeText).filter(Boolean);
    if (normalizedGroup.some((term) => normalizedQuery.includes(term))) {
      for (const term of normalizedGroup) expanded.add(term);
    }
  }
  return expanded;
}

export function aliasScore(query: string, aliases: string[], expanded: Set<string>): number {
  if (aliases.length === 0) return 0;
  const normalizedQuery = normalizeText(query);
  let score = 0;
  for (const alias of aliases) {
    const normalized = normalizeText(alias);
    if (!normalized) continue;
    if (normalizedQuery.includes(normalized) || expanded.has(normalized)) score += 0.15;
  }
  return Math.min(0.6, score);
}

export function metadataScore(
  domain: string | undefined,
  tags: string[],
  expanded: Set<string>
): number {
  let score = 0;
  if (domain) {
    const normalized = normalizeText(domain);
    if (normalized && expanded.has(normalized)) score += 0.1;
  }
  for (const tag of tags) {
    const normalized = normalizeText(tag);
    if (normalized && expanded.has(normalized)) score += 0.05;
  }
  return Math.min(0.3, score);
}

export function statusWeight(status: KnowledgeStatus): number {
  if (status === "active") return 1;
  if (status === "draft") return 0.85;
  return 0.5;
}

export function confidenceWeight(confidence: number): number {
  const clamped = Math.max(0, Math.min(1, confidence));
  return 0.5 + 0.5 * clamped;
}

export function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  return value === "draft" || value === "active" || value === "deprecated";
}
