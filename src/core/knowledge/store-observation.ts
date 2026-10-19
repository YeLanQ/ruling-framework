// Observation accounting: successful experience and failure lessons. The
// failure lesson records the reason and error code, so it is useful beyond a
// bare "something failed" marker.

import {
  FAILURE_GAIN_FACTOR,
  GAIN_ACTION_OUTCOME,
  GAIN_TASK_ACTION
} from "./graph.js";
import type { KnowledgeStore, ObservationDetail } from "./store.js";

function taskId(task: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < task.length; index += 1) {
    hash ^= task.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `task:${(hash >>> 0).toString(16)}`;
}

export function recordObservation(
  store: KnowledgeStore,
  task: string,
  action: string,
  ok: boolean,
  now: number,
  detail: ObservationDetail = {}
): void {
  const tId = taskId(task);
  if (!store.get(tId)) {
    store.add({
      id: tId,
      kind: "extended",
      origin: "runtime",
      title: task.slice(0, 80),
      summary: task.slice(0, 200),
      body: task,
      tags: ["task"],
      createdAt: now
    });
  }
  const aId = `action:${action}`;
  if (!store.get(aId)) {
    store.add({
      id: aId,
      kind: "seed",
      origin: "manifest",
      title: action,
      summary: action,
      body: action,
      tags: ["action"]
    });
  }

  if (ok) {
    const oId = "outcome:ok";
    if (!store.get(oId)) {
      store.add({
        id: oId,
        kind: "extended",
        origin: "runtime",
        title: "success",
        summary: "successful outcome",
        body: oId,
        tags: ["outcome"]
      });
    }
  } else {
    const fId = `failure:${action}`;
    const previous = store.get(fId);
    const reason = detail.reason ?? "未知原因";
    const code = detail.errorCode ? `（${detail.errorCode}）` : "";
    const unit = store.add({
      id: fId,
      kind: "error",
      origin: "runtime",
      title: `失败教训：${action}`,
      summary: task.slice(0, 120),
      body: `动作 ${action} 在任务「${task.slice(0, 120)}」中失败。原因：${reason}${code}`,
      tags: ["failure", "outcome", action]
    });
    if (previous) {
      unit.hits = previous.hits;
      unit.lastHitAt = previous.lastHitAt;
    }
  }

  const factor = ok ? 1 : FAILURE_GAIN_FACTOR;
  store.graph.reinforce(tId, aId, "caused", GAIN_TASK_ACTION * factor, now);
  store.graph.reinforce(
    aId,
    ok ? "outcome:ok" : `failure:${action}`,
    "caused",
    GAIN_ACTION_OUTCOME * factor,
    now
  );
}
