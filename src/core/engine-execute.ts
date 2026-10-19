// The single execution channel. Preflight has already adjudicated; this module
// validates input, runs the one executor, and records the observation.

import { performance } from "node:perf_hooks";

import type { RulingEngine } from "./engine.js";
import { emitOutcome } from "./engine-audit.js";
import { preflight } from "./engine-preflight.js";
import type { ExecuteOutcome, ExecuteRequest, RulingErrorCode } from "./types.js";
import { validateSchema } from "./validate.js";
import { WorkspaceError } from "./workspace.js";

function errorCodeOf(error: unknown): RulingErrorCode {
  return error instanceof WorkspaceError ? error.code : "EXECUTOR_ERROR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executeRequest(
  engine: RulingEngine,
  request: ExecuteRequest,
  now: () => number
): Promise<ExecuteOutcome> {
  const result = await preflight(engine, request, now);
  if ("outcome" in result) return result.outcome;
  const { task, action, params, source, actorId, actorRole, spec, zone } = result.proceed;
  const meta = { source, actorId, actorRole, task, action };

  const problems = validateSchema(spec.inputSchema, params);
  if (problems.length > 0) {
    return emitOutcome(
      engine,
      {
        status: "error",
        decision: "deny",
        zone,
        reason: `参数校验失败：${problems.join("；")}`,
        errorCode: "BAD_PARAMS"
      },
      0,
      meta
    );
  }

  const started = performance.now();
  let output: unknown;
  let files: string[] | undefined;
  let ok = true;
  let errorCode: RulingErrorCode | undefined;
  try {
    const executed = await engine.surface.executor.execute({
      task,
      action,
      params,
      actor: { id: actorId, role: actorRole },
      trust: request.trust,
      source,
      workspace: engine.workspace
    });
    output = executed.result;
    files = executed.files;
  } catch (error) {
    ok = false;
    errorCode = errorCodeOf(error);
    output = { error: errorMessage(error) };
  }
  const ms = Math.round(performance.now() - started);

  const observe = engine.ledger.record(action, spec, ok, ms);
  const failureReason =
    ok
      ? "执行完成"
      : output && typeof output === "object" && "error" in output
        ? String((output as { error: unknown }).error)
        : "执行失败";
  engine.surface.knowledge.recordObservation(task, action, ok, now(), {
    reason: failureReason,
    errorCode
  });
  return emitOutcome(
    engine,
    {
      status: ok ? "ok" : "error",
      decision: "autoExecute",
      zone,
      reason: ok ? "执行完成" : "执行失败",
      result: output,
      files,
      observe,
      errorCode
    },
    ms,
    meta
  );
}
