// File-based external knowledge: JSON, JSONL, Markdown directory.

import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, posix, resolve } from "node:path";

import type { KnowledgeInput, KnowledgeKind } from "./store.js";
import type { ExternalKnowledgeConfig, KnowledgeSource } from "./source-types.js";
import { MAX_SOURCE_BYTES, normalizeUnit, payloadUnits } from "./source-normalize.js";

export class JsonSource implements KnowledgeSource {
  readonly kind: KnowledgeKind;
  private readonly prefix: string;

  constructor(
    private readonly config: ExternalKnowledgeConfig,
    private readonly baseDir: string
  ) {
    this.kind = config.kind ?? "extended";
    this.prefix = config.prefix ?? `ext:${config.id}:`;
  }

  get id(): string {
    return this.config.id;
  }

  async load(): Promise<KnowledgeInput[]> {
    if (!this.config.path) throw new Error(`外部知识源 ${this.id} 缺少 path`);
    const text = await readFile(resolve(this.baseDir, this.config.path), "utf8");
    if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) {
      throw new Error(`外部知识源 ${this.id} 超过 2MB 上限`);
    }
    return payloadUnits(JSON.parse(text) as unknown)
      .map((raw, index) => normalizeUnit(raw, this.config, `${this.prefix}json-${index}`))
      .filter((unit): unit is KnowledgeInput => unit !== undefined);
  }
}

export class JsonlSource implements KnowledgeSource {
  readonly kind: KnowledgeKind;
  private readonly prefix: string;

  constructor(
    private readonly config: ExternalKnowledgeConfig,
    private readonly baseDir: string
  ) {
    this.kind = config.kind ?? "extended";
    this.prefix = config.prefix ?? `ext:${config.id}:`;
  }

  get id(): string {
    return this.config.id;
  }

  async load(): Promise<KnowledgeInput[]> {
    if (!this.config.path) throw new Error(`外部知识源 ${this.id} 缺少 path`);
    const text = await readFile(resolve(this.baseDir, this.config.path), "utf8");
    if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) {
      throw new Error(`外部知识源 ${this.id} 超过 2MB 上限`);
    }
    const units: KnowledgeInput[] = [];
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        const unit = normalizeUnit(
          JSON.parse(line) as unknown,
          this.config,
          `${this.prefix}line-${index + 1}`
        );
        if (unit) units.push(unit);
      } catch {
        // Skip a corrupt line; the rest of the source still loads.
      }
    }
    return units;
  }
}

export class MarkdownSource implements KnowledgeSource {
  readonly kind: KnowledgeKind;
  private readonly prefix: string;

  constructor(
    private readonly config: ExternalKnowledgeConfig,
    private readonly baseDir: string
  ) {
    this.kind = config.kind ?? "extended";
    this.prefix = config.prefix ?? `ext:${config.id}:`;
  }

  get id(): string {
    return this.config.id;
  }

  async load(): Promise<KnowledgeInput[]> {
    if (!this.config.dir) throw new Error(`外部知识源 ${this.id} 缺少 dir`);
    const base = resolve(this.baseDir, this.config.dir);
    const files = await this.collect(base);
    const units: KnowledgeInput[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) continue;
      const relative = posix
        .normalize(file.slice(base.length + 1).replace(/\\/g, "/"))
        .replace(/\.[^.]+$/, "")
        .replace(/\//g, ":");
      const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
      const paragraphs = text
        .split(/\r?\n\r?\n/)
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith("#"));
      const summary = paragraphs[0]?.slice(0, 200) ?? "";
      const unit = normalizeUnit(
        {
          id: relative || basename(file, extname(file)),
          title: heading ?? basename(file, extname(file)),
          summary,
          body: text,
          tags: ["markdown"]
        },
        this.config,
        `${this.prefix}${relative}`
      );
      if (unit) units.push(unit);
    }
    return units;
  }

  private async collect(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await this.collect(full)));
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") files.push(full);
    }
    return files.sort();
  }
}
