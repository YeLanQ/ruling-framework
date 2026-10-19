// Workspace-local configuration. API keys live in environment variables and
// are never written to .ruling/config.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { ExternalKnowledgeConfig } from "./knowledge/source.js";
import type { TrustMode } from "./types.js";

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  contextK: number;
}

export interface KnowledgeConfig {
  dir?: string;
  seedFile?: string;
  synonymsFile?: string;
  experienceFile?: string;
  errorsFile?: string;
  external?: ExternalKnowledgeConfig[];
}

export interface RulingConfig {
  pack: string;
  workspace: string;
  trust: TrustMode;
  role: string;
  approvalTtlMs?: number;
  provider?: ProviderConfig;
  knowledge?: KnowledgeConfig;
  audit?: { ringSize?: number; file?: string };
}

export const CONFIG_DIR = ".ruling";
export const CONFIG_FILE = "config.json";

export function configDir(cwd: string): string {
  return join(resolve(cwd), CONFIG_DIR);
}

export function configPath(cwd: string): string {
  return join(configDir(cwd), CONFIG_FILE);
}

export function defaultConfig(): RulingConfig {
  return {
    pack: "opc",
    workspace: ".",
    trust: "agent",
    role: "owner",
    provider: {
      baseUrl: process.env.RULING_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.RULING_MODEL ?? "gpt-4o-mini",
      apiKeyEnv: "RULING_API_KEY",
      contextK: 128
    },
    knowledge: {
      dir: join(CONFIG_DIR, "knowledge"),
      seedFile: join(CONFIG_DIR, "knowledge", "seed.json"),
      synonymsFile: join(CONFIG_DIR, "knowledge", "synonyms.json"),
      experienceFile: join(CONFIG_DIR, "knowledge", "experience.jsonl"),
      errorsFile: join(CONFIG_DIR, "knowledge", "errors.jsonl"),
      external: []
    },
    audit: { ringSize: 50, file: join(CONFIG_DIR, "audit.jsonl") }
  };
}

export function loadConfig(cwd: string): RulingConfig {
  const path = configPath(cwd);
  const defaults = defaultConfig();
  if (!existsSync(path)) return defaults;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RulingConfig>;
  if (!parsed.pack || typeof parsed.pack !== "string") {
    throw new Error(`配置缺少 pack：${path}`);
  }
  return {
    ...defaults,
    ...parsed,
    provider: { ...defaults.provider, ...(parsed.provider ?? {}) } as ProviderConfig,
    knowledge: {
      ...defaults.knowledge,
      ...(parsed.knowledge ?? {}),
      external: parsed.knowledge?.external ?? defaults.knowledge?.external ?? []
    },
    audit: { ...defaults.audit, ...(parsed.audit ?? {}) }
  };
}

export function saveConfig(cwd: string, config: RulingConfig): string {
  const path = configPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return path;
}

export function workspaceRoot(cwd: string, config: RulingConfig): string {
  return resolve(cwd, config.workspace || ".");
}
