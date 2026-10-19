// Preflight adjudication: capability surface, static red lines, role grants,
// dynamic zone, and the three-zone gate. No executor runs here.

import { normalizeTask } from "./approval.js";
import type { RulingEngine } from "./engine.js";
import { emitOutcome } from "./engine-audit.js";
import { gate } from "./gate.js";
import type { ActionSpec, ExecuteOutcome, ExecuteRequest, Source, Zone } from "./types.js";

export interface Proceed {
  task: string;
  action: string;
  params: Record<string, unknown>;
  source: Source;
  actorId?: string;
  actorRole: string;
  spec: ActionSpec;
  zone: Zone;
}

export type PreflightResult = { outcome: ExecuteOutcome } | { proceed: Proceed };

function draft(
  status: ExecuteOutcome["status"],
  decision: ExecuteOutcome["decision"],
  zone: Zone,
  reason: string,
  errorCode?: ExecuteOutcome["errorCode"]
): Parameters<typeof emitOutcome>[1] {
  return { status, decision, zone, reason, ...(errorCode ? { errorCode } : {}) };
}

export async function preflight(
  engine: RulingEngine,
  request: ExecuteRequest,
  now: () => number
): Promise<PreflightResult> {
  if (typeof request.task !== "string" || typeof request.action !== "string") {
    throw new Error("task 与 action 必须是字符串");
  }
  const rawTrust: unknown = request.trust;
  if (rawTrust !== "agent" && rawTrust !== "operator") {
    throw new Error("trust 必须是 agent 或 operator");
  }
  const rawParams: unknown = request.params;
  if (
    rawParams !== undefined &&
    (typeof rawParams !== "object" || rawParams === null || Array.isArray(rawParams))
  ) {
    throw new Error("params 必须是对象");
  }

  const task = normalizeTask(request.task);
  const action = request.action.trim();
  const params = request.params ?? {};
  const source: Source = request.source ?? "cli";
  const actorRole = request.actor?.role ?? engine.surface.defaultRole;
  const actorId = request.actor?.id;
  const meta = { source, actorId, actorRole, task, action };

  const spec = engine.surface.catalog.get(action);
  if (!spec) {
    const agent = request.trust === "agent";
    return {
      outcome: emitOutcome(
        engine,
        draft(
          agent ? "needConfirm" : "denied",
          agent ? "needConfirm" : "deny",
          "yellow",
          "未登记动作：不在能力面内，不能执行",
          "UNKNOWN_ACTION"
        ),
        0,
        meta
      )
    };
  }

  // A static red line is absolute: it is reported as such regardless of role.
  // Dynamic red lines are resolved below with the context.
  if (spec.zone === "red" && !spec.dynamicZone) {
    return {
      outcome: emitOutcome(
        engine,
        draft("denied", "deny", "red", "红灯动作：禁止自主执行，批准也不放行", "RED_LINE"),
        0,
        meta
      )
    };
  }

  const granted = engine.surface.grants[actorRole] ?? [];
  const allowed =
    granted.includes("*") || granted.includes(spec.group) || granted.includes(spec.id);
  if (!allowed) {
    return {
      outcome: emitOutcome(
        engine,
        draft(
          "denied",
          "deny",
          spec.zone,
          `角色 ${actorRole} 未被源头授权能力组 ${spec.group}`,
          "ACTION_NOT_GRANTED"
        ),
        0,
        meta
      )
    };
  }

  let zone: Zone;
  try {
    zone = await engine.surface.zones.resolve(spec, {
      task,
      params,
      workspace: engine.workspace
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      outcome: emitOutcome(
        engine,
        draft("error", "deny", "red", `区域解析失败，按失败关闭处理：${message}`, "INTERNAL_ERROR"),
        0,
        meta
      )
    };
  }

  if (request.trust === "agent") {
    const approved = engine.approvals.isApproved(task, spec.group, now());
    const result = gate({ zone, approved, known: true });
    if (result.decision !== "autoExecute") {
      return {
        outcome: emitOutcome(
          engine,
          draft(
            result.decision === "deny" ? "denied" : "needConfirm",
            result.decision,
            zone,
            result.reason,
            result.decision === "deny" ? "RED_LINE" : undefined
          ),
          0,
          meta
        )
      };
    }
  } else if (zone === "red") {
    return {
      outcome: emitOutcome(
        engine,
        draft(
          "denied",
          "deny",
          zone,
          "红灯动作：外部客户端同样阻断，只能由人工在框架外处理",
          "RED_LINE"
        ),
        0,
        meta
      )
    };
  }

  return { proceed: { task, action, params, source, actorId, actorRole, spec, zone } };
}
