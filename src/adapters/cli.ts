// CLI dispatch. Approval is runtime-only: `--yes` is the human approval for
// one command process; a long-running server uses HTTP POST /approve.

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { defaultConfig, saveConfig } from "../core/config.js";
import type { TrustMode } from "../core/types.js";
import { getPack, listPacks, validatePack } from "../packs/loader.js";
import { parseArgs, USAGE } from "./cli-args.js";
import { defaultConfirm, flagString, runAsk, runExec } from "./cli-commands.js";
import { loadCliContext, printJson, type CliIO } from "./cli-context.js";
import { runKnowledgeCommand } from "./cli-knowledge.js";
import { startHttpServer } from "./http.js";
import { createMcpServer } from "./mcp.js";

async function dispatch(argv: ReturnType<typeof parseArgs>, io: CliIO): Promise<number> {
  const { command, positional, flags } = argv;
  if (!command || flags.help === true) {
    io.stdout(USAGE);
    return 0;
  }

  if (command === "init") {
    const packId = flagString(flags, "pack") ?? "opc";
    const pack = getPack(packId);
    const errors = validatePack(pack);
    if (errors.length > 0) throw new Error(`行业包无效：${errors.join("；")}`);
    const config = {
      ...defaultConfig(),
      pack: packId,
      workspace: flagString(flags, "workspace") ?? ".",
      trust: (flagString(flags, "trust") as TrustMode | undefined) ?? "agent",
      role: flagString(flags, "role") ?? pack.manifest.defaultRole
    };
    mkdirSync(resolve(io.cwd, config.workspace), { recursive: true });
    const path = saveConfig(io.cwd, config);
    io.stdout(
      `initialized ${path}\npack: ${config.pack}\nrole: ${config.role}\ntrust: ${config.trust}\n`
    );
    return 0;
  }

  if (command === "packs") {
    for (const pack of listPacks()) {
      io.stdout(
        `${pack.id}\t${pack.name}\t${pack.actionCount} actions\troles: ${pack.roles.join(", ")}\n`
      );
    }
    return 0;
  }

  if (command === "validate") {
    const packId = flagString(flags, "pack");
    if (!packId) throw new Error("validate 需要 --pack");
    const errors = validatePack(getPack(packId));
    if (errors.length > 0) {
      io.stderr(`invalid: ${errors.join("；")}\n`);
      return 1;
    }
    io.stdout(`valid: ${packId}\n`);
    return 0;
  }

  if (command === "catalog") {
    const context = await loadCliContext(io.cwd, flags);
    if (flags.json === true) {
      printJson(io, {
        pack: context.pack.manifest.id,
        name: context.pack.manifest.name,
        roles: context.pack.manifest.roles,
        grants: context.pack.manifest.grants,
        actions: context.engine.catalog().specs()
      });
      return 0;
    }
    for (const spec of context.engine.catalog().specs()) {
      io.stdout(`${spec.zone.padEnd(6)} ${spec.id.padEnd(24)} ${spec.group}\t${spec.title}\n`);
    }
    return 0;
  }

  if (command === "knowledge") {
    return runKnowledgeCommand(await loadCliContext(io.cwd, flags), io, positional, flags);
  }

  if (command === "exec") return runExec(await loadCliContext(io.cwd, flags), io, argv);

  if (command === "plan") {
    const context = await loadCliContext(io.cwd, flags);
    const task = flagString(flags, "task") ?? positional.join(" ");
    const plan = context.engine.plan(task, positional);
    if (flags.json === true) printJson(io, plan);
    else {
      io.stdout(`decision: ${plan.decision}\nreason: ${plan.reason}\n`);
      for (const step of plan.steps) {
        io.stdout(
          `  ${step.action.padEnd(24)} ${step.zone.padEnd(6)} ratio=${step.ratio.toFixed(4)} ${step.decision}\n`
        );
      }
    }
    return 0;
  }

  if (command === "ask") return runAsk(await loadCliContext(io.cwd, flags), io, argv);

  if (command === "audit") {
    const context = await loadCliContext(io.cwd, flags);
    const sub = positional[0] ?? "list";
    if (sub === "verify") {
      printJson(io, context.engine.audit.verifyFile());
      return 0;
    }
    if (sub === "export") {
      const format = flagString(flags, "format") ?? "md";
      if (format === "json") printJson(io, context.engine.audit.entries());
      else io.stdout(`${context.engine.audit.exportMarkdown()}\n`);
      return 0;
    }
    printJson(io, context.engine.audit.entries().slice(-20));
    return 0;
  }

  if (command === "serve") {
    const context = await loadCliContext(io.cwd, flags);
    if (flags.mcp === true) {
      const server = createMcpServer(context.engine, {
        input: process.stdin,
        output: process.stdout,
        trust: context.trust,
        role: context.role
      });
      io.stderr("MCP server ready on stdio\n");
      await server.start();
      return 0;
    }
    if (flags.http === true) {
      const port = Number(flagString(flags, "port") ?? 39100);
      const { url } = await startHttpServer(context.engine, {
        port,
        token: flagString(flags, "token")
      });
      io.stdout(`HTTP server: ${url}\n`);
      return 0;
    }
    throw new Error("serve 需要 --http 或 --mcp");
  }

  io.stderr(`未知命令：${command}\n\n${USAGE}`);
  return 1;
}

export async function runCli(argv: string[], io?: Partial<CliIO>): Promise<number> {
  const resolved: CliIO = {
    cwd: io?.cwd ?? process.cwd(),
    stdout: io?.stdout ?? ((text) => process.stdout.write(text)),
    stderr: io?.stderr ?? ((text) => process.stderr.write(text)),
    confirm: io?.confirm ?? defaultConfirm
  };
  try {
    return await dispatch(parseArgs(argv), resolved);
  } catch (error) {
    resolved.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
    .then((code) => {
      // Do not force-exit: a serve command may still own a listening server.
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
