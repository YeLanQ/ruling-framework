// Outcome accounting: one place that writes the decision counter, the audit
// entry, and the returned ratio. Keeping it here prevents an execution path
// from "forgetting" to audit.

import { score } from "./budget.js";
import type { RulingEngine } from "./engine.js";
import type { Decision, ExecuteOutcome, ObserveReport, RulingErrorCode, Source, Zone } from "./types.js";

export interface OutcomeDraft {
  status: "ok" | "needConfirm" | "denied" | "error";
  decision: Decision;
  zone: Zone;
  reason: string;
  ratio?: number;
  result?: unknown;
  files?: string[];
  observe?: ObserveReport;
  errorCode?: RulingErrorCode;
}

export interface OutcomeMeta {
  source: Source;
  actorId?: string;
  actorRole?: string;
  task: string;
  action: string;
}

export function emitOutcome(
  engine: RulingEngine,
  draft: OutcomeDraft,
  ms: number,
  meta: OutcomeMeta
): ExecuteOutcome {
  const spec = engine.surface.catalog.get(meta.action);
  const ratio =
    draft.ratio ?? (spec ? score(engine.ledger.stat(meta.action), spec).ratio : 0);
  const full: ExecuteOutcome = { ...draft, ratio };

  engine.ledger.noteDecision(full.decision);
  engine.audit.append({
    source: meta.source,
    actorId: meta.actorId,
    actorRole: meta.actorRole,
    task: meta.task,
    action: meta.action,
    zone: full.zone,
    decision: full.decision,
    status: full.status,
    ok: full.status === "ok",
    ms,
    reason: full.reason,
    files: full.files,
    errorCode: full.errorCode
  });
  return full;
}
