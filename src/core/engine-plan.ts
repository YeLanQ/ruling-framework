// Plan-level advice. A plan never replaces the per-call gate; it only tells a
// human whether a sequence is worth running without interruption.

import { autoEligible, score } from "./budget.js";
import type { RulingEngine } from "./engine.js";
import type { Plan, PlanStep } from "./types.js";

export function buildPlan(
  engine: RulingEngine,
  task: string,
  actionIds: string[]
): Plan {
  const steps: PlanStep[] = actionIds.map((actionId) => {
    const spec = engine.surface.catalog.get(actionId);
    if (!spec) {
      return {
        action: actionId,
        zone: "yellow",
        ratio: 0,
        decision: "needConfirm",
        reason: "未登记动作"
      };
    }
    const breakdown = score(engine.ledger.stat(actionId), spec);
    const decision =
      spec.zone === "red"
        ? "deny"
        : spec.zone === "yellow"
          ? "needConfirm"
          : autoEligible(breakdown)
            ? "autoExecute"
            : "needConfirm";
    return {
      action: actionId,
      zone: spec.zone,
      ratio: breakdown.ratio,
      decision,
      reason:
        spec.zone === "yellow"
          ? "黄灯写操作，计划层面必须确认"
          : decision === "autoExecute"
            ? "绿灯且效能比达标"
            : "绿灯但效能比未达标"
    };
  });

  if (steps.some((step) => step.decision === "deny")) {
    return { task, decision: "deny", steps, reason: "计划包含红灯动作" };
  }
  if (steps.some((step) => step.decision === "needConfirm")) {
    return { task, decision: "needConfirm", steps, reason: "计划包含需确认步骤" };
  }
  return { task, decision: "autoExecute", steps, reason: "全部步骤为绿灯且效能比达标" };
}
