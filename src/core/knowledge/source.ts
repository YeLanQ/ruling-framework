// External knowledge source registry and loader. Sources are read-only inputs;
// they are never copied into local persistence.

import { HttpJsonSource } from "./source-http.js";
import { JsonSource, JsonlSource, MarkdownSource } from "./source-file.js";
import type { KnowledgeInput } from "./store.js";
import type {
  ExternalKnowledgeConfig,
  ExternalSourceReport,
  KnowledgeSource
} from "./source-types.js";

export * from "./source-types.js";

export function createKnowledgeSource(
  config: ExternalKnowledgeConfig,
  baseDir: string
): KnowledgeSource | undefined {
  if (config.enabled === false) return undefined;
  if (!config.id) throw new Error("外部知识源缺少 id");
  switch (config.type) {
    case "json":
      return new JsonSource(config, baseDir);
    case "jsonl":
      return new JsonlSource(config, baseDir);
    case "markdown":
      return new MarkdownSource(config, baseDir);
    case "http":
      return new HttpJsonSource(config);
    default:
      throw new Error(`外部知识源 ${config.id} 的 type 非法：${String(config.type)}`);
  }
}

export async function loadExternalSources(
  configs: ExternalKnowledgeConfig[],
  baseDir: string
): Promise<{ units: KnowledgeInput[]; report: ExternalSourceReport }> {
  const units: KnowledgeInput[] = [];
  const report: ExternalSourceReport = { loaded: 0, bySource: {}, errors: [] };
  for (const config of configs) {
    try {
      const source = createKnowledgeSource(config, baseDir);
      if (!source) continue;
      const loaded = await source.load();
      units.push(...loaded);
      report.bySource[config.id] = loaded.length;
      report.loaded += loaded.length;
    } catch (error) {
      report.errors.push(
        `${config.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { units, report };
}
