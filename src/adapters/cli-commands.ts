// CLI command bodies. Kept separate from dispatch so each file stays small and
// the argument parser / context loader remain independently testable.

import { createInterface } from "node:readline/promises";

import { HeuristicProvider } from "../agent/heuristic-provider.js";
import { runAgent } from "../agent/loop.js";
import { providerFromEnv } from "../agent/provider.js";
import type { ConfirmRequest } from "../agent/types.js";
import type { ExecuteOutcome } from "../core/types.js";
import type { ParsedArgs } from "./cli-args.js";
import { persist, printJson, type CliContext, type CliIO } from "./cli-context.js";

export function flagString(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function parseParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--params 必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

export function printOutcome(io: CliIO, outcome: ExecuteOutcome, json: boolean): void {
  if (json) {
    printJson(io, outcome);
    return;
  }
  io.stdout(`status:   ${outcome.status}\n`);
  io.stdout(`decision: ${outcome.decision}\n`);
  io.stdout(`zone:     ${outcome.zone}\n`);
  io.stdout(`ratio:    ${outcome.ratio.toFixed(4)}\n`);
  io.stdout(`reason:   ${outcome.reason}\n`);
  if (outcome.result !== undefined) {
    io.stdout(`result:   ${JSON.stringify(outcome.result, null, 2)}\n`);
  }
}

export async function confirmRequest(
  io: CliIO,
  flags: Record<string, string | boolean>,
  request: ConfirmRequest
): Promise<boolean> {
  if (flags.yes === true) return true;
  return io.confirm ? io.confirm(`批准执行 ${request.action}？\n${request.reason}`) : false;
}

export async function runExec(
  context: CliContext,
  io: CliIO,
  argv: ParsedArgs
): Promise<number> {
  const action = argv.positional[0];
  if (!action) throw new Error("exec 需要动作 id");
  const task = flagString(argv.flags, "task") ?? `执行 ${action}`;
  const params = parseParams(flagString(argv.flags, "params"));
  const request = {
    task,
    action,
    params,
    trust: context.trust,
    actor: { role: context.role },
    source: "cli" as const
  };
  let outcome = await context.engine.execute(request);
  if (outcome.status === "needConfirm") {
    const approved = await confirmRequest(io, argv.flags, {
      task,
      action,
      params,
      zone: outcome.zone,
      reason: outcome.reason
    });
    if (approved) {
      context.engine.approve(task, context.role);
      outcome = await context.engine.execute(request);
    }
  }
  persist(context);
  printOutcome(io, outcome, argv.flags.json === true);
  return outcome.status === "ok" ? 0 : outcome.status === "needConfirm" ? 2 : 1;
}

export async function runAsk(
  context: CliContext,
  io: CliIO,
  argv: ParsedArgs
): Promise<number> {
  const task = flagString(argv.flags, "task") ?? argv.positional.join(" ");
  if (!task.trim()) throw new Error("ask 需要任务文本");
  const provider = argv.flags.mock === true ? new HeuristicProvider() : providerFromEnv();
  const model =
    flagString(argv.flags, "model") ?? context.config.provider?.model ?? "gpt-4o-mini";
  const json = argv.flags.json === true;
  const result = await runAgent({
    provider,
    model,
    task,
    engine: context.engine,
    trust: context.trust,
    role: context.role,
    allowDirect: true,
    normalize: argv.flags.mock !== true && argv.flags["no-normalize"] !== true,
    onConfirm: (request) => confirmRequest(io, argv.flags, request),
    onEvent: (event) => {
      if (json) return;
      if (event.type === "text") io.stdout(`${event.content}\n`);
      if (event.type === "tool") {
        io.stdout(`[tool] ${event.action} → ${event.status}：${event.reason}\n`);
      }
      if (event.type === "confirm") {
        io.stdout(`[confirm] ${event.request.action}：${event.request.reason}\n`);
      }
      if (event.type === "suggest") {
        io.stdout(`[suggest]\n${event.suggestions.map((item) => `- ${item}`).join("\n")}\n`);
      }
      if (event.type === "clarify") {
        io.stdout(
          `[clarify] ${event.question}\n${event.suggestions.map((item) => `- ${item}`).join("\n")}\n`
        );
      }
      if (event.type === "guard") io.stdout(`[guard] ${event.message}\n`);
      if (event.type === "error") io.stderr(`[error] ${event.message}\n`);
    }
  });
  persist(context);
  if (json) printJson(io, result);
  return result.stoppedReason === "error" ? 1 : 0;
}

export function defaultConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl
    .question(`${message} [y/N] `)
    .then((answer) => /^y(es)?$/i.test(answer.trim()))
    .finally(() => rl.close());
}
