// HTTP JSON external knowledge source. GET only; the URL is local config,
// never model output.

import type { KnowledgeInput, KnowledgeKind } from "./store.js";
import type { ExternalKnowledgeConfig, KnowledgeSource } from "./source-types.js";
import { MAX_SOURCE_BYTES, normalizeUnit, payloadUnits } from "./source-normalize.js";

export class HttpJsonSource implements KnowledgeSource {
  readonly kind: KnowledgeKind;
  private readonly prefix: string;

  constructor(private readonly config: ExternalKnowledgeConfig) {
    this.kind = config.kind ?? "extended";
    this.prefix = config.prefix ?? `ext:${config.id}:`;
  }

  get id(): string {
    return this.config.id;
  }

  async load(): Promise<KnowledgeInput[]> {
    if (!this.config.url) throw new Error(`外部知识源 ${this.id} 缺少 url`);
    const response = await fetch(this.config.url, {
      headers: this.config.headers,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000)
    });
    if (!response.ok) {
      throw new Error(`外部知识源 ${this.id} 返回 ${response.status}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) {
      throw new Error(`外部知识源 ${this.id} 超过 2MB 上限`);
    }
    return payloadUnits(JSON.parse(text) as unknown)
      .map((raw, index) => normalizeUnit(raw, this.config, `${this.prefix}http-${index}`))
      .filter((unit): unit is KnowledgeInput => unit !== undefined);
  }
}
