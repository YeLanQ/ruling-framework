// Tamper-evident audit trail. Every adjudication and execution appends one
// entry; each entry hashes the previous hash, so later edits break the chain.
// This is provenance for delivery and design change records, not legal proof.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Decision, Source, Zone } from "./types.js";

export interface AuditInput {
  source: Source;
  actorId?: string;
  actorRole?: string;
  task: string;
  action: string;
  zone: Zone;
  decision: Decision;
  status: "ok" | "needConfirm" | "denied" | "error";
  ok: boolean;
  ms: number;
  reason: string;
  files?: string[];
  errorCode?: string;
}

export interface AuditEntry extends AuditInput {
  seq: number;
  ts: number;
  taskHash: string;
  taskPreview: string;
  prevHash: string;
  hash: string;
}

export interface AuditOptions {
  filePath?: string;
  ringSize?: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function entryHash(entry: Omit<AuditEntry, "hash">): string {
  return sha256(
    JSON.stringify([
      entry.seq,
      entry.ts,
      entry.source,
      entry.actorId ?? "",
      entry.actorRole ?? "",
      entry.task,
      entry.taskHash,
      entry.action,
      entry.zone,
      entry.decision,
      entry.status,
      entry.ok,
      entry.ms,
      entry.reason,
      entry.files ?? [],
      entry.errorCode ?? "",
      entry.prevHash
    ])
  );
}

export class AuditLog {
  private readonly ring: AuditEntry[] = [];
  private readonly filePath?: string;
  private readonly ringSize: number;
  private lastHash = "genesis";
  private seq = 0;

  constructor(options: AuditOptions = {}) {
    this.filePath = options.filePath;
    this.ringSize = options.ringSize ?? 50;
    this.loadTail();
  }

  private loadTail(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    const lines = readFileSync(this.filePath, "utf8").split(/\r?\n/).filter(Boolean);
    const entries: AuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip a corrupt line; the chain verifier will report the break.
      }
    }
    const last = entries.at(-1);
    if (!last) return;
    this.lastHash = last.hash;
    this.seq = last.seq;
    this.ring.push(...entries.slice(-this.ringSize));
  }

  append(input: AuditInput): AuditEntry {
    const task = input.task.slice(0, 200);
    const base: Omit<AuditEntry, "hash"> = {
      ...input,
      task,
      taskHash: sha256(task).slice(0, 16),
      taskPreview: task.slice(0, 80),
      seq: ++this.seq,
      ts: Date.now(),
      prevHash: this.lastHash
    };
    const entry: AuditEntry = { ...base, hash: entryHash(base) };
    this.lastHash = entry.hash;
    this.ring.push(entry);
    while (this.ring.length > this.ringSize) this.ring.shift();
    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    }
    return entry;
  }

  entries(): AuditEntry[] {
    return [...this.ring];
  }

  verifyChain(entries: AuditEntry[] = this.ring): { ok: boolean; brokenAt?: number } {
    let previous = entries[0]?.prevHash ?? "genesis";
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) continue;
      if (entry.prevHash !== previous) return { ok: false, brokenAt: entry.seq };
      const { hash: _hash, ...rest } = entry;
      if (entryHash(rest) !== entry.hash) return { ok: false, brokenAt: entry.seq };
      previous = entry.hash;
    }
    return { ok: true };
  }

  verifyFile(): { ok: boolean; brokenAt?: number } {
    if (!this.filePath || !existsSync(this.filePath)) return { ok: true };
    let entries: AuditEntry[];
    try {
      entries = readFileSync(this.filePath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return { ok: false };
    }
    return this.verifyChain(entries);
  }

  exportMarkdown(): string {
    const tasks = new Map<string, AuditEntry[]>();
    for (const entry of this.ring) {
      const list = tasks.get(entry.taskHash) ?? [];
      list.push(entry);
      tasks.set(entry.taskHash, list);
    }
    const lines: string[] = ["# Ruling Audit Report", ""];
    for (const [, entries] of tasks) {
      const first = entries[0];
      if (!first) continue;
      lines.push(`## Task ${first.taskHash} — ${first.taskPreview}`);
      lines.push("");
      lines.push("| seq | time | source | actor | action | zone | decision | status | files |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const entry of entries) {
        lines.push(
          `| ${entry.seq} | ${new Date(entry.ts).toISOString()} | ${entry.source} | ${
            entry.actorRole ?? entry.actorId ?? "-"
          } | ${entry.action} | ${entry.zone} | ${entry.decision} | ${entry.status} | ${
            (entry.files ?? []).join("<br>") || "-"
          } |`
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}
