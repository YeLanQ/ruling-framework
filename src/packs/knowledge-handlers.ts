// Shared knowledge actions for every pack. These are the only write paths into
// the three libraries; metadata, status, and merge rules live here.

import type {
  KnowledgeInput,
  KnowledgeStatus,
  KnowledgeStore
} from "../core/knowledge/store.js";
import { optionalString, stringParam, type ActionHandler } from "./executor.js";

/** Observation-owned id prefixes; the framework relies on them for causal chains. */
const RESERVED_PREFIXES = ["task:", "action:", "failure:", "outcome:"];

function assertNotReserved(id: string): void {
  const prefix = RESERVED_PREFIXES.find((candidate) => id.startsWith(candidate));
  if (prefix) {
    throw new Error(`id 使用保留前缀 ${prefix}：不能通过知识动作创建或覆盖观测单元`);
  }
}

function stringArrayParam(ctx: { params: Record<string, unknown> }, name: string): string[] {
  const value = ctx.params[name];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalNumber(
  ctx: { params: Record<string, unknown> },
  name: string
): number | undefined {
  const value = ctx.params[name];
  return typeof value === "number" ? value : undefined;
}

function optionalStatus(ctx: { params: Record<string, unknown> }): KnowledgeStatus | undefined {
  const value = ctx.params.status;
  return value === "draft" || value === "active" || value === "deprecated" ? value : undefined;
}

function inputFrom(ctx: { params: Record<string, unknown> }, kind: "extended" | "error"): KnowledgeInput {
  const confidence = optionalNumber(ctx, "confidence");
  return {
    id: stringParam(ctx, "id"),
    kind,
    title: stringParam(ctx, "title"),
    summary: optionalString(ctx, "summary"),
    body: stringParam(ctx, "body"),
    tags: stringArrayParam(ctx, "tags"),
    uses: stringArrayParam(ctx, "uses"),
    namespace: optionalString(ctx, "namespace"),
    domain: optionalString(ctx, "domain"),
    aliases: stringArrayParam(ctx, "aliases"),
    status: optionalStatus(ctx),
    confidence,
    supersedes: stringArrayParam(ctx, "supersedes"),
    contradicts: stringArrayParam(ctx, "contradicts")
  };
}

export function knowledgeHandlers(knowledge: KnowledgeStore): Record<string, ActionHandler> {
  return {
    "knowledge.add": async (ctx) => {
      assertNotReserved(stringParam(ctx, "id"));
      const unit = knowledge.add(inputFrom(ctx, "extended"));
      return { result: { added: unit.id, version: unit.version, namespace: unit.namespace } };
    },
    "lesson.add": async (ctx) => {
      assertNotReserved(stringParam(ctx, "id"));
      const unit = knowledge.add(inputFrom(ctx, "error"));
      return { result: { added: unit.id, version: unit.version, namespace: unit.namespace } };
    },
    "knowledge.review": async (ctx) => {
      const id = stringParam(ctx, "id");
      assertNotReserved(id);
      const confidence = optionalNumber(ctx, "confidence");
      const unit = knowledge.update(id, {
        status: "active",
        ...(confidence !== undefined ? { confidence } : {}),
        reviewedBy: ctx.actor.role ?? "unknown",
        reviewedAt: Date.now()
      });
      if (!unit) throw new Error(`知识单元不存在：${id}`);
      return { result: { reviewed: id, version: unit.version, confidence: unit.confidence } };
    },
    "knowledge.deprecate": async (ctx) => {
      const id = stringParam(ctx, "id");
      assertNotReserved(id);
      const existing = knowledge.get(id);
      if (!existing) throw new Error(`知识单元不存在：${id}`);
      const supersededBy = optionalString(ctx, "supersededBy");
      const reason = optionalString(ctx, "reason");
      const unit = knowledge.update(id, {
        status: "deprecated",
        validUntil: Date.now(),
        tags: [...new Set([...existing.tags, "deprecated"])],
        ...(supersededBy ? { supersededBy } : {}),
        ...(reason ? { summary: reason.slice(0, 200) } : {})
      });
      return { result: { deprecated: id, version: unit?.version } };
    },
    "knowledge.merge": async (ctx) => {
      const canonicalId = stringParam(ctx, "canonicalId");
      assertNotReserved(canonicalId);
      const duplicateIds = [...new Set(stringArrayParam(ctx, "duplicateIds"))].filter(
        (id) => id !== canonicalId
      );
      for (const id of duplicateIds) assertNotReserved(id);
      const canonical = knowledge.get(canonicalId);
      if (!canonical) throw new Error(`规范单元不存在：${canonicalId}`);
      const duplicates = duplicateIds.map((id) => {
        const unit = knowledge.get(id);
        if (!unit) throw new Error(`重复单元不存在：${id}`);
        return unit;
      });

      const aliases = new Set(canonical.aliases);
      const tags = new Set(canonical.tags);
      const uses = new Set(canonical.uses ?? []);
      for (const duplicate of duplicates) {
        for (const alias of duplicate.aliases) aliases.add(alias);
        for (const tag of duplicate.tags) tags.add(tag);
        for (const use of duplicate.uses ?? []) uses.add(use);
      }

      const merged = knowledge.update(canonicalId, {
        aliases: [...aliases],
        tags: [...tags],
        uses: [...uses],
        supersedes: [...new Set([...(canonical.supersedes ?? []), ...duplicateIds])]
      });
      for (const duplicate of duplicates) {
        knowledge.update(duplicate.id, {
          status: "deprecated",
          supersededBy: canonicalId,
          validUntil: Date.now(),
          tags: [...new Set([...duplicate.tags, "merged"])]
        });
      }
      return {
        result: {
          canonical: canonicalId,
          merged: duplicateIds,
          version: merged?.version,
          aliases: merged?.aliases.length,
          tags: merged?.tags.length
        }
      };
    }
  };
}
