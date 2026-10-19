import { join, resolve } from "node:path";

import { AuditLog } from "../core/audit.js";
import {
  configPath,
  loadConfig,
  workspaceRoot,
  type RulingConfig
} from "../core/config.js";
import type { RulingEngine } from "../core/engine.js";
import type { TrustMode } from "../core/types.js";
import { createEngineForPack } from "../packs/loader.js";
import type { PackDefinition } from "../packs/types.js";

export interface CliIO {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm?: (message: string) => Promise<boolean>;
}

export interface CliContext {
  config: RulingConfig;
  pack: PackDefinition;
  engine: RulingEngine;
  role: string;
  trust: TrustMode;
  stateFile: string;
  configFile: string;
  cwd: string;
}

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export async function loadCliContext(
  cwd: string,
  flags: Record<string, string | boolean>
): Promise<CliContext> {
  const config = loadConfig(cwd);
  const packId = flagString(flags, "pack") ?? config.pack;
  const role = flagString(flags, "role") ?? config.role;
  const trust = (flagString(flags, "trust") as TrustMode | undefined) ?? config.trust;
  const stateFile = resolve(cwd, ".ruling", "state.json.gz");
  const auditFile = resolve(cwd, config.audit?.file ?? ".ruling/audit.jsonl");
  const audit = new AuditLog({ filePath: auditFile, ringSize: config.audit?.ringSize ?? 50 });
  const knowledge = config.knowledge ?? {};
  const knowledgeDir = resolve(cwd, knowledge.dir ?? ".ruling/knowledge");
  const knowledgePaths = {
    dir: knowledgeDir,
    seedFile: knowledge.seedFile
      ? resolve(cwd, knowledge.seedFile)
      : join(knowledgeDir, "seed.json"),
    synonymsFile: knowledge.synonymsFile
      ? resolve(cwd, knowledge.synonymsFile)
      : join(knowledgeDir, "synonyms.json"),
    experienceFile: knowledge.experienceFile
      ? resolve(cwd, knowledge.experienceFile)
      : join(knowledgeDir, "experience.jsonl"),
    errorsFile: knowledge.errorsFile
      ? resolve(cwd, knowledge.errorsFile)
      : join(knowledgeDir, "errors.jsonl")
  };
  const { pack, engine } = createEngineForPack(packId, {
    workspace: {
      root: workspaceRoot(cwd, config)
    },
    audit,
    knowledgePaths
  });
  if (config.approvalTtlMs) engine.surface.approval.ttlMs = config.approvalTtlMs;
  engine.restore(stateFile);
  await engine.loadExternalKnowledge(knowledge.external ?? []);
  return {
    config,
    pack,
    engine,
    role,
    trust,
    stateFile,
    configFile: configPath(cwd),
    cwd
  };
}

export function persist(context: CliContext): void {
  context.engine.save(context.stateFile);
}

export function printJson(io: CliIO, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}
