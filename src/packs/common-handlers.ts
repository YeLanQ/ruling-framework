// Handlers shared by the OPC and SMB reference packs. All writes still pass
// through the engine-provided workspace boundary.

import type { ActionHandler } from "./executor.js";
import { optionalString, stringParam } from "./executor.js";

export function readHandlers(): Record<string, ActionHandler> {
  return {
    "workspace.list": async (ctx) => ({
      result: await ctx.workspace.list(stringParam(ctx, "path", false) || ".")
    }),
    "workspace.read": async (ctx) => {
      const path = stringParam(ctx, "path");
      return { result: await ctx.workspace.read(path), files: [path] };
    },
    "doc.read": async (ctx) => {
      const path = stringParam(ctx, "path");
      return { result: await ctx.workspace.read(path), files: [path] };
    }
  };
}

export function writeHandlers(): Record<string, ActionHandler> {
  return {
    "doc.write": async (ctx) => {
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"));
      return { result: { written: path }, files: [path] };
    },
    "asset.import": async (ctx) => {
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"));
      return { result: { imported: path }, files: [path] };
    },
    "project.build": async (ctx) => {
      const output = optionalString(ctx, "output") ?? "dist/build.json";
      const entries = await ctx.workspace.list(".");
      const body = JSON.stringify(
        { builtAt: new Date().toISOString(), entries, missing: [] },
        null,
        2
      );
      await ctx.workspace.write(output, `${body}\n`);
      return { result: { output, entries: entries.length }, files: [output] };
    },
    "report.export": async (ctx) => {
      const path = stringParam(ctx, "path");
      await ctx.workspace.write(path, stringParam(ctx, "content"), { channel: "report.export" });
      return { result: { exported: path }, files: [path] };
    }
  };
}
