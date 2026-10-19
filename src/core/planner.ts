// Brain-first preparation. Runs before the model's main reasoning pass:
// segments the task, routes knowledge, nominates actions, classifies each unit
// as direct/assist/fuzzy/suggest, and optionally carries a non-adjudicative
// normalization result.

import { ActionCatalog } from "./catalog.js";
import { KnowledgeStore } from "./knowledge/store.js";
import type {
  ActionCandidate,
  KnowledgeHit,
  NormalizedTask,
  PreparedContext,
  TaskMode,
  TaskUnit
} from "./types.js";

const MAX_SEGMENTS = 8;
const CONNECTOR = /(?:然后|接着|随后|并且|同时|以及|最后|再)/;
const QUESTION =
  /(怎么|如何|能不能|可以吗|能否|是否|建议|推荐|有哪些|什么是|为什么|what|how|can i|should i)/i;
const AMBIGUOUS =
  /(或者|还是|可能|大概|随便|处理一下|弄一下|搞一下|都行|看情况)/i;

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
  normalized?: NormalizedTask;
}

function collectCandidates(
  text: string,
  catalog: ActionCatalog,
  knowledge: KnowledgeStore,
  hits: KnowledgeHit[]
): ActionCandidate[] {
  const candidates = new Map<string, ActionCandidate>();
  for (const match of catalog.matchText(text)) {
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
  return [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id)
  );
}

function confidenceOf(score: number): number {
  return Math.max(0, Math.min(1, score / 4));
}

function classifyUnit(text: string, candidates: ActionCandidate[]): TaskUnit {
  const top = candidates[0];
  const second = candidates[1];
  if (!top) {
    return { text, mode: "suggest", confidence: 0, reason: "没有匹配到动作" };
  }
  const required = top.action.inputSchema?.required ?? [];
  const close =
    !!second &&
    second.action.id !== top.action.id &&
    top.score - second.score <= 1;

  if (QUESTION.test(text)) {
    return {
      text,
      mode: "suggest",
      action: top.action.id,
      confidence: confidenceOf(top.score),
      reason: "问句/咨询，先给建议，不直接执行"
    };
  }
  if (AMBIGUOUS.test(text) || close) {
    const other = second?.action.id;
    return {
      text,
      mode: "fuzzy",
      action: top.action.id,
      confidence: confidenceOf(top.score),
      reason:
        close && other
          ? `候选动作不明确：${top.action.id} 与 ${other} 分数接近`
          : "任务表述模糊，需要补充对象、动作或目标"
    };
  }
  if (top.action.zone === "green" && required.length === 0 && top.score >= 2) {
    return {
      text,
      mode: "direct",
      action: top.action.id,
      confidence: confidenceOf(top.score),
      reason: "唯一高置信度绿灯动作，无需参数"
    };
  }
  return {
    text,
    mode: "assist",
    action: top.action.id,
    confidence: confidenceOf(top.score),
    reason: required.length > 0 ? `需要参数：${required.join(", ")}` : "交给助手提议"
  };
}

function overallMode(units: TaskUnit[]): TaskMode {
  if (units.length === 0) return "suggest";
  if (units.some((unit) => unit.mode === "fuzzy")) return "fuzzy";
  if (units.every((unit) => unit.mode === "suggest")) return "suggest";
  if (units.length === 1 && units[0]?.mode === "direct") return "direct";
  if (units.some((unit) => unit.mode === "assist" || unit.mode === "direct")) return "assist";
  return "suggest";
}

function suggestionsFor(candidates: ActionCandidate[]): string[] {
  if (candidates.length === 0) {
    return ["没有匹配到动作；请补充对象、操作和目标。"];
  }
  return candidates.slice(0, 3).map((candidate) => {
    const required = candidate.action.inputSchema?.required ?? [];
    const params = required.length > 0 ? `；需要参数：${required.join(", ")}` : "";
    return `${candidate.action.title}（${candidate.action.id}，${candidate.action.zone}）${params}`;
  });
}

export function prepareContext(input: PrepareInput): PreparedContext {
  const { task, catalog, knowledge } = input;
  const now = input.now ?? Date.now();
  const segments = segmentTask(task);
  const hits = knowledge.route(task, input.topK ?? 5, now);

  const units = segments.map((segment) =>
    classifyUnit(segment, collectCandidates(segment, catalog, knowledge, hits))
  );
  const mode = overallMode(units);
  const candidates = collectCandidates(task, catalog, knowledge, hits);

  const ambiguities = units
    .filter((unit) => unit.mode === "fuzzy")
    .map((unit) => unit.reason);
  const suggestions =
    mode === "suggest" || mode === "fuzzy"
      ? [
          ...new Set(
            units.flatMap((unit) =>
              suggestionsFor(collectCandidates(unit.text, catalog, knowledge, hits))
            )
          )
        ]
      : [];

  const directUnit = units.length === 1 ? units[0] : undefined;
  const direct =
    mode === "direct" && directUnit?.action
      ? {
          action: directUnit.action,
          reason: `唯一高置信度绿灯动作（${directUnit.action}），未经 LLM 直接执行`
        }
      : undefined;

  return {
    task,
    segments,
    units,
    candidates,
    knowledge: hits,
    mode,
    ambiguities,
    suggestions,
    ...(input.normalized ? { normalized: input.normalized } : {}),
    ...(direct ? { direct } : {})
  };
}
