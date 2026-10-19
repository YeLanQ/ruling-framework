// OPC (one-person company) reference pack.

import manifestJson from "./manifests/opc.json" with { type: "json" };

import { ActionCatalog } from "../core/catalog.js";
import type { EngineSurface } from "../core/engine.js";
import type { KnowledgeStore } from "../core/knowledge/store.js";
import { KnowledgeStore as Store } from "../core/knowledge/store.js";
import { ZoneRegistry } from "../core/zones.js";
import { readHandlers, writeHandlers } from "./common-handlers.js";
import { blockedByRedLine, createExecutor, type ActionHandler } from "./executor.js";
import { knowledgeHandlers } from "./knowledge-handlers.js";
import type { PackDefinition, PackManifest } from "./types.js";
import { coerceManifest } from "./types.js";

const manifest = coerceManifest(manifestJson) satisfies PackManifest;

function handlers(knowledge: KnowledgeStore): Record<string, ActionHandler> {
  return {
    ...readHandlers(),
    ...writeHandlers(),
    ...knowledgeHandlers(knowledge),
    "project.publish": blockedByRedLine("project.publish"),
    "payment.execute": blockedByRedLine("payment.execute"),
    "workspace.delete": blockedByRedLine("workspace.delete")
  };
}

function createSurface(): EngineSurface {
  const knowledge = new Store(manifest.knowledge);
  return {
    id: manifest.id,
    name: manifest.name,
    catalog: new ActionCatalog(manifest.actions),
    executor: createExecutor(handlers(knowledge)),
    zones: new ZoneRegistry(),
    grants: manifest.grants,
    defaultRole: manifest.defaultRole,
    approval: manifest.approval,
    knowledge
  };
}

export function createOpcPack(): PackDefinition {
  return { manifest, createSurface };
}
