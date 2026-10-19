// Brain-first preparation. This runs before the model's main reasoning pass:
// it segments the task, routes knowledge, nominates actions, and decides
// whether a single deterministic green action can bypass the LLM entirely.

import { ActionCatalog } from "./catalog.js";
import { KnowledgeStore } from "./knowledge/store.js";
import type { ActionCandidate, PreparedContext } from "./types.js";

const MAX_SEGMENTS = 8;
const CONNECTOR = /(?:然后|接着|随后|并且|同时|以及|最后|再)/;

export function segmentTask(task: string): string[] {
  const out: string[] = [];
  const clauses = task.split(/[。；;\n]+/).flatMap((part) => part.split(/[，,]/));
  for (const clause of clauses) {
    for (const piece of clause.split(CONNECTOR)) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
      if (out.length >= MAX_SEGMENTS) return out;
    }
  }
  return out.length > 0 ? out : [task.trim()].filter(Boolean);
}

export interface PrepareInput {
  task: string;
  catalog: ActionCatalog;
  knowledge: KnowledgeStore;
  now?: number;
  topK?: number;
}

export function prepareContext(input: PrepareInput): PreparedContext {
  const { task, catalog, knowledge } = input;
  const now = input.now ?? Date.now();
  const segments = segmentTask(task);
  const hits = knowledge.route(task, input.topK ?? 5, now);

  const candidates = new Map<string, ActionCandidate>();
  for (const match of catalog.matchText(task)) {
    candidates.set(match.spec.id, {
      action: match.spec,
      score: match.score,
      source: "keyword"
    });
  }

  for (const hit of hits) {
    const unit = knowledge.get(hit.id);
    for (const actionId of unit?.uses ?? []) {
      const spec = catalog.get(actionId);
      if (!spec) continue;
      const current = candidates.get(actionId);
      candidates.set(actionId, {
        action: spec,
        score: (current?.score ?? 0) + 1 + hit.score,
        source: current ? current.source : "knowledge"
      });
    }
  }

  const ordered = [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id)
  );
  const top = ordered[0];
  const second = ordered[1];

  let direct: PreparedContext["direct"];
  if (top && top.action.zone === "green" && top.score >= 2) {
    const required = top.action.inputSchema?.required ?? [];
    const nonGreenCompetitor = ordered.some(
      (candidate) =>
        candidate.action.id !== top.action.id &&
        candidate.action.zone !== "green" &&
        candidate.score >= top.score - 1
    );
    const clearLead = !second || top.score >= second.score + 1;
    if (required.length === 0 && clearLead && !nonGreenCompetitor) {
      direct = {
        action: top.action.id,
        reason: `唯一高置信度绿灯动作（${top.action.title}），未经 LLM 直接执行`
      };
    }
  }

  return {
    task,
    segments,
    candidates: ordered,
    knowledge: hits,
    ...(direct ? { direct } : {})
  };
}
