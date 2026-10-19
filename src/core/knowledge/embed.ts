// Deterministic character n-gram embedding. No embedding model, no network,
// no version migration: the same text always yields the same vector.

export const EMBED_DIM = 128;

export interface QuantVec {
  data: Int8Array;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix(hash: number): number {
  let value = hash >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function features(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const word of lower.match(/[a-z0-9_]+/g) ?? []) out.push(`w:${word}`);
  const cjk = lower.match(/[\u3400-\u9fff]/g) ?? [];
  for (let index = 0; index < cjk.length; index += 1) {
    out.push(`c:${cjk[index]}`);
    if (index + 1 < cjk.length) out.push(`b:${cjk[index]}${cjk[index + 1]}`);
  }
  return out;
}

export function embedFloat(text: string): Float32Array {
  const vector = new Float32Array(EMBED_DIM);
  for (const feature of features(text)) {
    const hash = mix(fnv1a(feature));
    const bucket = hash % EMBED_DIM;
    const sign = (hash & 0x80000000) !== 0 ? -1 : 1;
    const current = vector[bucket] ?? 0;
    vector[bucket] = current + sign;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = (vector[index] ?? 0) / norm;
    }
  }
  return vector;
}

export function embed(text: string): QuantVec {
  const source = embedFloat(text);
  const data = new Int8Array(EMBED_DIM);
  for (let index = 0; index < EMBED_DIM; index += 1) {
    data[index] = Math.max(-127, Math.min(127, Math.round((source[index] ?? 0) * 127)));
  }
  return { data };
}

export function cosine(a: QuantVec, b: QuantVec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < EMBED_DIM; index += 1) {
    const av = a.data[index] ?? 0;
    const bv = b.data[index] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
