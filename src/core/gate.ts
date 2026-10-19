// The single-call gate is a pure function. Keeping it pure makes every
// adjudication rule testable as an ordinary unit test and prevents the model
// from influencing the decision path.

import type { Decision, Zone } from "./types.js";

export interface GateInput {
  zone: Zone;
  /** The task has enough distinct role approvals and the session is live. */
  approved: boolean;
  /** The action is registered on the closed capability surface. */
  known: boolean;
}

export interface GateResult {
  decision: Decision;
  reason: string;
}

export function gate(input: GateInput): GateResult {
  const { zone, approved, known } = input;

  if (zone === "red") {
    return { decision: "deny", reason: "红灯操作：禁止自主执行，批准也不放行" };
  }
  if (zone === "green") {
    return { decision: "autoExecute", reason: "绿灯只读操作：直接执行" };
  }
  if (!known) {
    return {
      decision: "needConfirm",
      reason: "未登记动作：不在能力面内，无边界证据，批准后也不执行"
    };
  }
  if (approved) {
    return { decision: "autoExecute", reason: "黄灯写操作：任务已获用户批准" };
  }
  return {
    decision: "needConfirm",
    reason: "黄灯写操作：需用户批准；批准一次覆盖当前任务"
  };
}
