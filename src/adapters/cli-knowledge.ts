// CLI knowledge inspection commands. Mutations stay in the action surface
// (knowledge.add / lesson.add / knowledge.review / deprecate / merge).

import type { KnowledgeKind, KnowledgeStatus } from "../core/knowledge/store.js";
import { flagString } from "./cli-commands.js";
import { printJson, type CliContext, type CliIO } from "./cli-context.js";

export function runKnowledgeCommand(
  context: CliContext,
  io: CliIO,
  positional: string[],
  flags: Record<string, string | boolean>
): number {
  const sub = positional[0] ?? "list";
  const kindRaw = flagString(flags, "kind");
  if (kindRaw && !["seed", "extended", "error"].includes(kindRaw)) {
    throw new Error("--kind 必须是 seed / extended / error");
  }
  const statusRaw = flagString(flags, "status");
  if (statusRaw && !["draft", "active", "deprecated"].includes(statusRaw)) {
    throw new Error("--status 必须是 draft / active / deprecated");
  }
  const namespace = flagString(flags, "namespace");
  const domain = flagString(flags, "domain");
  const tag = flagString(flags, "tag");
  const filters = {
    ...(namespace ? { namespace } : {}),
    ...(domain ? { domain } : {}),
    ...(statusRaw ? { status: statusRaw as KnowledgeStatus } : {}),
    ...(tag ? { tag } : {})
  };

  if (sub === "list") {
    const units = context.engine.knowledgeUnits(
      kindRaw as KnowledgeKind | undefined,
      filters
    );
    if (flags.json === true) printJson(io, units);
    else {
      for (const unit of units) {
        io.stdout(
          `${unit.kind.padEnd(8)} ${unit.status.padEnd(10)} ${(unit.namespace ?? "-").padEnd(12)} ${unit.id}\t${unit.title}\n`
        );
      }
      io.stdout(`total: ${units.length}\n`);
    }
    return 0;
  }

  if (sub === "search") {
    const query = flagString(flags, "query") ?? positional.slice(1).join(" ");
    if (!query.trim()) throw new Error("knowledge search 需要查询文本");
    const topK = Number(flagString(flags, "top") ?? 5);
    const hits = context.engine.searchKnowledge(query, { topK, ...filters });
    if (flags.json === true) printJson(io, hits);
    else {
      for (const hit of hits) {
        io.stdout(
          `${hit.score.toFixed(4)}  ${hit.kind.padEnd(8)} ${(hit.status ?? "-").padEnd(10)} ${hit.id}\t${hit.title}\n`
        );
      }
      io.stdout(`total: ${hits.length}\n`);
    }
    return 0;
  }

  if (sub === "dedupe") {
    const threshold = Number(flagString(flags, "threshold") ?? 0.95);
    const pairs = context.engine.knowledgeDuplicates(threshold);
    if (flags.json === true) printJson(io, pairs);
    else {
      for (const pair of pairs) {
        io.stdout(`${pair.score.toFixed(4)}  ${pair.reason}\t${pair.a} ↔ ${pair.b}\n`);
      }
      io.stdout(`total: ${pairs.length}\n`);
    }
    return 0;
  }

  if (sub === "conflicts") {
    const conflicts = context.engine.knowledgeConflicts();
    if (flags.json === true) printJson(io, conflicts);
    else {
      for (const conflict of conflicts) {
        io.stdout(`${conflict.reason}\t${conflict.a} ↔ ${conflict.b}\n`);
      }
      io.stdout(`total: ${conflicts.length}\n`);
    }
    return 0;
  }

  if (sub === "stats") {
    const stats = context.engine.knowledgeStats();
    if (flags.json === true) printJson(io, stats);
    else {
      io.stdout(`total: ${stats.total}\n`);
      io.stdout(`by kind: ${JSON.stringify(stats.byKind)}\n`);
      io.stdout(`by status: ${JSON.stringify(stats.byStatus)}\n`);
      io.stdout(`by namespace: ${JSON.stringify(stats.byNamespace)}\n`);
      io.stdout(`by domain: ${JSON.stringify(stats.byDomain)}\n`);
    }
    return 0;
  }

  throw new Error("knowledge 支持 list / search / dedupe / conflicts / stats");
}
