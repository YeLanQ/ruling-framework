// Industrial-design reference pack. The state store is a JSON reference
// adapter; a real deployment swaps it for CAD/PLM calls while keeping the
// same action surface, zones, and provenance contract.

import manifestJson from "./manifests/industrial-design.json" with { type: "json" };

import { ActionCatalog } from "../core/catalog.js";
import type { EngineSurface } from "../core/engine.js";
import { KnowledgeStore } from "../core/knowledge/store.js";
import type { WorkspaceApi } from "../core/types.js";
import { ZoneRegistry } from "../core/zones.js";
import {
  assertDesignId,
  designPath,
  loadDesign,
  newDesign,
  recordChange,
  saveDesign,
  type DesignItem
} from "./design-store.js";
import { blockedByRedLine, createExecutor, optionalString, stringParam, type ActionHandler } from "./executor.js";
import { knowledgeHandlers } from "./knowledge-handlers.js";
import type { PackDefinition, PackManifest } from "./types.js";

const manifest = manifestJson as unknown as PackManifest;

const SAFETY_NAMES = new Set(["wallThickness", "safetyFactor", "materialGrade", "loadRating"]);

function clone(item: DesignItem): DesignItem {
  return JSON.parse(JSON.stringify(item)) as DesignItem;
}

function designId(ctx: { params: Record<string, unknown> }): string {
  const id = stringParam(ctx, "id");
  assertDesignId(id);
  return id;
}

function handlers(knowledge: KnowledgeStore): Record<string, ActionHandler> {
  return {
    "design.list": async (ctx) => {
      try {
        return { result: await ctx.workspace.list("designs") };
      } catch {
        return { result: [] };
      }
    },
    "design.read": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      return { result: item, files: [designPath(item.id)] };
    },
    "dfm.check": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const advisories: string[] = [];
      if (Object.keys(item.params).length === 0) advisories.push("设计尚未设置参数");
      if (item.bom.length === 0) advisories.push("BOM 为空");
      if (Object.values(item.params).some((param) => param.safetyCritical)) {
        advisories.push("存在安全关键参数，发布前必须人工签核");
      }
      return {
        result: {
          id: item.id,
          revision: item.revision,
          advisories,
          authority: "advisory-only"
        }
      };
    },
    "design.create": async (ctx) => {
      const id = designId(ctx);
      const item = newDesign(id, stringParam(ctx, "name"));
      await saveDesign(ctx.workspace, item);
      return { result: { created: id, revision: item.revision }, files: [designPath(id)] };
    },
    "design.create_revision": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const before = clone(item);
      item.revision += 1;
      item.status = "draft";
      await recordChange(ctx, item, before, "design.create_revision", optionalString(ctx, "note"));
      return { result: { id: item.id, revision: item.revision }, files: [designPath(item.id)] };
    },
    "design.set_param": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const before = clone(item);
      const name = stringParam(ctx, "name");
      item.params[name] = {
        value: ctx.params.value,
        safetyCritical: ctx.params.safetyCritical === true
      };
      await recordChange(ctx, item, before, "design.set_param", `param:${name}`);
      return { result: { id: item.id, param: name }, files: [designPath(item.id)] };
    },
    "design.attach_asset": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const before = clone(item);
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"));
      if (!item.files.includes(path)) item.files.push(path);
      await recordChange(ctx, item, before, "design.attach_asset", `asset:${path}`);
      return { result: { id: item.id, attached: path }, files: [designPath(item.id), path] };
    },
    "bom.update": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const before = clone(item);
      const rows = ctx.params.rows;
      if (!Array.isArray(rows)) throw new Error("参数 rows 必须是数组");
      item.bom = rows.filter((row): row is string => typeof row === "string");
      await recordChange(ctx, item, before, "bom.update", "bom");
      return { result: { id: item.id, rows: item.bom.length }, files: [designPath(item.id)] };
    },
    "cad.import": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const before = clone(item);
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"), { channel: "cad.import" });
      if (!item.files.includes(path)) item.files.push(path);
      await recordChange(ctx, item, before, "cad.import", `cad:${path}`);
      return { result: { id: item.id, imported: path }, files: [designPath(item.id), path] };
    },
    "report.export": async (ctx) => {
      const item = await loadDesign(ctx.workspace, designId(ctx));
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"), { channel: "report.export" });
      return {
        result: { id: item.id, exported: path, revision: item.revision },
        files: [path]
      };
    },
    ...knowledgeHandlers(knowledge),
    "design.release": blockedByRedLine("design.release"),
    "safety.signoff": blockedByRedLine("safety.signoff")
  };
}

async function safetyParamZone(params: Record<string, unknown>, workspace: WorkspaceApi): Promise<"red" | "yellow"> {
  const name = typeof params.name === "string" ? params.name : "";
  if (params.safetyCritical === true || SAFETY_NAMES.has(name)) return "red";
  const id = typeof params.id === "string" ? params.id : "";
  try {
    assertDesignId(id);
    const item = await loadDesign(workspace, id);
    if (item.params[name]?.safetyCritical) return "red";
  } catch {
    // No existing design item: fall back to the name/flag checks.
  }
  return "yellow";
}

function createSurface(): EngineSurface {
  const knowledge = new KnowledgeStore(manifest.knowledge);
  const zones = new ZoneRegistry();
  zones.register("safetyParam", ({ params, workspace }) => safetyParamZone(params, workspace));
  return {
    id: manifest.id,
    name: manifest.name,
    catalog: new ActionCatalog(manifest.actions),
    executor: createExecutor(handlers(knowledge)),
    zones,
    grants: manifest.grants,
    defaultRole: manifest.defaultRole,
    approval: manifest.approval,
    knowledge
  };
}

export function createIndustrialPack(): PackDefinition {
  return { manifest, createSurface };
}
