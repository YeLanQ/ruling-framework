// Reference industrial-design state stored as JSON in the workspace. Real
// deployments replace this module with CAD/PLM adapters; the adjudication
// surface above it stays the same.

import { createHash } from "node:crypto";

import type { ExecContext, WorkspaceApi } from "../core/types.js";

export interface DesignParam {
  value: unknown;
  safetyCritical: boolean;
}

export interface ProvenanceEntry {
  ts: number;
  action: string;
  actorRole: string;
  revision: number;
  beforeHash: string;
  afterHash: string;
  note?: string;
}

export interface DesignItem {
  id: string;
  name: string;
  revision: number;
  status: "draft" | "review" | "approved" | "released";
  params: Record<string, DesignParam>;
  bom: string[];
  files: string[];
  provenance: ProvenanceEntry[];
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function assertDesignId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new Error("设计对象 id 只允许字母、数字、下划线与连字符，长度 1~64");
  }
}

export function designPath(id: string): string {
  assertDesignId(id);
  return `designs/${id}.json`;
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export async function loadDesign(ws: WorkspaceApi, id: string): Promise<DesignItem> {
  const text = await ws.read(designPath(id));
  return JSON.parse(text) as DesignItem;
}

export async function saveDesign(ws: WorkspaceApi, item: DesignItem): Promise<void> {
  await ws.write(designPath(item.id), `${JSON.stringify(item, null, 2)}\n`);
}

export function newDesign(id: string, name: string): DesignItem {
  return {
    id,
    name,
    revision: 1,
    status: "draft",
    params: {},
    bom: [],
    files: [],
    provenance: [
      {
        ts: Date.now(),
        action: "design.create",
        actorRole: "designer",
        revision: 1,
        beforeHash: "",
        afterHash: hashJson({ id, name, revision: 1 }),
        note: "created"
      }
    ]
  };
}

export async function recordChange(
  ctx: ExecContext,
  item: DesignItem,
  before: DesignItem,
  action: string,
  note?: string
): Promise<void> {
  item.provenance.push({
    ts: Date.now(),
    action,
    actorRole: ctx.actor.role ?? "unknown",
    revision: item.revision,
    beforeHash: hashJson(before),
    afterHash: hashJson(item),
    ...(note ? { note } : {})
  });
  await saveDesign(ctx.workspace, item);
}
