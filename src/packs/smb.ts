// Small-business reference pack: role grants plus dual approval for release.

import manifestJson from "./manifests/smb.json" with { type: "json" };

import { ActionCatalog } from "../core/catalog.js";
import type { EngineSurface } from "../core/engine.js";
import { KnowledgeStore } from "../core/knowledge/store.js";
import { ZoneRegistry } from "../core/zones.js";
import { readHandlers, writeHandlers } from "./common-handlers.js";
import { blockedByRedLine, createExecutor, optionalString, stringParam, type ActionHandler } from "./executor.js";
import { knowledgeHandlers } from "./knowledge-handlers.js";
import type { PackDefinition, PackManifest } from "./types.js";
import { coerceManifest } from "./types.js";

const manifest = coerceManifest(manifestJson) satisfies PackManifest;

function handlers(knowledge: KnowledgeStore): Record<string, ActionHandler> {
  return {
    ...readHandlers(),
    ...writeHandlers(),
    ...knowledgeHandlers(knowledge),
    "team.invite": async (ctx) => {
      const email = stringParam(ctx, "email");
      const role = optionalString(ctx, "role") ?? "viewer";
      const key = email.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `team/invites/${key}.json`;
      await ctx.workspace.write(path, `${JSON.stringify({ email, role, invitedAt: Date.now() }, null, 2)}\n`);
      return { result: { invited: email, role }, files: [path] };
    },
    "review.request": async (ctx) => {
      const target = stringParam(ctx, "target");
      const path = `reviews/${target.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`;
      await ctx.workspace.write(
        path,
        `${JSON.stringify({ target, requestedAt: Date.now(), status: "pending" }, null, 2)}\n`
      );
      return { result: { requested: target }, files: [path] };
    },
    "release.prepare": async (ctx) => {
      const version = stringParam(ctx, "version");
      const path = `release/${version.replace(/[^A-Za-z0-9_.-]+/g, "_")}.json`;
      await ctx.workspace.write(
        path,
        `${JSON.stringify({ version, preparedAt: Date.now(), status: "approved-to-package" }, null, 2)}\n`
      );
      return { result: { version, prepared: path }, files: [path] };
    },
    "release.publish": blockedByRedLine("release.publish"),
    "role.grant": blockedByRedLine("role.grant"),
    "workspace.delete": blockedByRedLine("workspace.delete")
  };
}

function createSurface(): EngineSurface {
  const knowledge = new KnowledgeStore(manifest.knowledge);
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

export function createSmbPack(): PackDefinition {
  return { manifest, createSurface };
}
