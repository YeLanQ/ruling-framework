// Shared executor plumbing for reference packs. An executor is the only place
// a pack may touch real systems; it receives the data-boundary workspace.

import type { ActionExecutor, ExecContext } from "../core/types.js";

export type ActionHandler = (
  ctx: ExecContext
) => Promise<{ result?: unknown; files?: string[] }>;

export function createExecutor(handlers: Record<string, ActionHandler>): ActionExecutor {
  return {
    async execute(ctx: ExecContext) {
      const handler = handlers[ctx.action];
      if (!handler) {
        throw new Error(`动作 ${ctx.action} 没有执行器实现`);
      }
      return handler(ctx);
    },
    handles(action: string) {
      return typeof handlers[action] === "function";
    }
  };
}

export function blockedByRedLine(action: string): ActionHandler {
  return async () => {
    throw new Error(`${action} 是红灯动作，门控层不应放行`);
  };
}

export function stringParam(
  ctx: { params: Record<string, unknown> },
  name: string,
  required = true
): string {
  const value = ctx.params[name];
  if (typeof value === "string") return value;
  if (!required && value === undefined) return "";
  throw new Error(`参数 ${name} 必须是字符串`);
}

export function optionalString(
  ctx: { params: Record<string, unknown> },
  name: string
): string | undefined {
  const value = ctx.params[name];
  return typeof value === "string" ? value : undefined;
}
