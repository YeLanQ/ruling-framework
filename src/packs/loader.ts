// Pack registry and validation. A pack must declare a closed action set, a
// role table, grants that reference known groups, and a handler for every
// action it registers.

import { RulingEngine, type EngineOptions } from "../core/engine.js";
import { Workspace } from "../core/workspace.js";
import { createIndustrialPack } from "./industrial.js";
import { createOpcPack } from "./opc.js";
import { createSmbPack } from "./smb.js";
import type { PackDefinition } from "./types.js";

const FACTORIES: Record<string, () => PackDefinition> = {
  opc: createOpcPack,
  smb: createSmbPack,
  "industrial-design": createIndustrialPack
};

export function packIds(): string[] {
  return Object.keys(FACTORIES);
}

export function getPack(id: string): PackDefinition {
  const factory = FACTORIES[id];
  if (!factory) {
    throw new Error(`未知行业包：${id}（可用：${packIds().join(", ")}）`);
  }
  return factory();
}

export interface PackSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  roles: string[];
  defaultRole: string;
  actionCount: number;
  groups: string[];
}

export function listPacks(): PackSummary[] {
  return packIds().map((id) => {
    const pack = getPack(id);
    const surface = pack.createSurface();
    return {
      id: pack.manifest.id,
      name: pack.manifest.name,
      version: pack.manifest.version,
      description: pack.manifest.description,
      roles: pack.manifest.roles,
      defaultRole: pack.manifest.defaultRole,
      actionCount: pack.manifest.actions.length,
      groups: surface.catalog.groups()
    };
  });
}

export function validatePack(pack: PackDefinition): string[] {
  const errors: string[] = [];
  const manifest = pack.manifest;
  const surface = pack.createSurface();
  const roles = new Set(manifest.roles);
  const groups = new Set(surface.catalog.groups());
  const actionIds = new Set(manifest.actions.map((action) => action.id));

  if (!manifest.id) errors.push("缺少 pack id");
  if (manifest.roles.length === 0) errors.push("roles 不能为空");
  if (!roles.has(manifest.defaultRole)) errors.push("defaultRole 不在 roles 内");

  for (const [role, grants] of Object.entries(manifest.grants)) {
    if (!roles.has(role)) errors.push(`grants 含未知角色 ${role}`);
    for (const grant of grants) {
      if (grant === "*") continue;
      if (!groups.has(grant) && !actionIds.has(grant)) {
        errors.push(`角色 ${role} 授权了未知能力组/动作 ${grant}`);
      }
    }
  }
  for (const role of manifest.roles) {
    if (!(role in manifest.grants)) errors.push(`角色 ${role} 没有 grants 条目`);
  }

  for (const role of [...manifest.approval.defaultRoles, ...Object.values(manifest.approval.byGroup ?? {}).flat()]) {
    if (!roles.has(role)) errors.push(`审批策略含未知角色 ${role}`);
  }

  const seen = new Set<string>();
  for (const action of manifest.actions) {
    if (seen.has(action.id)) errors.push(`动作 id 重复：${action.id}`);
    seen.add(action.id);
    if (!["green", "yellow", "red"].includes(action.zone)) {
      errors.push(`动作 ${action.id} 的区域非法：${action.zone}`);
    }
    if (!action.group) errors.push(`动作 ${action.id} 缺少能力组`);
    if (!Number.isFinite(action.speedBudgetMs) || action.speedBudgetMs <= 0) {
      errors.push(`动作 ${action.id} 缺少有效速度预算`);
    }
    if (!Number.isFinite(action.energyWeight) || action.energyWeight <= 0) {
      errors.push(`动作 ${action.id} 缺少有效能耗权重`);
    }
    if (typeof action.keywords !== "object") errors.push(`动作 ${action.id} 缺少 keywords`);
    if (surface.executor.handles && !surface.executor.handles(action.id)) {
      errors.push(`动作 ${action.id} 没有执行器实现`);
    }
  }

  for (const lock of manifest.formatLocks) {
    if (lock.extensions.length === 0) errors.push(`格式锁 ${lock.channel} 没有扩展名`);
  }

  return errors;
}

export function createEngineForPack(
  id: string,
  options: EngineOptions
): { pack: PackDefinition; engine: RulingEngine } {
  const pack = getPack(id);
  const errors = validatePack(pack);
  if (errors.length > 0) {
    throw new Error(`行业包 ${id} 校验失败：${errors.join("；")}`);
  }
  const workspace =
    options.workspace instanceof Workspace
      ? options.workspace
      : {
          ...options.workspace,
          formatLocks: [...pack.manifest.formatLocks, ...(options.workspace.formatLocks ?? [])]
        };
  const engine = new RulingEngine(pack.createSurface(), { ...options, workspace });
  return { pack, engine };
}
